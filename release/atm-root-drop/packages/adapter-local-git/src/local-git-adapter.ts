import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ArtifactRecord, EvidenceRecord, ScopeLockRecord, WorkItemRef } from '@ai-atomic-framework/core';
import type {
  AtomizeAdapterRequest,
  InfectAdapterRequest,
  ProjectAdapterLegacyUriResolution
} from '@ai-atomic-framework/plugin-sdk';

import { parseLegacyUri } from '../../core/src/registry/urn.ts';
import { scanNeutralityText } from '../../plugin-rule-guard/src/neutrality-scanner.ts';
import {
  defaultLocalGitAdapterConfig,
  type LocalGitAdapterContext,
  type LocalGitAdapterConfig,
  type LocalGitAdapterResult,
  type LocalGitRegistryEntry,
  type LocalGitAdapterMode,
  type LocalGitAdapterOperation
} from './index.ts';

const frameworkRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

export { defaultLocalGitAdapterConfig };

export function createLocalGitAdapter(configOverrides: Partial<LocalGitAdapterConfig> = {}) {
  const defaultConfig = mergeConfig(configOverrides);
  return {
    adapterName: '@ai-atomic-framework/adapter-local-git' as const,
    defaultConfig,
    resolveRegistryPath: (context: LocalGitAdapterContext) => resolveRegistryPath(context.repositoryRoot, mergeConfig(defaultConfig, context.config)),
    resolveLegacyUri: (context: LocalGitAdapterContext, legacyUri: string) => resolveLegacyUri(context, defaultConfig, legacyUri),
    scaffold: (context: LocalGitAdapterContext) => scaffoldLocalRepository(context, defaultConfig),
    lockScope: (context: LocalGitAdapterContext, workItem: WorkItemRef, files: readonly string[]) => createNoopOperationResult('lock', context, defaultConfig, {
      workItem,
      lockRecords: [createNoopLockRecord(context, workItem, files)],
      message: 'Scope lock recorded as a local no-op; no host lock service was required.'
    }),
    runGate: (context: LocalGitAdapterContext, workItem: WorkItemRef) => createNoopOperationResult('gate', context, defaultConfig, {
      workItem,
      message: 'Gate operation completed as a no-op; project validators may be attached by a host adapter.'
    }),
    writeDocRecord: (context: LocalGitAdapterContext, workItem: WorkItemRef, summary: string) => createNoopOperationResult('doc', context, defaultConfig, {
      workItem,
      message: 'Doc operation completed as a no-op; no external documentation system was required.',
      extraEvidence: summary ? [createEvidence('handoff', summary, [])] : []
    }),
    runAtomizeAdapter: (context: LocalGitAdapterContext, request: AtomizeAdapterRequest) => runDryRunAdapter('behavior.atomize', context, defaultConfig, request),
    runInfectAdapter: (context: LocalGitAdapterContext, request: InfectAdapterRequest) => runDryRunAdapter('behavior.infect', context, defaultConfig, request),
    listHostGates: () => [],
    listNoTouchZones: () => [],
    resolveMutationPolicy: () => createNeutralMutationPolicy(),
    writeRegistryEntry: (context: LocalGitAdapterContext, entry: LocalGitRegistryEntry) => writeRegistryEntry(context, defaultConfig, entry),
    readRegistryEntry: (context: LocalGitAdapterContext, entryId: string) => readRegistryEntry(context, defaultConfig, entryId)
  };
}

export function createNeutralMutationPolicy() {
  return {
    requireSession: true,
    requireDryRunProposal: true,
    requireReviewBeforeApply: true,
    allowUnguidedInDev: true,
    allowUnguidedInCI: false
  };
}

export function scaffoldLocalRepository(context: LocalGitAdapterContext, baseConfig = defaultLocalGitAdapterConfig) {
  const config = mergeConfig(baseConfig, context.config);
  const registryPath = resolveRegistryPath(context.repositoryRoot, config);
  const reportsPath = resolvePath(context.repositoryRoot, config.reportsPath);
  const artifacts = [
    createArtifact(relativePath(context.repositoryRoot, registryPath), 'file', 'scaffold'),
    createArtifact(relativePath(context.repositoryRoot, reportsPath), 'file', 'scaffold')
  ];

  if (!config.dryRun) {
    mkdirSync(registryPath, { recursive: true });
    mkdirSync(reportsPath, { recursive: true });
  }

  return createResult({
    ok: true,
    operation: 'scaffold',
    context,
    config,
    mode: (config.dryRun ? 'dry-run' : 'filesystem') as LocalGitAdapterMode,
    noop: false,
    messages: [
      config.dryRun
        ? 'Scaffold planned in dry-run mode; no files were written.'
        : 'Local ATM workspace scaffolded.'
    ],
    evidence: [createEvidence('validation', 'Local filesystem registry path is available.', artifacts.map((artifact) => artifact.artifactPath))],
    artifacts
  });
}

export function resolveRegistryPath(repositoryRoot: string, config = defaultLocalGitAdapterConfig) {
  return resolvePath(repositoryRoot, config.registryPath);
}

export function writeRegistryEntry(context: LocalGitAdapterContext, baseConfig: LocalGitAdapterConfig, entry: LocalGitRegistryEntry) {
  const config = mergeConfig(baseConfig, context.config);
  const registryPath = resolveRegistryPath(context.repositoryRoot, config);
  const entryPath = path.join(registryPath, `${safeRegistryId(entry.id)}.json`);
  const artifactPath = relativePath(context.repositoryRoot, entryPath);

  if (!config.dryRun) {
    mkdirSync(registryPath, { recursive: true });
    writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }

  return createResult({
    ok: true,
    operation: 'registry',
    context,
    config,
    mode: (config.dryRun ? 'dry-run' : 'filesystem') as LocalGitAdapterMode,
    noop: false,
    messages: [
      config.dryRun
        ? 'Registry entry write planned in dry-run mode.'
        : 'Registry entry written to the local filesystem.'
    ],
    evidence: [createEvidence('validation', `Registry entry available: ${entry.id}`, [artifactPath])],
    artifacts: [createArtifact(artifactPath, 'file', 'registry')]
  });
}

export function readRegistryEntry(context: LocalGitAdapterContext, baseConfig: LocalGitAdapterConfig, entryId: string) {
  const config = mergeConfig(baseConfig, context.config);
  const registryPath = resolveRegistryPath(context.repositoryRoot, config);
  const entryPath = path.join(registryPath, `${safeRegistryId(entryId)}.json`);
  if (!existsSync(entryPath)) {
    return null;
  }
  return JSON.parse(readFileSync(entryPath, 'utf8')) as LocalGitRegistryEntry;
}

export function resolveLegacyUri(context: LocalGitAdapterContext, baseConfig: LocalGitAdapterConfig, legacyUri: string) {
  const config = mergeConfig(baseConfig, context.config);
  const parsed = parseLegacyUri(legacyUri);
  const absolutePath = parsed.relativePath
    ? resolvePath(context.repositoryRoot, parsed.relativePath)
    : path.resolve(context.repositoryRoot);
  const configAlias = (config as unknown as Record<string, unknown>).repositoryAlias;
  return {
    ...parsed,
    absolutePath,
    exists: existsSync(absolutePath),
    repositoryAlias: parsed.repositoryAlias || (typeof configAlias === 'string' ? configAlias : undefined) || path.basename(context.repositoryRoot)
  } as ProjectAdapterLegacyUriResolution;
}

export function runDryRunAdapter(behaviorId: string, context: LocalGitAdapterContext, baseConfig: LocalGitAdapterConfig, request: AtomizeAdapterRequest | InfectAdapterRequest) {
  const config = mergeConfig(baseConfig, context.config);
  const resolvedLegacyUri = resolveLegacyUri(context, config, request.legacySource);
  const inlineSource = resolveInlineSource(request, resolvedLegacyUri);
  const neutrality = scanNeutralityText({
    relativePath: resolvedLegacyUri.relativePath || `${resolvedLegacyUri.repositoryAlias}/<root>`,
    content: inlineSource
  }, {
    repositoryRoot: frameworkRepositoryRoot
  });
  const dryRunPatch = {
    contractId: `${behaviorId.replace('behavior.', 'adapter-')}:${safeRegistryId(request.legacySource)}`,
    behaviorId,
    dryRun: true,
    applyToHostProject: false,
    hostMutationAllowed: false,
    patchMode: 'dry-run' as const,
    proposalSource: 'ATM-2-0020',
    decompositionDecision: 'atom-extract' as const,
    patchFiles: [...(request.patchFiles || [])]
  };

  return createResult({
    ok: neutrality.ok,
    operation: 'adapter',
    context,
    config,
    mode: 'dry-run',
    dryRunOverride: true,
    noop: false,
    messages: [
      neutrality.ok
        ? `${behaviorId} adapter prepared dry-run patch contract without host mutation.`
        : `${behaviorId} adapter blocked dry-run patch contract because neutrality violations were detected.`
    ],
    evidence: [
      createEvidence('validation', `Resolved legacy source ${resolvedLegacyUri.uri}`, []),
      createEvidence(
        'validation',
        neutrality.ok
          ? 'Neutrality scan passed for adapter dry-run payload.'
          : 'Neutrality scan failed for adapter dry-run payload.',
        []
      )
    ],
    lockRecords: [],
    artifacts: [],
    extra: {
      resolvedLegacyUri,
      dryRunPatch,
      neutrality: {
        ok: neutrality.ok,
        violationCount: neutrality.violations.length,
        bannedTerms: neutrality.bannedTerms,
        scannedPath: neutrality.relativePath
      }
    }
  });
}

function createNoopOperationResult(operation: LocalGitAdapterOperation, context: LocalGitAdapterContext, baseConfig: LocalGitAdapterConfig, details: { message: string; workItem?: WorkItemRef; extraEvidence?: readonly EvidenceRecord[]; lockRecords?: ScopeLockRecord[] }) {
  const config = mergeConfig(baseConfig, context.config);
  const artifactPaths: string[] = [];
  const evidence = [
    createEvidence('validation', details.message, artifactPaths),
    ...(details.extraEvidence || [])
  ];
  return createResult({
    ok: true,
    operation,
    context,
    config,
    mode: config.dryRun ? 'dry-run' : 'noop',
    noop: true,
    messages: [details.message],
    evidence,
    lockRecords: details.lockRecords || [],
    artifacts: []
  });
}

interface CreateResultOptions {
  ok: boolean;
  operation: LocalGitAdapterOperation;
  context: LocalGitAdapterContext;
  config: LocalGitAdapterConfig;
  mode: LocalGitAdapterMode;
  dryRunOverride?: boolean;
  noop: boolean;
  messages: readonly string[];
  evidence: readonly EvidenceRecord[];
  lockRecords?: readonly ScopeLockRecord[];
  artifacts?: readonly ArtifactRecord[];
  extra?: Record<string, unknown>;
}

function createResult({ ok, operation, context, config, mode, dryRunOverride, noop, messages, evidence, lockRecords = [], artifacts = [], extra = {} }: CreateResultOptions): LocalGitAdapterResult {
  return {
    adapterName: '@ai-atomic-framework/adapter-local-git',
    lifecycleMode: context.lifecycleMode || 'evolution',
    ok,
    operation,
    mode,
    dryRun: typeof dryRunOverride === 'boolean' ? dryRunOverride : config.dryRun,
    noop,
    messages,
    evidence,
    lockRecords,
    artifacts,
    registryPath: relativePath(context.repositoryRoot, resolveRegistryPath(context.repositoryRoot, config)),
    ...extra
  };
}

function createNoopLockRecord(context: LocalGitAdapterContext, workItem: WorkItemRef, files: readonly string[]): ScopeLockRecord {
  return {
    workItemId: workItem.workItemId,
    lockedBy: context.actor || 'local-git-adapter',
    lockedAt: context.now || new Date(0).toISOString(),
    files: [...files]
  };
}

function createEvidence(evidenceKind: 'validation' | 'metric' | 'review' | 'handoff', summary: string, artifactPaths: readonly string[]): EvidenceRecord {
  return { evidenceKind, summary, artifactPaths };
}

function createArtifact(artifactPath: string, artifactKind: 'snapshot' | 'log' | 'report' | 'file', producedBy: string): ArtifactRecord {
  return { artifactPath, artifactKind, producedBy };
}

function resolveInlineSource(request: AtomizeAdapterRequest | InfectAdapterRequest, resolvedLegacyUri: ProjectAdapterLegacyUriResolution): string {
  if (typeof request.inlineSource === 'string') {
    return request.inlineSource;
  }
  if (resolvedLegacyUri.exists && resolvedLegacyUri.absolutePath) {
    return readFileSync(resolvedLegacyUri.absolutePath, 'utf8');
  }
  return '';
}

function mergeConfig(...configs: Array<Partial<LocalGitAdapterConfig> | undefined>): LocalGitAdapterConfig {
  return Object.freeze(Object.assign({}, defaultLocalGitAdapterConfig, ...configs));
}

function resolvePath(repositoryRoot: string, candidatePath: string): string {
  return path.isAbsolute(candidatePath)
    ? path.normalize(candidatePath)
    : path.resolve(repositoryRoot, candidatePath);
}

function relativePath(repositoryRoot: string, targetPath: string): string {
  const relative = path.relative(repositoryRoot, targetPath).replace(/\\/g, '/');
  return relative || '.';
}

function safeRegistryId(entryId: string): string {
  return String(entryId).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

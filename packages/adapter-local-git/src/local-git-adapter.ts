import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLegacyUri } from '../../core/src/registry/urn.ts';
import { scanNeutralityText } from '../../plugin-rule-guard/src/neutrality-scanner.ts';

const frameworkRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

export const defaultLocalGitAdapterConfig = Object.freeze({
  registryPath: '.atm/registry',
  reportsPath: '.atm/history/reports',
  dryRun: false,
  lockMode: 'noop',
  gateMode: 'noop',
  docMode: 'noop'
});

export function createLocalGitAdapter(configOverrides = {}) {
  const defaultConfig = mergeConfig(configOverrides);
  return {
    adapterName: '@ai-atomic-framework/adapter-local-git',
    defaultConfig,
    resolveRegistryPath: (context: any) => resolveRegistryPath(context.repositoryRoot, mergeConfig(defaultConfig, context.config)),
    resolveLegacyUri: (context: any, legacyUri: any) => resolveLegacyUri(context, defaultConfig, legacyUri),
    scaffold: (context: any) => scaffoldLocalRepository(context, defaultConfig),
    lockScope: (context: any, workItem: any, files: any) => createNoopOperationResult('lock', context, defaultConfig, {
      workItem,
      lockRecords: [createNoopLockRecord(context, workItem, files)],
      message: 'Scope lock recorded as a local no-op; no host lock service was required.'
    }),
    runGate: (context: any, workItem: any) => createNoopOperationResult('gate', context, defaultConfig, {
      workItem,
      message: 'Gate operation completed as a no-op; project validators may be attached by a host adapter.'
    }),
    writeDocRecord: (context: any, workItem: any, summary: any) => createNoopOperationResult('doc', context, defaultConfig, {
      workItem,
      message: 'Doc operation completed as a no-op; no external documentation system was required.',
      extraEvidence: summary ? [createEvidence('handoff', summary, [])] : []
    }),
    runAtomizeAdapter: (context: any, request: any) => runDryRunAdapter('behavior.atomize', context, defaultConfig, request),
    runInfectAdapter: (context: any, request: any) => runDryRunAdapter('behavior.infect', context, defaultConfig, request),
    writeRegistryEntry: (context: any, entry: any) => writeRegistryEntry(context, defaultConfig, entry),
    readRegistryEntry: (context: any, entryId: any) => readRegistryEntry(context, defaultConfig, entryId)
  };
}

export function scaffoldLocalRepository(context: any, baseConfig = defaultLocalGitAdapterConfig) {
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
    mode: config.dryRun ? 'dry-run' : 'filesystem',
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

export function resolveRegistryPath(repositoryRoot: any, config = defaultLocalGitAdapterConfig) {
  return resolvePath(repositoryRoot, config.registryPath);
}

export function writeRegistryEntry(context: any, baseConfig: any, entry: any) {
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
    mode: config.dryRun ? 'dry-run' : 'filesystem',
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

export function readRegistryEntry(context: any, baseConfig: any, entryId: any) {
  const config = mergeConfig(baseConfig, context.config);
  const registryPath = resolveRegistryPath(context.repositoryRoot, config);
  const entryPath = path.join(registryPath, `${safeRegistryId(entryId)}.json`);
  if (!existsSync(entryPath)) {
    return null;
  }
  return JSON.parse(readFileSync(entryPath, 'utf8'));
}

export function resolveLegacyUri(context: any, baseConfig: any, legacyUri: any) {
  const config = mergeConfig(baseConfig, context.config);
  const parsed = parseLegacyUri(legacyUri);
  const absolutePath = parsed.relativePath
    ? resolvePath(context.repositoryRoot, parsed.relativePath)
    : path.resolve(context.repositoryRoot);
  return {
    ...parsed,
    absolutePath,
    exists: existsSync(absolutePath),
    repositoryAlias: parsed.repositoryAlias || config.repositoryAlias || path.basename(context.repositoryRoot)
  };
}

export function runDryRunAdapter(behaviorId: any, context: any, baseConfig: any, request: any) {
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
    patchMode: 'dry-run',
    proposalSource: 'ATM-2-0020',
    decompositionDecision: 'atom-extract',
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

function createNoopOperationResult(operation: any, context: any, baseConfig: any, details: any) {
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

function createResult({ ok, operation, context, config, mode, dryRunOverride, noop, messages, evidence, lockRecords = [], artifacts = [], extra = {} }: any) {
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

function createNoopLockRecord(context: any, workItem: any, files: any) {
  return {
    workItemId: workItem.workItemId,
    lockedBy: context.actor || 'local-git-adapter',
    lockedAt: context.now || new Date(0).toISOString(),
    files: [...files]
  };
}

function createEvidence(evidenceKind: any, summary: any, artifactPaths: any) {
  return { evidenceKind, summary, artifactPaths };
}

function createArtifact(artifactPath: any, artifactKind: any, producedBy: any) {
  return { artifactPath, artifactKind, producedBy };
}

function resolveInlineSource(request: any, resolvedLegacyUri: any) {
  if (typeof request.inlineSource === 'string') {
    return request.inlineSource;
  }
  if (resolvedLegacyUri.exists && resolvedLegacyUri.absolutePath) {
    return readFileSync(resolvedLegacyUri.absolutePath, 'utf8');
  }
  return '';
}

function mergeConfig(...configs: any[]) {
  return Object.freeze(Object.assign({}, defaultLocalGitAdapterConfig, ...configs));
}

function resolvePath(repositoryRoot: any, candidatePath: any) {
  return path.isAbsolute(candidatePath)
    ? path.normalize(candidatePath)
    : path.resolve(repositoryRoot, candidatePath);
}

function relativePath(repositoryRoot: any, targetPath: any) {
  const relative = path.relative(repositoryRoot, targetPath).replace(/\\/g, '/');
  return relative || '.';
}

function safeRegistryId(entryId: any) {
  return String(entryId).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

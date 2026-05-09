import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLegacyUri } from '../../core/src/registry/urn.mjs';
import { scanNeutralityText } from '../../plugin-rule-guard/src/neutrality-scanner.mjs';

const frameworkRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

export const defaultLocalGitAdapterConfig = Object.freeze({
  registryPath: '.atm/registry',
  reportsPath: '.atm/reports',
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
    resolveRegistryPath: (context) => resolveRegistryPath(context.repositoryRoot, mergeConfig(defaultConfig, context.config)),
    resolveLegacyUri: (context, legacyUri) => resolveLegacyUri(context, defaultConfig, legacyUri),
    scaffold: (context) => scaffoldLocalRepository(context, defaultConfig),
    lockScope: (context, workItem, files) => createNoopOperationResult('lock', context, defaultConfig, {
      workItem,
      lockRecords: [createNoopLockRecord(context, workItem, files)],
      message: 'Scope lock recorded as a local no-op; no host lock service was required.'
    }),
    runGate: (context, workItem) => createNoopOperationResult('gate', context, defaultConfig, {
      workItem,
      message: 'Gate operation completed as a no-op; project validators may be attached by a host adapter.'
    }),
    writeDocRecord: (context, workItem, summary) => createNoopOperationResult('doc', context, defaultConfig, {
      workItem,
      message: 'Doc operation completed as a no-op; no external documentation system was required.',
      extraEvidence: summary ? [createEvidence('handoff', summary, [])] : []
    }),
    runAtomizeAdapter: (context, request) => runDryRunAdapter('behavior.atomize', context, defaultConfig, request),
    runInfectAdapter: (context, request) => runDryRunAdapter('behavior.infect', context, defaultConfig, request),
    writeRegistryEntry: (context, entry) => writeRegistryEntry(context, defaultConfig, entry),
    readRegistryEntry: (context, entryId) => readRegistryEntry(context, defaultConfig, entryId)
  };
}

export function scaffoldLocalRepository(context, baseConfig = defaultLocalGitAdapterConfig) {
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

export function resolveRegistryPath(repositoryRoot, config = defaultLocalGitAdapterConfig) {
  return resolvePath(repositoryRoot, config.registryPath);
}

export function writeRegistryEntry(context, baseConfig, entry) {
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

export function readRegistryEntry(context, baseConfig, entryId) {
  const config = mergeConfig(baseConfig, context.config);
  const registryPath = resolveRegistryPath(context.repositoryRoot, config);
  const entryPath = path.join(registryPath, `${safeRegistryId(entryId)}.json`);
  if (!existsSync(entryPath)) {
    return null;
  }
  return JSON.parse(readFileSync(entryPath, 'utf8'));
}

export function resolveLegacyUri(context, baseConfig, legacyUri) {
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

export function runDryRunAdapter(behaviorId, context, baseConfig, request) {
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

function createNoopOperationResult(operation, context, baseConfig, details) {
  const config = mergeConfig(baseConfig, context.config);
  const artifactPaths = [];
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

function createResult({ ok, operation, context, config, mode, dryRunOverride, noop, messages, evidence, lockRecords = [], artifacts = [], extra = {} }) {
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

function createNoopLockRecord(context, workItem, files) {
  return {
    workItemId: workItem.workItemId,
    lockedBy: context.actor || 'local-git-adapter',
    lockedAt: context.now || new Date(0).toISOString(),
    files: [...files]
  };
}

function createEvidence(evidenceKind, summary, artifactPaths) {
  return { evidenceKind, summary, artifactPaths };
}

function createArtifact(artifactPath, artifactKind, producedBy) {
  return { artifactPath, artifactKind, producedBy };
}

function resolveInlineSource(request, resolvedLegacyUri) {
  if (typeof request.inlineSource === 'string') {
    return request.inlineSource;
  }
  if (resolvedLegacyUri.exists && resolvedLegacyUri.absolutePath) {
    return readFileSync(resolvedLegacyUri.absolutePath, 'utf8');
  }
  return '';
}

function mergeConfig(...configs) {
  return Object.freeze(Object.assign({}, defaultLocalGitAdapterConfig, ...configs));
}

function resolvePath(repositoryRoot, candidatePath) {
  return path.isAbsolute(candidatePath)
    ? path.normalize(candidatePath)
    : path.resolve(repositoryRoot, candidatePath);
}

function relativePath(repositoryRoot, targetPath) {
  const relative = path.relative(repositoryRoot, targetPath).replace(/\\/g, '/');
  return relative || '.';
}

function safeRegistryId(entryId) {
  return String(entryId).replace(/[^a-zA-Z0-9_.-]/g, '_');
}
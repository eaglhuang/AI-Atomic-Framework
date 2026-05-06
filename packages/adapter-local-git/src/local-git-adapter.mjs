import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

function createResult({ ok, operation, context, config, mode, noop, messages, evidence, lockRecords = [], artifacts = [] }) {
  return {
    ok,
    operation,
    mode,
    dryRun: config.dryRun,
    noop,
    messages,
    evidence,
    lockRecords,
    artifacts,
    registryPath: relativePath(context.repositoryRoot, resolveRegistryPath(context.repositoryRoot, config))
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
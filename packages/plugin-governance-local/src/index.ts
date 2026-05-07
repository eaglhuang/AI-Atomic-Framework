import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtifactRecord,
  ContextSummaryRecord,
  EvidenceRecord,
  RegistryDocument,
  RegistryEntryRecord,
  ScopeLockRecord,
  WorkItemRef
} from '@ai-atomic-framework/core';
import type {
  ArtifactStore,
  CapabilityResult,
  ContextSummaryStore,
  DocumentIndex,
  EvidenceStore,
  GovernanceAdapter,
  GovernanceLayout,
  GovernanceStores,
  LockStore,
  LogStore,
  MarkdownJsonStateStore,
  RegistryStore,
  RuleGuard,
  RunReportStore,
  ShardStore,
  TaskStore
} from '@ai-atomic-framework/plugin-sdk';

export const pluginGovernanceLocalPackage = {
  packageName: '@ai-atomic-framework/plugin-governance-local',
  packageRole: 'local-governance-reference-plugins',
  packageVersion: '0.0.0'
} as const;

export interface LocalGovernanceConfig {
  readonly repositoryRoot: string;
  readonly layout?: Partial<GovernanceLayout>;
  readonly now?: () => string;
}

export interface LocalGovernanceBootstrapOptions {
  readonly force?: boolean;
  readonly taskId?: string;
  readonly taskTitle?: string;
}

export interface LocalGovernanceBootstrapResult {
  readonly created: readonly string[];
  readonly unchanged: readonly string[];
  readonly adoptedProfile: 'default';
  readonly bootstrapTaskPath: string;
  readonly bootstrapLockPath: string;
  readonly agentInstructionsPath: string;
  readonly profilePath: string;
  readonly projectProbePath: string;
  readonly defaultGuardsPath: string;
  readonly evidencePath: string;
  readonly projectProbe: Readonly<Record<string, unknown>>;
  readonly recommendedPrompt: string;
}

const defaultBootstrapTaskId = 'BOOTSTRAP-0001';
const defaultBootstrapTaskTitle = 'Bootstrap ATM in this repository';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const templateRoot = path.join(repoRoot, 'templates', 'root-drop');
const defaultLocalGovernanceLayout: GovernanceLayout = {
  root: '.atm',
  taskStorePath: '.atm/tasks',
  lockStorePath: '.atm/locks',
  documentIndexPath: '.atm/index',
  shardStorePath: '.atm/shards',
  stateStorePath: '.atm/state',
  artifactStorePath: '.atm/artifacts',
  logStorePath: '.atm/logs',
  runReportStorePath: '.atm/reports',
  ruleGuardPath: '.atm/rules',
  evidenceStorePath: '.atm/evidence',
  registryStorePath: '.atm/registry',
  contextSummaryStorePath: '.atm/state/context-summary'
};
const templateFiles = [
  {
    source: 'AGENTS.md',
    target: 'AGENTS.md'
  },
  {
    source: path.join('.atm', 'profile', 'default.md'),
    target: path.join('.atm', 'profile', 'default.md')
  },
  {
    source: path.join('.atm', 'context', 'INITIAL_SUMMARY.md'),
    target: path.join('.atm', 'context', 'INITIAL_SUMMARY.md')
  }
] as const;

export function resolveLocalGovernanceLayout(layout: Partial<GovernanceLayout> = {}): GovernanceLayout {
  return {
    ...defaultLocalGovernanceLayout,
    ...layout
  };
}

export function createLocalGovernanceAdapter(config: LocalGovernanceConfig): GovernanceAdapter {
  const layout = resolveLocalGovernanceLayout(config.layout);
  return {
    adapterName: '@ai-atomic-framework/plugin-governance-local',
    layout,
    stores: createLocalGovernanceStores({ ...config, layout })
  };
}

export function createLocalGovernanceStores(config: LocalGovernanceConfig): GovernanceStores {
  const repositoryRoot = path.resolve(config.repositoryRoot);
  const layout = resolveLocalGovernanceLayout(config.layout);
  const now = config.now ?? (() => new Date().toISOString());

  const absoluteLayout = {
    taskStorePath: resolveRepoPath(repositoryRoot, layout.taskStorePath),
    lockStorePath: resolveRepoPath(repositoryRoot, layout.lockStorePath),
    documentIndexPath: resolveRepoPath(repositoryRoot, layout.documentIndexPath),
    shardStorePath: resolveRepoPath(repositoryRoot, layout.shardStorePath),
    stateStorePath: resolveRepoPath(repositoryRoot, layout.stateStorePath),
    artifactStorePath: resolveRepoPath(repositoryRoot, layout.artifactStorePath),
    logStorePath: resolveRepoPath(repositoryRoot, layout.logStorePath),
    runReportStorePath: resolveRepoPath(repositoryRoot, layout.runReportStorePath),
    ruleGuardPath: resolveRepoPath(repositoryRoot, layout.ruleGuardPath),
    evidenceStorePath: resolveRepoPath(repositoryRoot, layout.evidenceStorePath),
    registryStorePath: resolveRepoPath(repositoryRoot, layout.registryStorePath ?? '.atm/registry'),
    contextSummaryStorePath: resolveRepoPath(repositoryRoot, layout.contextSummaryStorePath ?? '.atm/state/context-summary')
  };

  function ensureAllDirectories() {
    for (const directoryPath of Object.values(absoluteLayout)) {
      mkdirSync(directoryPath, { recursive: true });
    }
  }

  function initializeStore(kind: string) {
    ensureAllDirectories();
    return capabilityResult(`Initialized ${kind}.`);
  }

  const taskStore: TaskStore = {
    initialize: () => initializeStore('task store'),
    healthCheck: () => capabilityResult(`Task store is ready at ${layout.taskStorePath}.`),
    createTask(workItem) {
      ensureAllDirectories();
      const filePath = path.join(absoluteLayout.taskStorePath, `${workItem.workItemId}.json`);
      writeJsonFile(filePath, {
        schemaVersion: 'atm.workItem.v0.1',
        id: workItem.workItemId,
        title: workItem.title,
        status: workItem.status
      });
      return workItem;
    },
    getTask(workItemId) {
      const filePath = path.join(absoluteLayout.taskStorePath, `${workItemId}.json`);
      if (!existsSync(filePath)) {
        return null;
      }
      return normalizeWorkItem(readJsonFile(filePath));
    },
    updateTaskStatus(workItemId, status) {
      const filePath = path.join(absoluteLayout.taskStorePath, `${workItemId}.json`);
      if (!existsSync(filePath)) {
        throw new Error(`Task not found: ${workItemId}`);
      }
      const current = readJsonFile(filePath) as Record<string, unknown>;
      const updated = {
        ...current,
        status
      };
      writeJsonFile(filePath, updated);
      return normalizeWorkItem(updated);
    },
    listTasks() {
      if (!existsSync(absoluteLayout.taskStorePath)) {
        return [];
      }
      return readdirSync(absoluteLayout.taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => normalizeWorkItem(readJsonFile(path.join(absoluteLayout.taskStorePath, entry))))
        .filter((entry) => entry !== null)
        .sort((left, right) => left.workItemId.localeCompare(right.workItemId));
    }
  };

  const lockStore: LockStore = {
    initialize: () => initializeStore('lock store'),
    healthCheck: () => capabilityResult(`Lock store is ready at ${layout.lockStorePath}.`),
    acquireLock(workItem, files, actor) {
      ensureAllDirectories();
      const record: ScopeLockRecord = {
        workItemId: workItem.workItemId,
        lockedBy: actor,
        lockedAt: now(),
        files: Array.from(new Set(files.map((filePath) => normalizeRelativePath(filePath)).filter(Boolean)))
      };
      writeJsonFile(path.join(absoluteLayout.lockStorePath, `${workItem.workItemId}.lock.json`), record);
      return record;
    },
    getLock(workItemId) {
      const filePath = path.join(absoluteLayout.lockStorePath, `${workItemId}.lock.json`);
      if (!existsSync(filePath)) {
        return null;
      }
      return readJsonFile(filePath) as ScopeLockRecord;
    },
    releaseLock(workItemId) {
      const filePath = path.join(absoluteLayout.lockStorePath, `${workItemId}.lock.json`);
      if (existsSync(filePath)) {
        writeJsonFile(filePath, {
          workItemId,
          releasedAt: now(),
          released: true
        });
      }
      return capabilityResult(`Released scope lock for ${workItemId}.`);
    }
  };

  const documentIndex: DocumentIndex = {
    initialize: () => initializeStore('document index'),
    healthCheck: () => capabilityResult(`Document index is ready at ${layout.documentIndexPath}.`),
    resolveDocumentId(documentId) {
      const indexDocument = readDocumentIndex(absoluteLayout.documentIndexPath);
      const exact = indexDocument.find((entry) => entry.documentId === documentId || entry.path === documentId);
      return exact?.path ?? null;
    },
    searchDocuments(query) {
      const normalizedQuery = String(query || '').trim().toLowerCase();
      if (!normalizedQuery) {
        return [];
      }
      return readDocumentIndex(absoluteLayout.documentIndexPath)
        .filter((entry) => JSON.stringify(entry).toLowerCase().includes(normalizedQuery))
        .map((entry) => entry.path);
    },
    updateDocument(documentPath, metadata) {
      ensureAllDirectories();
      const indexPath = path.join(absoluteLayout.documentIndexPath, 'documents.json');
      const entries = readDocumentIndex(absoluteLayout.documentIndexPath).filter((entry) => entry.path !== documentPath);
      entries.push({
        documentId: String((metadata as Record<string, unknown>).documentId ?? documentPath),
        path: normalizeRelativePath(documentPath),
        metadata
      });
      writeJsonFile(indexPath, entries);
      return capabilityResult(`Indexed document ${documentPath}.`);
    }
  };

  const shardStore: ShardStore = {
    initialize: () => initializeStore('shard store'),
    healthCheck: () => capabilityResult(`Shard store is ready at ${layout.shardStorePath}.`),
    readShard(shardPath) {
      const absolutePath = resolveRepoPath(repositoryRoot, shardPath);
      if (!existsSync(absolutePath)) {
        return null;
      }
      return readUnknownFile(absolutePath);
    },
    writeShard(shardPath, value) {
      ensureAllDirectories();
      const absolutePath = resolveRepoPath(repositoryRoot, shardPath);
      writeUnknownFile(absolutePath, value);
      return capabilityResult(`Wrote shard ${normalizeRelativePath(shardPath)}.`);
    },
    rebuildIndex(indexPath) {
      ensureAllDirectories();
      const absoluteIndexPath = resolveRepoPath(repositoryRoot, indexPath);
      const entries = listFilesRecursive(absoluteLayout.shardStorePath).map((filePath) => relativePathFrom(repositoryRoot, filePath));
      writeJsonFile(absoluteIndexPath, {
        updatedAt: now(),
        entries
      });
      return capabilityResult(`Rebuilt shard index ${normalizeRelativePath(indexPath)}.`);
    }
  };

  const artifactStore: ArtifactStore = {
    initialize: () => initializeStore('artifact store'),
    healthCheck: () => capabilityResult(`Artifact store is ready at ${layout.artifactStorePath}.`),
    writeArtifact(record, content) {
      ensureAllDirectories();
      const targetPath = resolveRepoPath(repositoryRoot, record.artifactPath);
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeContentFile(targetPath, content);
      appendManifestRecord(path.join(absoluteLayout.artifactStorePath, 'manifest.json'), record);
      return record;
    },
    listArtifacts(workItemId) {
      return readManifestRecords(path.join(absoluteLayout.artifactStorePath, 'manifest.json'))
        .filter((record) => record.artifactPath.includes(workItemId));
    }
  };

  const logStore: LogStore = {
    initialize: () => initializeStore('log store'),
    healthCheck: () => capabilityResult(`Log store is ready at ${layout.logStorePath}.`),
    appendLog(workItemId, message) {
      ensureAllDirectories();
      const filePath = path.join(absoluteLayout.logStorePath, `${workItemId}.log`);
      const prefix = existsSync(filePath) ? '' : '';
      writeFileSync(filePath, `${prefix}${existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''}${message}\n`, 'utf8');
      return capabilityResult(`Appended log for ${workItemId}.`);
    },
    readLog(workItemId) {
      const filePath = path.join(absoluteLayout.logStorePath, `${workItemId}.log`);
      if (!existsSync(filePath)) {
        return '';
      }
      return readFileSync(filePath, 'utf8');
    }
  };

  const runReportStore: RunReportStore = {
    initialize: () => initializeStore('run report store'),
    healthCheck: () => capabilityResult(`Run report store is ready at ${layout.runReportStorePath}.`),
    writeRunReport(reportId, report) {
      ensureAllDirectories();
      const filePath = path.join(absoluteLayout.runReportStorePath, withJsonExtension(reportId));
      writeJsonFile(filePath, report);
      return capabilityResult(`Wrote run report ${reportId}.`);
    },
    readRunReport(reportId) {
      const filePath = path.join(absoluteLayout.runReportStorePath, withJsonExtension(reportId));
      if (!existsSync(filePath)) {
        return null;
      }
      return readJsonFile(filePath) as Readonly<Record<string, unknown>>;
    }
  };

  const stateStore: MarkdownJsonStateStore = {
    initialize: () => initializeStore('state store'),
    healthCheck: () => capabilityResult(`State store is ready at ${layout.stateStorePath}.`),
    readMarkdown(filePath) {
      const absolutePath = resolveRepoPath(repositoryRoot, filePath);
      if (!existsSync(absolutePath)) {
        return '';
      }
      return readFileSync(absolutePath, 'utf8');
    },
    writeMarkdown(filePath, content) {
      const absolutePath = resolveRepoPath(repositoryRoot, filePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, 'utf8');
      return capabilityResult(`Wrote markdown state ${normalizeRelativePath(filePath)}.`);
    },
    readJson(filePath) {
      const absolutePath = resolveRepoPath(repositoryRoot, filePath);
      if (!existsSync(absolutePath)) {
        return null;
      }
      return readJsonFile(absolutePath);
    },
    writeJson(filePath, value) {
      const absolutePath = resolveRepoPath(repositoryRoot, filePath);
      writeJsonFile(absolutePath, value);
      return capabilityResult(`Wrote JSON state ${normalizeRelativePath(filePath)}.`);
    }
  };

  const ruleGuard: RuleGuard = {
    initialize: () => initializeStore('rule guard'),
    healthCheck: () => capabilityResult(`Rule guard is ready at ${layout.ruleGuardPath}.`),
    runGuard(guardId, context) {
      ensureAllDirectories();
      const artifactPath = path.join(layout.ruleGuardPath, withJsonExtension(guardId));
      writeJsonFile(resolveRepoPath(repositoryRoot, artifactPath), {
        guardId,
        ok: true,
        generatedAt: now(),
        context
      });
      const artifactRecord: ArtifactRecord = {
        artifactPath,
        artifactKind: 'report',
        producedBy: '@ai-atomic-framework/plugin-governance-local:rule-guard'
      };
      return capabilityResult(`Recorded rule guard result for ${guardId}.`, [artifactRecord]);
    }
  };

  const evidenceStore: EvidenceStore = {
    initialize: () => initializeStore('evidence store'),
    healthCheck: () => capabilityResult(`Evidence store is ready at ${layout.evidenceStorePath}.`),
    writeEvidence(workItemId, evidence) {
      ensureAllDirectories();
      const filePath = path.join(absoluteLayout.evidenceStorePath, `${workItemId}.json`);
      const existing = readEvidenceRecords(filePath);
      existing.push(evidence);
      writeJsonFile(filePath, existing);
      return evidence;
    },
    listEvidence(workItemId) {
      return readEvidenceRecords(path.join(absoluteLayout.evidenceStorePath, `${workItemId}.json`));
    }
  };

  const registryStore: RegistryStore = {
    initialize: () => initializeStore('registry store'),
    healthCheck: () => capabilityResult(`Registry store is ready at ${layout.registryStorePath ?? '.atm/registry'}.`),
    readRegistry() {
      ensureAllDirectories();
      const filePath = path.join(absoluteLayout.registryStorePath, 'registry.json');
      if (!existsSync(filePath)) {
        const emptyRegistry = createEmptyRegistry(now());
        writeJsonFile(filePath, emptyRegistry);
        return emptyRegistry;
      }
      return readJsonFile(filePath) as RegistryDocument;
    },
    writeRegistryEntry(entry) {
      const filePath = path.join(absoluteLayout.registryStorePath, 'registry.json');
      const registry = registryStore.readRegistry();
      const nextEntries = registry.entries.filter((candidate) => ('atomId' in candidate ? candidate.atomId : (candidate as { mapId?: string }).mapId) !== entry.atomId);
      nextEntries.push(entry);
      writeJsonFile(filePath, {
        ...registry,
        generatedAt: now(),
        entries: nextEntries
      });
      return entry;
    }
  };

  const contextSummaryStore: ContextSummaryStore = {
    initialize: () => initializeStore('context summary store'),
    healthCheck: () => capabilityResult(`Context summary store is ready at ${layout.contextSummaryStorePath ?? '.atm/state/context-summary'}.`),
    writeSummary(summary) {
      ensureAllDirectories();
      const filePath = path.join(absoluteLayout.contextSummaryStorePath, `${summary.workItemId}.json`);
      writeJsonFile(filePath, summary);
      return summary;
    },
    readSummary(workItemId) {
      const filePath = path.join(absoluteLayout.contextSummaryStorePath, `${workItemId}.json`);
      if (!existsSync(filePath)) {
        return null;
      }
      return readJsonFile(filePath) as ContextSummaryRecord;
    }
  };

  return {
    taskStore,
    lockStore,
    documentIndex,
    shardStore,
    artifactStore,
    logStore,
    runReportStore,
    stateStore,
    ruleGuard,
    evidenceStore,
    registryStore,
    contextSummaryStore
  };
}

export function adoptLocalGovernanceBundle(cwd: string, options: LocalGovernanceBootstrapOptions = {}): LocalGovernanceBootstrapResult {
  const force = options.force === true;
  const taskId = typeof options.taskId === 'string' && options.taskId.trim().length > 0
    ? options.taskId.trim()
    : defaultBootstrapTaskId;
  const taskTitle = typeof options.taskTitle === 'string' && options.taskTitle.trim().length > 0
    ? options.taskTitle.trim()
    : defaultBootstrapTaskTitle;
  const created: string[] = [];
  const unchanged: string[] = [];
  const paths = createBootstrapPaths(cwd, taskId);
  const stores = createLocalGovernanceStores({ repositoryRoot: cwd });

  for (const directoryPath of Object.values(paths.directories)) {
    ensureDirectory(directoryPath, cwd, created, unchanged);
  }

  stores.documentIndex.initialize?.();
  stores.shardStore.initialize?.();
  stores.artifactStore.initialize?.();
  stores.logStore.initialize?.();
  stores.runReportStore?.initialize?.();
  stores.ruleGuard.initialize?.();
  stores.evidenceStore.initialize?.();

  const recommendedPrompt = createRecommendedPrompt(taskId);
  const projectProbe = probeRepository(cwd, recommendedPrompt);
  const defaultGuards = createDefaultGuards(projectProbe);

  writeJson(paths.projectProbePath, projectProbe, cwd, force, created, unchanged);
  writeJson(paths.defaultGuardsPath, defaultGuards, cwd, force, created, unchanged);
  writeJson(paths.taskPath, createBootstrapTask(taskId, taskTitle, projectProbe, paths), cwd, force, created, unchanged);
  writeJson(paths.lockPath, createBootstrapLock(taskId, paths), cwd, force, created, unchanged);
  writeJson(paths.evidencePath, createBootstrapEvidence(projectProbe, defaultGuards, paths), cwd, force, created, unchanged);

  const templateTokens = {
    RECOMMENDED_PROMPT: recommendedPrompt,
    BOOTSTRAP_TASK_PATH: relativePathFrom(cwd, paths.taskPath),
    BOOTSTRAP_LOCK_PATH: relativePathFrom(cwd, paths.lockPath),
    BOOTSTRAP_PROFILE_PATH: relativePathFrom(cwd, paths.profilePath),
    PROJECT_PROBE_PATH: relativePathFrom(cwd, paths.projectProbePath),
    DEFAULT_GUARDS_PATH: relativePathFrom(cwd, paths.defaultGuardsPath),
    BOOTSTRAP_EVIDENCE_PATH: relativePathFrom(cwd, paths.evidencePath),
    REPOSITORY_KIND: String(projectProbe.repositoryKind ?? 'generic-repository'),
    HOST_WORKFLOW: String(projectProbe.hostWorkflow ?? 'manual'),
    PACKAGE_MANAGER: String(projectProbe.packageManager ?? 'none')
  };

  for (const templateFile of templateFiles) {
    writeTemplate(
      path.join(templateRoot, templateFile.source),
      path.join(cwd, templateFile.target),
      templateTokens,
      cwd,
      force,
      created,
      unchanged
    );
  }

  return {
    created,
    unchanged,
    adoptedProfile: 'default',
    bootstrapTaskPath: relativePathFrom(cwd, paths.taskPath),
    bootstrapLockPath: relativePathFrom(cwd, paths.lockPath),
    agentInstructionsPath: relativePathFrom(cwd, paths.agentInstructionsPath),
    profilePath: relativePathFrom(cwd, paths.profilePath),
    projectProbePath: relativePathFrom(cwd, paths.projectProbePath),
    defaultGuardsPath: relativePathFrom(cwd, paths.defaultGuardsPath),
    evidencePath: relativePathFrom(cwd, paths.evidencePath),
    projectProbe,
    recommendedPrompt
  };
}

export function createOfficialBootstrapCommand(commandCwd = '.'): string {
  return `node packages/cli/src/atm.mjs bootstrap --cwd ${commandCwd} --task "${defaultBootstrapTaskTitle}"`;
}

export function createRecommendedPrompt(taskId = defaultBootstrapTaskId): string {
  return `Read README.md if present, then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/${taskId}.json. Continue the bootstrap task without changing the host workflow, and write evidence to .atm/evidence/${taskId}.json.`;
}

export function createSelfHostingAlphaPrompt(): string {
  return `Read README.md. If .atm/config.json is missing, run "${createOfficialBootstrapCommand('.')}" from the repository root. Then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/${defaultBootstrapTaskId}.json, complete the bootstrap task, run the first smoke against examples/hello-world/atoms/hello-world.atom.json, and write artifact, log, evidence, and context summary files under .atm/.`;
}

function createBootstrapPaths(cwd: string, taskId: string) {
  const atmRoot = path.join(cwd, '.atm');
  return {
    agentInstructionsPath: path.join(cwd, 'AGENTS.md'),
    profilePath: path.join(atmRoot, 'profile', 'default.md'),
    projectProbePath: path.join(atmRoot, 'state', 'project-probe.json'),
    defaultGuardsPath: path.join(atmRoot, 'state', 'default-guards.json'),
    taskPath: path.join(atmRoot, 'tasks', `${taskId}.json`),
    lockPath: path.join(atmRoot, 'locks', `${taskId}.lock.json`),
    evidencePath: path.join(atmRoot, 'evidence', `${taskId}.json`),
    directories: {
      profile: path.join(atmRoot, 'profile'),
      state: path.join(atmRoot, 'state'),
      tasks: path.join(atmRoot, 'tasks'),
      locks: path.join(atmRoot, 'locks'),
      artifacts: path.join(atmRoot, 'artifacts'),
      logs: path.join(atmRoot, 'logs'),
      evidence: path.join(atmRoot, 'evidence'),
      context: path.join(atmRoot, 'context'),
      reports: path.join(atmRoot, 'reports'),
      index: path.join(atmRoot, 'index'),
      shards: path.join(atmRoot, 'shards'),
      rules: path.join(atmRoot, 'rules'),
      registry: path.join(atmRoot, 'registry')
    }
  };
}

function createBootstrapTask(taskId: string, taskTitle: string, projectProbe: Readonly<Record<string, unknown>>, paths: ReturnType<typeof createBootstrapPaths>) {
  return {
    schemaVersion: 'atm.workItem.v0.1',
    id: taskId,
    title: taskTitle,
    status: 'open',
    taskKind: 'bootstrap',
    repositoryKind: projectProbe.repositoryKind,
    summary: 'Establish the default ATM bootstrap pack, verify the host workflow, and leave initial evidence for the next agent run.',
    scope: [
      'AGENTS.md',
      relativePathFrom(path.dirname(paths.taskPath), paths.taskPath),
      relativePathFrom(path.dirname(paths.lockPath), paths.lockPath)
    ],
    guardPaths: [
      relativePathFrom(path.dirname(paths.taskPath), paths.defaultGuardsPath)
    ],
    evidencePath: relativePathFrom(path.dirname(paths.taskPath), paths.evidencePath),
    nextPrompt: createRecommendedPrompt(taskId)
  };
}

function createBootstrapLock(taskId: string, paths: ReturnType<typeof createBootstrapPaths>) {
  return {
    schemaVersion: 'atm.scopeLock.v0.1',
    taskId,
    status: 'open',
    files: [
      'AGENTS.md',
      '.atm/config.json',
      relativePathFrom(path.dirname(paths.lockPath), paths.profilePath),
      relativePathFrom(path.dirname(paths.lockPath), paths.projectProbePath),
      relativePathFrom(path.dirname(paths.lockPath), paths.defaultGuardsPath),
      relativePathFrom(path.dirname(paths.lockPath), paths.taskPath),
      relativePathFrom(path.dirname(paths.lockPath), paths.evidencePath)
    ]
  };
}

function createBootstrapEvidence(projectProbe: Readonly<Record<string, unknown>>, defaultGuards: { guards: readonly { id: string }[] }, paths: ReturnType<typeof createBootstrapPaths>) {
  return {
    schemaVersion: 'atm.evidence.v0.1',
    taskId: defaultBootstrapTaskId,
    status: 'seeded',
    summary: 'Default ATM bootstrap pack created.',
    repositoryKind: projectProbe.repositoryKind,
    packageManager: projectProbe.packageManager,
    recommendedPrompt: createRecommendedPrompt(),
    guardIds: defaultGuards.guards.map((guard) => guard.id),
    artifactDirectories: [
      relativePathFrom(path.dirname(paths.evidencePath), paths.directories.artifacts),
      relativePathFrom(path.dirname(paths.evidencePath), paths.directories.logs),
      relativePathFrom(path.dirname(paths.evidencePath), paths.directories.reports)
    ]
  };
}

function createDefaultGuards(projectProbe: Readonly<Record<string, unknown>>) {
  return {
    schemaVersion: 'atm.defaultGuards.v0.1',
    repositoryKind: projectProbe.repositoryKind,
    guards: [
      {
        id: 'preserve-host-workflow',
        summary: 'Do not invent a build step, package manager, or runtime workflow that the host repository does not already use.'
      },
      {
        id: 'lock-before-edit',
        summary: 'Create or respect a scope lock before editing files outside the bootstrap pack.'
      },
      {
        id: 'evidence-after-change',
        summary: 'Record validation evidence and a short context summary before declaring the task done.'
      }
    ]
  };
}

function probeRepository(cwd: string, recommendedPrompt: string) {
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    : null;
  const scripts = packageJson?.scripts || {};
  const hasIndexHtml = existsSync(path.join(cwd, 'index.html'));
  const hasArticlesIndex = existsSync(path.join(cwd, 'articles', 'index.html'));
  const hasAssetsCss = existsSync(path.join(cwd, 'assets', 'css'));
  const topLevelEntries = existsSync(cwd)
    ? readdirSync(cwd, { withFileTypes: true }).map((entry) => entry.name).sort()
    : [];

  let repositoryKind = 'generic-repository';
  if (packageJson) {
    repositoryKind = 'javascript-package';
  } else if (hasIndexHtml || hasArticlesIndex || hasAssetsCss) {
    repositoryKind = 'static-site';
  }

  return {
    schemaVersion: 'atm.projectProbe.v0.1',
    repositoryKind,
    packageManager: detectPackageManager(cwd, packageJson),
    hostWorkflow: packageJson ? 'script-driven' : (repositoryKind === 'static-site' ? 'file-publish' : 'manual'),
    sourceControl: existsSync(path.join(cwd, '.git')) ? 'git' : 'filesystem',
    detectedFiles: topLevelEntries,
    commands: {
      test: scripts.test ? createPackageManagerCommand(cwd, packageJson, 'test') : null,
      typecheck: scripts.typecheck ? createPackageManagerCommand(cwd, packageJson, 'typecheck') : null,
      lint: scripts.lint ? createPackageManagerCommand(cwd, packageJson, 'lint') : null
    },
    recommendedPrompt
  };
}

function detectPackageManager(cwd: string, packageJson: Record<string, unknown> | null) {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(path.join(cwd, 'package-lock.json')) || packageJson) {
    return 'npm';
  }
  return 'none';
}

function createPackageManagerCommand(cwd: string, packageJson: Record<string, unknown> | null, scriptName: string) {
  const manager = detectPackageManager(cwd, packageJson);
  if (manager === 'pnpm') {
    return `pnpm run ${scriptName}`;
  }
  if (manager === 'yarn') {
    return `yarn ${scriptName}`;
  }
  return `npm run ${scriptName}`;
}

function ensureDirectory(directoryPath: string, cwd: string, created: string[], unchanged: string[]) {
  if (existsSync(directoryPath)) {
    unchanged.push(relativePathFrom(cwd, directoryPath));
    return;
  }
  mkdirSync(directoryPath, { recursive: true });
  created.push(relativePathFrom(cwd, directoryPath));
}

function writeTemplate(sourcePath: string, targetPath: string, tokens: Record<string, string>, cwd: string, force: boolean, created: string[], unchanged: string[]) {
  const rendered = renderTemplate(readFileSync(sourcePath, 'utf8'), tokens);
  writeText(targetPath, rendered, cwd, force, created, unchanged);
}

function writeJson(targetPath: string, value: unknown, cwd: string, force: boolean, created: string[], unchanged: string[]) {
  if (existsSync(targetPath) && !force) {
    unchanged.push(relativePathFrom(cwd, targetPath));
    return;
  }
  writeJsonFile(targetPath, value);
  created.push(relativePathFrom(cwd, targetPath));
}

function writeText(targetPath: string, value: string, cwd: string, force: boolean, created: string[], unchanged: string[]) {
  if (existsSync(targetPath) && !force) {
    unchanged.push(relativePathFrom(cwd, targetPath));
    return;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, value, 'utf8');
  created.push(relativePathFrom(cwd, targetPath));
}

function renderTemplate(template: string, tokens: Record<string, string>) {
  let rendered = template;
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }
  return rendered;
}

function capabilityResult(text: string, artifacts: readonly ArtifactRecord[] = [], evidence: readonly EvidenceRecord[] = []): CapabilityResult {
  return {
    ok: true,
    messages: [text],
    artifacts,
    evidence
  };
}

function resolveRepoPath(repositoryRoot: string, filePath: string): string {
  return path.resolve(repositoryRoot, filePath);
}

function relativePathFrom(basePath: string, absolutePath: string): string {
  return path.relative(basePath, absolutePath).replace(/\\/g, '/');
}

function normalizeRelativePath(filePath: string): string {
  return String(filePath || '').replace(/\\/g, '/');
}

function writeJsonFile(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonFile(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readUnknownFile(filePath: string): unknown {
  if (filePath.endsWith('.json')) {
    return readJsonFile(filePath);
  }
  return readFileSync(filePath, 'utf8');
}

function writeUnknownFile(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (typeof value === 'string') {
    writeFileSync(filePath, value, 'utf8');
    return;
  }
  writeJsonFile(filePath, value);
}

function withJsonExtension(name: string): string {
  return name.endsWith('.json') ? name : `${name}.json`;
}

function appendManifestRecord(filePath: string, record: ArtifactRecord) {
  const manifest = readManifestRecords(filePath).filter((entry) => entry.artifactPath !== record.artifactPath);
  manifest.push(record);
  writeJsonFile(filePath, manifest);
}

function readManifestRecords(filePath: string): ArtifactRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const parsed = readJsonFile(filePath);
  return Array.isArray(parsed) ? parsed as ArtifactRecord[] : [];
}

function writeContentFile(filePath: string, content: string | Uint8Array) {
  if (typeof content === 'string') {
    writeFileSync(filePath, content, 'utf8');
    return;
  }
  writeFileSync(filePath, content);
}

function readDocumentIndex(documentIndexPath: string): Array<{ documentId: string; path: string; metadata: Readonly<Record<string, unknown>> }> {
  const filePath = path.join(documentIndexPath, 'documents.json');
  if (!existsSync(filePath)) {
    return [];
  }
  const parsed = readJsonFile(filePath);
  return Array.isArray(parsed) ? parsed as Array<{ documentId: string; path: string; metadata: Readonly<Record<string, unknown>> }> : [];
}

function listFilesRecursive(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      results.push(absolutePath);
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function readEvidenceRecords(filePath: string): EvidenceRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const parsed = readJsonFile(filePath);
  if (Array.isArray(parsed)) {
    return parsed as EvidenceRecord[];
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { evidence?: unknown[] }).evidence)) {
    return (parsed as { evidence: EvidenceRecord[] }).evidence;
  }
  if (parsed && typeof parsed === 'object' && 'evidenceKind' in (parsed as Record<string, unknown>)) {
    return [parsed as EvidenceRecord];
  }
  return [];
}

function normalizeWorkItem(value: unknown): WorkItemRef | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const workItemId = String(candidate.workItemId ?? candidate.id ?? candidate.taskId ?? '').trim();
  const title = String(candidate.title ?? '').trim();
  const status = String(candidate.status ?? '').trim();
  if (!workItemId || !title || !status) {
    return null;
  }
  return {
    workItemId,
    title,
    status: status as WorkItemRef['status']
  };
}

function createEmptyRegistry(timestamp: string): RegistryDocument {
  return {
    schemaId: 'atm.registry',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Local governance registry initialized.'
    },
    registryId: 'ATM-LOCAL-REGISTRY',
    generatedAt: timestamp,
    entries: []
  };
}
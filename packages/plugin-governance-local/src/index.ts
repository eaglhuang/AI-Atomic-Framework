// Transitional alpha implementation: public contracts are checked while legacy loose runtime code is tightened.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtifactRecord,
  ContextSummaryRecord,
  EvidenceRecord,
  RegistryDocument,
  RegistryEntryRecord,
  WorkItemRef
} from '@ai-atomic-framework/core';
import type {
  CapabilityResult,
  ContextBudgetEvaluationInput,
  ContextBudgetEvaluationResult,
  ContextBudgetGuard,
  ContextBudgetPolicy,
  ContextSummaryStore,
  GovernanceAdapter,
  GovernanceLayout,
} from '@ai-atomic-framework/plugin-sdk';
import { resolveLocalGovernanceLayout } from './layout.ts';
import { createLocalGovernanceStores } from './stores.ts';

export { resolveLocalGovernanceLayout } from './layout.ts';
export { createLocalGovernanceStores } from './stores.ts';

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
  readonly contextBudgetPolicyPath: string;
  readonly contextBudgetReportPath: string;
  readonly contextBudgetSummaryPath?: string;
  readonly contextSummaryPath: string;
  readonly contextSummaryMarkdownPath: string;
  readonly continuationReportPath: string;
  readonly projectProbe: Readonly<Record<string, unknown>>;
  readonly recommendedPrompt: string;
}

export interface ContinuationContractInput {
  readonly workItemId: string;
  readonly generatedAt: string;
  readonly summaryId?: string;
  readonly summary: string;
  readonly nextActions: readonly string[];
  readonly artifactPaths?: readonly string[];
  readonly evidencePaths?: readonly string[];
  readonly reportPaths?: readonly string[];
  readonly authoredBy?: string;
  readonly handoffKind?: ContextSummaryRecord['handoffKind'];
  readonly continuationGoal?: string;
  readonly resumePrompt?: string;
  readonly resumeCommand?: readonly string[];
  readonly budgetDecision?: ContextSummaryRecord['budgetDecision'];
  readonly hardStop?: boolean;
}

const defaultBootstrapTaskId = 'BOOTSTRAP-0001';
const defaultBootstrapTaskTitle = 'Bootstrap ATM in this repository';
const currentLayoutVersion = 2;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const templateRoot = path.join(repoRoot, 'templates', 'root-drop');
const templateFiles = [
  {
    source: 'AGENTS.md',
    target: 'AGENTS.md'
  },
  {
    source: path.join('.atm', 'profile', 'default.md'),
    target: path.join('.atm', 'runtime', 'profile', 'default.md')
  },
  {
    source: path.join('.atm', 'context', 'INITIAL_SUMMARY.md'),
    target: path.join('.atm', 'history', 'handoff', 'INITIAL_SUMMARY.md')
  }
] as const;

export function createLocalGovernanceAdapter(config: LocalGovernanceConfig): GovernanceAdapter {
  const layout = resolveLocalGovernanceLayout(config.layout);
  return {
    adapterName: '@ai-atomic-framework/plugin-governance-local',
    layout,
    stores: createLocalGovernanceStores({ ...config, layout })
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
  const migration = migrateLegacyBootstrapLayout(cwd, taskId, paths, force, created, unchanged);
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
  stores.contextBudgetGuard?.initialize?.();
  stores.contextSummaryStore?.initialize?.();

  const recommendedPrompt = createRecommendedPrompt(taskId);
  const projectProbe = probeRepository(cwd, recommendedPrompt);
  const defaultGuards = createDefaultGuards(projectProbe);
  const defaultContextBudgetPolicy = createDefaultContextBudgetPolicy(projectProbe.generatedAt ?? new Date().toISOString());
  const bootstrapBudgetId = `bootstrap/${taskId}`;
  const contextBudgetReportPath = path.join('.atm', 'history', 'reports', 'context-budget', `bootstrap-${sanitizeBudgetFileId(bootstrapBudgetId)}.json`);
  const contextBudgetSummaryPath = relativePathFrom(cwd, paths.contextBudgetSummaryPath);
  const continuationReportPath = path.join('.atm', 'history', 'reports', 'continuation', `${taskId}.json`);
  const contextSummaryPath = relativePathFrom(cwd, paths.contextSummaryPath);
  const contextSummaryMarkdownPath = relativePathFrom(cwd, paths.contextSummaryMarkdownPath);
  const bootstrapBudgetInput = {
    budgetId: bootstrapBudgetId,
    workItemId: taskId,
    estimatedTokens: estimateContextBudgetTokens(projectProbe, defaultGuards, recommendedPrompt, templateFiles.map((entry) => entry.target)),
    inlineArtifacts: 0,
    requestedSummary: 'Continue from the stored bootstrap summary and evidence paths instead of replaying the full bootstrap probe inline.'
  } satisfies ContextBudgetEvaluationInput;
  const bootstrapBudgetEvaluation = evaluateContextBudget(defaultContextBudgetPolicy, bootstrapBudgetInput, projectProbe.generatedAt ?? new Date().toISOString());
  const continuationInput: ContinuationContractInput = {
    workItemId: taskId,
    generatedAt: projectProbe.generatedAt ?? new Date().toISOString(),
    summaryId: `summary.${sanitizeBudgetFileId(taskId).toLowerCase()}`,
    summary: 'Default ATM bootstrap pack created and linked to evidence, context budget, and the next continuation prompt.',
    nextActions: [
      `Read .atm/history/tasks/${taskId}.json and .atm/runtime/profile/default.md.`,
      'Run node atm.mjs next --json and execute exactly the returned next action.',
      'Record the first smoke artifact, log, evidence, and handoff before closing the work item.'
    ],
    artifactPaths: ['.atm/history/artifacts', '.atm/history/logs', '.atm/history/reports'],
    evidencePaths: [relativePathFrom(cwd, paths.evidencePath)],
    reportPaths: [normalizeRelativePath(contextBudgetReportPath), normalizeRelativePath(continuationReportPath)],
    authoredBy: '@ai-atomic-framework/plugin-governance-local',
    handoffKind: 'bootstrap',
    continuationGoal: 'Resume bootstrap from the generated task, profile, evidence, and budget surfaces.',
    resumePrompt: recommendedPrompt,
    resumeCommand: ['node', 'atm.mjs', 'next', '--json'],
    budgetDecision: bootstrapBudgetEvaluation.decision,
    hardStop: bootstrapBudgetEvaluation.decision === 'hard-stop'
  };
  const continuationSummary: ContextSummaryRecord = {
    ...createContinuationSummaryRecord(continuationInput),
    summaryMarkdownPath: normalizeRelativePath(contextSummaryMarkdownPath)
  };
  const bootstrapEvidence = {
    ...createBootstrapEvidence(taskId, projectProbe, defaultGuards, paths),
    contextBudgetReportPath: normalizeRelativePath(contextBudgetReportPath),
    contextBudgetSummaryPath: bootstrapBudgetEvaluation.decision === 'pass' ? null : normalizeRelativePath(contextBudgetSummaryPath),
    contextSummaryPath: normalizeRelativePath(contextSummaryPath),
    contextSummaryMarkdownPath: normalizeRelativePath(contextSummaryMarkdownPath),
    continuationReportPath: normalizeRelativePath(continuationReportPath),
    budgetDecision: bootstrapBudgetEvaluation.decision,
    continuationGoal: continuationInput.continuationGoal
  };

  writeJson(paths.configPath, createBootstrapConfig(taskId), cwd, force, created, unchanged);
  writeJson(paths.currentTaskPath, createCurrentTaskState(taskId, taskTitle, paths), cwd, force, created, unchanged);
  writeJson(paths.projectProbePath, projectProbe, cwd, force, created, unchanged);
  writeJson(paths.defaultGuardsPath, defaultGuards, cwd, force, created, unchanged);
  writeJson(paths.contextBudgetPolicyPath, defaultContextBudgetPolicy, cwd, force, created, unchanged);
  writeJson(paths.taskPath, createBootstrapTask(taskId, taskTitle, projectProbe, paths), cwd, force, created, unchanged);
  writeJson(paths.lockPath, createBootstrapLock(taskId, paths), cwd, force, created, unchanged);
  writeJson(paths.evidencePath, bootstrapEvidence, cwd, force, created, unchanged);
  writeJson(resolveRepoPath(cwd, contextBudgetReportPath), {
    budgetId: bootstrapBudgetId,
    workItemId: taskId,
    policyId: defaultContextBudgetPolicy.policyId,
    decision: bootstrapBudgetEvaluation.decision,
    estimatedTokens: bootstrapBudgetEvaluation.estimatedTokens,
    inlineArtifacts: bootstrapBudgetEvaluation.inlineArtifacts,
    generatedAt: bootstrapBudgetEvaluation.generatedAt,
    reason: bootstrapBudgetEvaluation.reason
  }, cwd, force, created, unchanged);
  if (bootstrapBudgetEvaluation.decision !== 'pass') {
    writeText(resolveRepoPath(cwd, contextBudgetSummaryPath), createContextBudgetSummary(defaultContextBudgetPolicy, bootstrapBudgetInput, bootstrapBudgetEvaluation), cwd, force, created, unchanged);
  }
  writeJson(resolveRepoPath(cwd, continuationReportPath), createContinuationRunReport(`continuation/${taskId}`, continuationInput), cwd, force, created, unchanged);
  writeJson(resolveRepoPath(cwd, contextSummaryPath), continuationSummary, cwd, force, created, unchanged);
  writeText(resolveRepoPath(cwd, contextSummaryMarkdownPath), renderContextSummaryMarkdown(continuationSummary), cwd, force, created, unchanged);
  if (migration !== null) {
    writeJson(migration.path, migration.report, cwd, force, created, unchanged);
  }

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
    contextBudgetPolicyPath: relativePathFrom(cwd, paths.contextBudgetPolicyPath),
    contextBudgetReportPath: normalizeRelativePath(contextBudgetReportPath),
    contextBudgetSummaryPath: bootstrapBudgetEvaluation.decision === 'pass' ? undefined : normalizeRelativePath(contextBudgetSummaryPath),
    contextSummaryPath: normalizeRelativePath(contextSummaryPath),
    contextSummaryMarkdownPath: normalizeRelativePath(contextSummaryMarkdownPath),
    continuationReportPath: normalizeRelativePath(continuationReportPath),
    projectProbe,
    recommendedPrompt
  };
}

export function createOfficialBootstrapCommand(commandCwd = '.'): string {
  return `node atm.mjs bootstrap --cwd ${commandCwd} --task "${defaultBootstrapTaskTitle}"`;
}

export function createRecommendedPrompt(taskId = defaultBootstrapTaskId): string {
  return `Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action. Use .atm/history/tasks/${taskId}.json, .atm/runtime/profile/default.md, and .atm/history/evidence/${taskId}.json only as supporting runtime state.`;
}

export function createSelfHostingAlphaPrompt(): string {
  return 'Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.';
}

export function estimateContextBudgetTokens(...values: readonly unknown[]): number {
  const characterCount = values.reduce<number>((total, value) => total + serializeContextValue(value).length, 0);
  return Math.max(1, Math.ceil(characterCount / 4));
}

export function createContinuationSummaryRecord(input: ContinuationContractInput): ContextSummaryRecord {
  return {
    summaryId: input.summaryId,
    workItemId: input.workItemId,
    summary: input.summary,
    nextActions: [...input.nextActions],
    generatedAt: input.generatedAt,
    artifactPaths: uniqueNormalizedPaths(input.artifactPaths),
    evidencePaths: uniqueNormalizedPaths(input.evidencePaths),
    reportPaths: uniqueNormalizedPaths(input.reportPaths),
    authoredBy: input.authoredBy,
    handoffKind: input.handoffKind ?? 'continuation',
    continuationGoal: input.continuationGoal,
    resumePrompt: input.resumePrompt,
    resumeCommand: input.resumeCommand ? [...input.resumeCommand] : undefined,
    budgetDecision: input.budgetDecision,
    hardStop: input.hardStop
  };
}

export function createContinuationRunReport(reportId: string, input: ContinuationContractInput): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 'atm.continuationContract.v0.1',
    reportId,
    generatedAt: input.generatedAt,
    workItemId: input.workItemId,
    handoffKind: input.handoffKind ?? 'continuation',
    summary: input.summary,
    nextActions: [...input.nextActions],
    artifactPaths: uniqueNormalizedPaths(input.artifactPaths),
    evidencePaths: uniqueNormalizedPaths(input.evidencePaths),
    reportPaths: uniqueNormalizedPaths(input.reportPaths),
    continuationGoal: input.continuationGoal ?? null,
    resumePrompt: input.resumePrompt ?? null,
    resumeCommand: input.resumeCommand ? [...input.resumeCommand] : [],
    budgetDecision: input.budgetDecision ?? 'pass',
    hardStop: input.hardStop === true,
    authoredBy: input.authoredBy ?? null
  };
}

function createBootstrapConfig(taskId: string) {
  return {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: currentLayoutVersion,
    createdBy: '@ai-atomic-framework/plugin-governance-local',
    adapter: {
      mode: 'standalone',
      implemented: false
    },
    paths: {
      runtime: '.atm/runtime',
      history: '.atm/history',
      catalog: '.atm/catalog',
      profile: '.atm/runtime/profile',
      currentTask: '.atm/runtime/current-task.json',
      projectProbe: '.atm/runtime/project-probe.json',
      defaultGuards: '.atm/runtime/default-guards.json',
      contextBudget: '.atm/runtime/budget',
      tasks: '.atm/history/tasks',
      locks: '.atm/runtime/locks',
      evidence: '.atm/history/evidence',
      handoff: '.atm/history/handoff',
      artifacts: '.atm/history/artifacts',
      logs: '.atm/history/logs',
      reports: '.atm/history/reports',
      registry: '.atm/catalog/registry',
      index: '.atm/catalog/index',
      shards: '.atm/catalog/shards'
    },
    adoption: {
      profile: 'default',
      taskPath: `.atm/history/tasks/${taskId}.json`,
      lockPath: `.atm/runtime/locks/${taskId}.lock.json`,
      projectProbePath: '.atm/runtime/project-probe.json',
      defaultGuardsPath: '.atm/runtime/default-guards.json',
      evidencePath: `.atm/history/evidence/${taskId}.json`,
      currentTaskPath: '.atm/runtime/current-task.json'
    }
  };
}

function createCurrentTaskState(taskId: string, taskTitle: string, paths: ReturnType<typeof createBootstrapPaths>) {
  return {
    workItemId: taskId,
    title: taskTitle,
    status: 'open',
    updatedAt: new Date().toISOString(),
    lockPath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.lockPath),
    evidencePath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.evidencePath),
    summaryPath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.contextSummaryPath)
  };
}

function migrateLegacyBootstrapLayout(
  cwd: string,
  taskId: string,
  paths: ReturnType<typeof createBootstrapPaths>,
  force: boolean,
  created: string[],
  unchanged: string[]
) {
  const legacyPairs = [
    [path.join(cwd, '.atm', 'profile', 'default.md'), paths.profilePath],
    [path.join(cwd, '.atm', 'state', 'project-probe.json'), paths.projectProbePath],
    [path.join(cwd, '.atm', 'state', 'default-guards.json'), paths.defaultGuardsPath],
    [path.join(cwd, '.atm', 'state', 'context-budget', 'default-policy.json'), paths.contextBudgetPolicyPath],
    [path.join(cwd, '.atm', 'tasks', `${taskId}.json`), paths.taskPath],
    [path.join(cwd, '.atm', 'locks', `${taskId}.lock.json`), paths.lockPath],
    [path.join(cwd, '.atm', 'evidence', `${taskId}.json`), paths.evidencePath],
    [path.join(cwd, '.atm', 'state', 'context-summary', `${taskId}.json`), paths.contextSummaryPath],
    [path.join(cwd, '.atm', 'state', 'context-summary', `${taskId}.md`), paths.contextSummaryMarkdownPath]
  ] as const;
  const moved: string[] = [];

  for (const [legacyPath, nextPath] of legacyPairs) {
    if (!existsSync(legacyPath)) {
      continue;
    }
    if (existsSync(nextPath) && !force) {
      unchanged.push(relativePathFrom(cwd, nextPath));
      continue;
    }
    mkdirSync(path.dirname(nextPath), { recursive: true });
    writeFileSync(nextPath, readFileSync(legacyPath));
    created.push(relativePathFrom(cwd, nextPath));
    moved.push(relativePathFrom(cwd, legacyPath));
  }

  if (moved.length === 0) {
    return null;
  }

  return {
    path: path.join(cwd, '.atm', 'history', 'reports', 'migrations', `layout-v1-to-v${currentLayoutVersion}.json`),
    report: {
      schemaVersion: 'atm.layoutMigration.v0.1',
      migrationId: `layout-v1-to-v${currentLayoutVersion}`,
      migratedAt: new Date().toISOString(),
      taskId,
      fromLayoutVersion: 1,
      toLayoutVersion: currentLayoutVersion,
      copiedFrom: moved,
      notes: 'Legacy ATM layout paths were copied forward into the v2 runtime/history/catalog layout.'
    }
  };
}

function createBootstrapPaths(cwd: string, taskId: string) {
  const atmRoot = path.join(cwd, '.atm');
  return {
    configPath: path.join(atmRoot, 'config.json'),
    agentInstructionsPath: path.join(cwd, 'AGENTS.md'),
    profilePath: path.join(atmRoot, 'runtime', 'profile', 'default.md'),
    currentTaskPath: path.join(atmRoot, 'runtime', 'current-task.json'),
    projectProbePath: path.join(atmRoot, 'runtime', 'project-probe.json'),
    defaultGuardsPath: path.join(atmRoot, 'runtime', 'default-guards.json'),
    contextBudgetPolicyPath: path.join(atmRoot, 'runtime', 'budget', 'default-policy.json'),
    contextBudgetSummaryPath: path.join(atmRoot, 'runtime', 'budget', `bootstrap-${sanitizeBudgetFileId(`bootstrap/${taskId}`)}.md`),
    taskPath: path.join(atmRoot, 'history', 'tasks', `${taskId}.json`),
    lockPath: path.join(atmRoot, 'runtime', 'locks', `${taskId}.lock.json`),
    evidencePath: path.join(atmRoot, 'history', 'evidence', `${taskId}.json`),
    contextSummaryPath: path.join(atmRoot, 'history', 'handoff', `${taskId}.json`),
    contextSummaryMarkdownPath: path.join(atmRoot, 'history', 'handoff', `${taskId}.md`),
    contextPath: path.join(atmRoot, 'history', 'handoff', 'INITIAL_SUMMARY.md'),
    directories: {
      runtime: path.join(atmRoot, 'runtime'),
      profile: path.join(atmRoot, 'runtime', 'profile'),
      state: path.join(atmRoot, 'runtime', 'state'),
      locks: path.join(atmRoot, 'runtime', 'locks'),
      rules: path.join(atmRoot, 'runtime', 'rules'),
      contextBudget: path.join(atmRoot, 'runtime', 'budget'),
      history: path.join(atmRoot, 'history'),
      tasks: path.join(atmRoot, 'history', 'tasks'),
      evidence: path.join(atmRoot, 'history', 'evidence'),
      artifacts: path.join(atmRoot, 'history', 'artifacts'),
      logs: path.join(atmRoot, 'history', 'logs'),
      reports: path.join(atmRoot, 'history', 'reports'),
      reportContextBudget: path.join(atmRoot, 'history', 'reports', 'context-budget'),
      reportContinuation: path.join(atmRoot, 'history', 'reports', 'continuation'),
      reportSelfHost: path.join(atmRoot, 'history', 'reports', 'self-host-alpha'),
      reportMigrations: path.join(atmRoot, 'history', 'reports', 'migrations'),
      context: path.join(atmRoot, 'history', 'handoff'),
      catalog: path.join(atmRoot, 'catalog'),
      index: path.join(atmRoot, 'catalog', 'index'),
      shards: path.join(atmRoot, 'catalog', 'shards'),
      registry: path.join(atmRoot, 'catalog', 'registry')
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
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.taskPath),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.lockPath)
    ],
    guardPaths: [
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.defaultGuardsPath)
    ],
    evidencePath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.evidencePath),
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
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.profilePath),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.currentTaskPath),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.projectProbePath),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.defaultGuardsPath),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.taskPath),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.evidencePath)
    ]
  };
}

function createBootstrapEvidence(taskId: string, projectProbe: Readonly<Record<string, unknown>>, defaultGuards: { guards: readonly { id: string }[] }, paths: ReturnType<typeof createBootstrapPaths>) {
  return {
    schemaVersion: 'atm.evidence.v0.1',
    taskId,
    status: 'seeded',
    summary: 'Default ATM bootstrap pack created.',
    repositoryKind: projectProbe.repositoryKind,
    packageManager: projectProbe.packageManager,
    recommendedPrompt: createRecommendedPrompt(),
    guardIds: defaultGuards.guards.map((guard) => guard.id),
    artifactDirectories: [
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.directories.artifacts),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.directories.logs),
      relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.directories.reports)
    ],
    evidence: []
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
      },
      {
        id: 'protect-context-budget',
        summary: 'When estimated context load exceeds the repository policy, summarize or offload before continuing.'
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
    generatedAt: new Date().toISOString(),
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

function createDefaultContextBudgetPolicy(timestamp: string): ContextBudgetPolicy {
  return {
    policyId: 'default-policy',
    generatedAt: timestamp,
    unit: 'tokens',
    warningTokens: 12000,
    summarizeTokens: 20000,
    hardStopTokens: 28000,
    maxInlineArtifacts: 2,
    defaultSummary: 'Summarize large tool output before continuing.'
  };
}

function evaluateContextBudget(
  policy: ContextBudgetPolicy,
  input: ContextBudgetEvaluationInput,
  generatedAt: string
): Omit<ContextBudgetEvaluationResult, 'policyId' | 'budgetId' | 'reportPath' | 'summaryPath'> {
  const estimatedTokens = Math.max(0, Number(input.estimatedTokens || 0));
  const inlineArtifacts = Math.max(0, Number(input.inlineArtifacts || 0));
  let decision: ContextBudgetEvaluationResult['decision'] = 'pass';
  let reason = `Estimated ${estimatedTokens} tokens is within the current context budget policy.`;

  if (estimatedTokens >= policy.hardStopTokens) {
    decision = 'hard-stop';
    reason = `Estimated ${estimatedTokens} tokens exceeds the hard-stop threshold ${policy.hardStopTokens}.`;
  } else if (estimatedTokens >= policy.summarizeTokens) {
    decision = 'summarize-before-continue';
    reason = `Estimated ${estimatedTokens} tokens exceeds the summarize threshold ${policy.summarizeTokens}.`;
  } else if (inlineArtifacts > policy.maxInlineArtifacts) {
    decision = 'summarize-before-continue';
    reason = `Inline artifact count ${inlineArtifacts} exceeds the policy limit ${policy.maxInlineArtifacts}.`;
  } else if (estimatedTokens >= policy.warningTokens) {
    reason = `Estimated ${estimatedTokens} tokens is approaching the summarize threshold ${policy.summarizeTokens}.`;
  }

  return {
    decision,
    estimatedTokens,
    inlineArtifacts,
    generatedAt,
    reason
  };
}

function createContextBudgetSummary(
  policy: ContextBudgetPolicy,
  input: ContextBudgetEvaluationInput,
  evaluation: Omit<ContextBudgetEvaluationResult, 'policyId' | 'budgetId' | 'reportPath' | 'summaryPath'>
): string {
  return [
    '# Context Budget Summary',
    '',
    `- Policy: ${policy.policyId}`,
    `- Decision: ${evaluation.decision}`,
    `- Estimated tokens: ${evaluation.estimatedTokens}`,
    `- Inline artifacts: ${evaluation.inlineArtifacts}`,
    `- Reason: ${evaluation.reason}`,
    '',
    input.requestedSummary ?? policy.defaultSummary,
    ''
  ].join('\n');
}

function renderContextSummaryMarkdown(summary: ContextSummaryRecord): string {
  const lines = [
    `# ${summary.workItemId} Continuation Summary`,
    '',
    summary.summary,
    ''
  ];

  if (summary.handoffKind) {
    lines.push(`- Handoff kind: ${summary.handoffKind}`);
  }
  if (summary.budgetDecision) {
    lines.push(`- Budget decision: ${summary.budgetDecision}`);
  }
  if (summary.continuationGoal) {
    lines.push(`- Goal: ${summary.continuationGoal}`);
  }
  if (summary.resumePrompt) {
    lines.push(`- Resume prompt: ${summary.resumePrompt}`);
  }
  if (summary.resumeCommand && summary.resumeCommand.length > 0) {
    lines.push(`- Resume command: ${summary.resumeCommand.join(' ')}`);
  }
  if (lines[lines.length - 1] !== '') {
    lines.push('');
  }

  lines.push('## Next Actions', '');
  for (const action of summary.nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push('');

  if (summary.artifactPaths && summary.artifactPaths.length > 0) {
    lines.push('## Artifacts', '');
    for (const artifactPath of summary.artifactPaths) {
      lines.push(`- ${artifactPath}`);
    }
    lines.push('');
  }

  if (summary.evidencePaths && summary.evidencePaths.length > 0) {
    lines.push('## Evidence', '');
    for (const evidencePath of summary.evidencePaths) {
      lines.push(`- ${evidencePath}`);
    }
    lines.push('');
  }

  if (summary.reportPaths && summary.reportPaths.length > 0) {
    lines.push('## Reports', '');
    for (const reportPath of summary.reportPaths) {
      lines.push(`- ${reportPath}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function sanitizeBudgetFileId(budgetId: string): string {
  return normalizeRelativePath(budgetId || 'context-budget').replace(/[/:]+/g, '-');
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
  let rendered = stripTemplateHeader(template);
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }
  return rendered;
}

function stripTemplateHeader(template: string): string {
  return template.replace(/^\s*<!--\s*ATM TEMPLATE:[\s\S]*?-->\s*/i, '');
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

function uniqueNormalizedPaths(paths: readonly string[] | undefined): readonly string[] | undefined {
  if (!paths || paths.length === 0) {
    return undefined;
  }
  return [...new Set(paths.map((entry) => normalizeRelativePath(entry)).filter((entry) => entry.length > 0))];
}

function serializeContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readEvidenceDocument(filePath: string): { wrapper: Record<string, unknown> | null; evidence: EvidenceRecord[] } {
  if (!existsSync(filePath)) {
    return { wrapper: null, evidence: [] };
  }
  const parsed = readJsonFile(filePath);
  if (Array.isArray(parsed)) {
    return { wrapper: null, evidence: parsed as EvidenceRecord[] };
  }
  if (parsed && typeof parsed === 'object') {
    const wrapper = parsed as Record<string, unknown>;
    if (Array.isArray(wrapper.evidence)) {
      return { wrapper, evidence: wrapper.evidence as EvidenceRecord[] };
    }
    if (isEvidenceRecord(wrapper)) {
      return { wrapper: null, evidence: [wrapper] };
    }
    return { wrapper, evidence: [] };
  }
  return { wrapper: null, evidence: [] };
}

function readEvidenceRecords(filePath: string): EvidenceRecord[] {
  return readEvidenceDocument(filePath).evidence;
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.evidenceKind === 'string'
    && typeof candidate.summary === 'string'
    && Array.isArray(candidate.artifactPaths);
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

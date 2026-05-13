import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const bootstrapTaskId = 'BOOTSTRAP-0001';
export const atmLayoutVersion = 2;

export function createV2AtmPaths(taskId = bootstrapTaskId) {
  const atmRoot = '.atm';
  return {
    atmRoot,
    configPath: path.join(atmRoot, 'config.json'),
    runtimeRoot: path.join(atmRoot, 'runtime'),
    historyRoot: path.join(atmRoot, 'history'),
    catalogRoot: path.join(atmRoot, 'catalog'),
    profilePath: path.join(atmRoot, 'runtime', 'profile', 'default.md'),
    currentTaskPath: path.join(atmRoot, 'runtime', 'current-task.json'),
    projectProbePath: path.join(atmRoot, 'runtime', 'project-probe.json'),
    defaultGuardsPath: path.join(atmRoot, 'runtime', 'default-guards.json'),
    contextBudgetPolicyPath: path.join(atmRoot, 'runtime', 'budget', 'default-policy.json'),
    contextBudgetReportPath: path.join(atmRoot, 'history', 'reports', 'context-budget', `bootstrap-${sanitizeBudgetFileId(`bootstrap/${taskId}`)}.json`),
    contextBudgetSummaryPath: path.join(atmRoot, 'runtime', 'budget', `bootstrap-${sanitizeBudgetFileId(`bootstrap/${taskId}`)}.md`),
    taskPath: path.join(atmRoot, 'history', 'tasks', `${taskId}.json`),
    lockPath: path.join(atmRoot, 'runtime', 'locks', `${taskId}.lock.json`),
    evidencePath: path.join(atmRoot, 'history', 'evidence', `${taskId}.json`),
    contextSummaryPath: path.join(atmRoot, 'history', 'handoff', `${taskId}.json`),
    contextSummaryMarkdownPath: path.join(atmRoot, 'history', 'handoff', `${taskId}.md`),
    continuationReportPath: path.join(atmRoot, 'history', 'reports', 'continuation', `${taskId}.json`),
    selfHostReportPath: path.join(atmRoot, 'history', 'reports', 'self-host-alpha', `${taskId}.json`),
    selfHostBudgetReportPath: path.join(atmRoot, 'history', 'reports', 'context-budget', `self-host-alpha-${taskId}.json`),
    directories: {
      runtime: path.join(atmRoot, 'runtime'),
      runtimeProfile: path.join(atmRoot, 'runtime', 'profile'),
      runtimeLocks: path.join(atmRoot, 'runtime', 'locks'),
      runtimeBudget: path.join(atmRoot, 'runtime', 'budget'),
      runtimeState: path.join(atmRoot, 'runtime', 'state'),
      history: path.join(atmRoot, 'history'),
      historyTasks: path.join(atmRoot, 'history', 'tasks'),
      historyEvidence: path.join(atmRoot, 'history', 'evidence'),
      historyArtifacts: path.join(atmRoot, 'history', 'artifacts'),
      historyLogs: path.join(atmRoot, 'history', 'logs'),
      historyReports: path.join(atmRoot, 'history', 'reports'),
      historyReportsContextBudget: path.join(atmRoot, 'history', 'reports', 'context-budget'),
      historyReportsContinuation: path.join(atmRoot, 'history', 'reports', 'continuation'),
      historyReportsSelfHost: path.join(atmRoot, 'history', 'reports', 'self-host-alpha'),
      historyReportsMigrations: path.join(atmRoot, 'history', 'reports', 'migrations'),
      historyHandoff: path.join(atmRoot, 'history', 'handoff'),
      catalog: path.join(atmRoot, 'catalog'),
      catalogIndex: path.join(atmRoot, 'catalog', 'index'),
      catalogShards: path.join(atmRoot, 'catalog', 'shards'),
      catalogRegistry: path.join(atmRoot, 'catalog', 'registry')
    }
  };
}

export function createV1AtmPaths(taskId = bootstrapTaskId) {
  const atmRoot = '.atm';
  return {
    atmRoot,
    configPath: path.join(atmRoot, 'config.json'),
    profilePath: path.join(atmRoot, 'profile', 'default.md'),
    currentTaskPath: null,
    projectProbePath: path.join(atmRoot, 'state', 'project-probe.json'),
    defaultGuardsPath: path.join(atmRoot, 'state', 'default-guards.json'),
    contextBudgetPolicyPath: path.join(atmRoot, 'state', 'context-budget', 'default-policy.json'),
    contextBudgetReportPath: path.join(atmRoot, 'reports', 'context-budget', `bootstrap-${sanitizeBudgetFileId(`bootstrap/${taskId}`)}.json`),
    contextBudgetSummaryPath: path.join(atmRoot, 'state', 'context-budget', `bootstrap-${sanitizeBudgetFileId(`bootstrap/${taskId}`)}.md`),
    taskPath: path.join(atmRoot, 'tasks', `${taskId}.json`),
    lockPath: path.join(atmRoot, 'locks', `${taskId}.lock.json`),
    evidencePath: path.join(atmRoot, 'evidence', `${taskId}.json`),
    contextSummaryPath: path.join(atmRoot, 'state', 'context-summary', `${taskId}.json`),
    contextSummaryMarkdownPath: path.join(atmRoot, 'state', 'context-summary', `${taskId}.md`),
    continuationReportPath: path.join(atmRoot, 'reports', 'continuation', `${taskId}.json`),
    selfHostReportPath: path.join(atmRoot, 'reports', 'self-host-alpha', `${taskId}.json`),
    selfHostBudgetReportPath: path.join(atmRoot, 'reports', 'context-budget', `self-host-alpha-${taskId}.json`)
  };
}

export function detectGovernanceRuntime(cwd: any, taskId = bootstrapTaskId) {
  const configPath = path.join(cwd, '.atm', 'config.json');
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : null;
  const explicitVersion = Number(config?.layoutVersion ?? 0);
  const hasV2 = existsSync(path.join(cwd, '.atm', 'runtime')) || existsSync(path.join(cwd, '.atm', 'history')) || existsSync(path.join(cwd, '.atm', 'catalog'));
  const hasV1 = existsSync(path.join(cwd, '.atm', 'tasks')) || existsSync(path.join(cwd, '.atm', 'state', 'context-summary')) || existsSync(path.join(cwd, '.atm', 'locks'));
  const layoutVersion = explicitVersion === atmLayoutVersion
    ? atmLayoutVersion
    : hasV2
      ? atmLayoutVersion
      : hasV1
        ? 1
        : atmLayoutVersion;
  const paths = layoutVersion === atmLayoutVersion
    ? createV2AtmPaths(taskId)
    : createV1AtmPaths(taskId);
  const currentTask = readJsonIfExists(path.join(cwd, paths.currentTaskPath ?? ''));
  const currentTaskId = currentTask?.workItemId ?? currentTask?.taskId ?? inferCurrentTaskId(cwd, layoutVersion);
  const activeLock = readActiveLock(cwd, layoutVersion, currentTaskId);
  const lastEvidenceAt = findLatestTimestamp(path.join(cwd, layoutVersion === atmLayoutVersion ? '.atm/history/evidence' : '.atm/evidence'));
  const lastHandoffAt = findLatestTimestamp(path.join(cwd, layoutVersion === atmLayoutVersion ? '.atm/history/handoff' : '.atm/state/context-summary'));
  const missingPaths = [];
  for (const relativePath of [paths.profilePath, paths.projectProbePath, paths.defaultGuardsPath, paths.contextBudgetPolicyPath]) {
    if (relativePath && !existsSync(path.join(cwd, relativePath))) {
      missingPaths.push(relativePath.replace(/\\/g, '/'));
    }
  }
  return {
    config,
    configPath: relativePathFrom(cwd, configPath),
    layoutVersion,
    migrationNeeded: layoutVersion !== atmLayoutVersion && hasV1,
    hasV1,
    hasV2,
    paths,
    currentTaskId,
    activeLock,
    lastEvidenceAt,
    lastHandoffAt,
    missingPaths
  };
}

export function createCurrentTaskRecord(task: any, options: {
  updatedAt?: string;
  lockPath?: string | null;
  evidencePath?: string | null;
  summaryPath?: string | null;
} = {}) {
  return {
    workItemId: task.workItemId ?? task.id ?? task.taskId ?? bootstrapTaskId,
    title: task.title ?? null,
    status: task.status ?? null,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    lockPath: options.lockPath ?? null,
    evidencePath: options.evidencePath ?? null,
    summaryPath: options.summaryPath ?? null
  };
}

export function relativePathFrom(cwd: any, absolutePath: any) {
  return path.relative(cwd, absolutePath).replace(/\\/g, '/');
}

export function sanitizeBudgetFileId(budgetId: any) {
  return String(budgetId || 'context-budget').replace(/\\/g, '/').replace(/[/:]+/g, '-');
}

function readJsonIfExists(filePath: any) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function inferCurrentTaskId(cwd: any, layoutVersion: any) {
  const taskDirectory = path.join(cwd, layoutVersion === atmLayoutVersion ? '.atm/history/tasks' : '.atm/tasks');
  if (!existsSync(taskDirectory)) {
    return null;
  }
  const candidates = readdirSync(taskDirectory)
    .filter((entry) => entry.endsWith('.json'))
    .sort();
  return candidates.length > 0 ? candidates[0].replace(/\.json$/, '') : null;
}

function readActiveLock(cwd: any, layoutVersion: any, currentTaskId: any) {
  const lockDirectory = path.join(cwd, layoutVersion === atmLayoutVersion ? '.atm/runtime/locks' : '.atm/locks');
  if (!existsSync(lockDirectory)) {
    return null;
  }
  const lockFiles = readdirSync(lockDirectory)
    .filter((entry) => entry.endsWith('.lock.json'))
    .sort((left, right) => {
      const leftTime = statSync(path.join(lockDirectory, left)).mtimeMs;
      const rightTime = statSync(path.join(lockDirectory, right)).mtimeMs;
      return rightTime - leftTime;
    });
  for (const fileName of lockFiles) {
    const lock = readJsonIfExists(path.join(lockDirectory, fileName));
    if (!lock) {
      continue;
    }
    if (lock.released === true || lock.status === 'released') {
      continue;
    }
    return {
      taskId: lock.workItemId ?? lock.taskId ?? currentTaskId ?? fileName.replace(/\.lock\.json$/, ''),
      owner: lock.lockedBy ?? lock.owner ?? null,
      path: relativePathFrom(cwd, path.join(lockDirectory, fileName))
    };
  }
  return null;
}

function findLatestTimestamp(directoryPath: any) {
  if (!existsSync(directoryPath)) {
    return null;
  }
  const candidates = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name));
  if (candidates.length === 0) {
    return null;
  }
  const latest = candidates
    .map((filePath) => ({ filePath, mtimeMs: statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  return new Date(latest.mtimeMs).toISOString();
}

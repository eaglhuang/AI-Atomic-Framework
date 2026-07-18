// @ts-nocheck
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  compareScoredTasks,
  looksLikeTaskArtifact,
  isLikelyPromptPathHint,
  pathFieldMatches,
  looksLikeNamedPlanPrompt,
  allowsPlanningMirror,
  statusQueueWeight,
  tokenizeForMatch,
  countTokenOverlap
} from '../match-and-sort.ts';
import { buildPromptScopedQueueClaimCommand } from '../prompt-scope-resolution.ts';
import { readConfiguredPlanningRoots } from '../../planning-repo-root.ts';
import { resolveCandidatePlanningRoots } from '../planning-root-preference.ts';
import { bootstrapTaskId } from '../../governance-runtime.ts';
import { CliError, parseJsonText, quoteCliValue } from '../../shared.ts';
import {
  abandonTaskQueue,
  buildAllowedFilesForTask,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  partitionTaskScope,
  readActiveTaskDirectionLocks,
  type TaskQueueRecord
} from '../../task-direction.ts';
import {
  extractPathLikeStringsFromPrompt,
  isPathAllowedByScope,
  listActiveBatchRuns,
  readActiveBatchRun,
  repairBatchRunFromQueue
} from '../../work-channels.ts';
import {
  parseMarkdownFrontmatter,
  normalizeTaskRouteStatus,
  normalizeOptionalBoolean,
  normalizeSearchText,
  normalizeTaskIntent,
  normalizeOptionalTaskPath,
  readStringArray,
  splitListValue,
  type RequestedTaskAction,
  type TaskIntent,
  type TaskIntentSource
} from '../intent-normalizers.ts';
import {
  areTaskDependenciesSatisfied,
  canTaskBePreparedForClaim,
  hasRequiredPromptScopeMatch,
  isClosedTaskStatus,
  isExplicitSingleTaskRoute,
  isQueueRequestedPrompt,
  isTaskCardSurfaceOnlyMatch,
  isTaskAlreadyActivelyClaimed,
  isTaskExplicitlyMentioned,
  isTaskRoutable,
  shouldDiscoverMarkdownTaskCards,
  type ImportedTaskQueue,
  type ImportedTaskSummary,
  type PromptScopedRouteStatus,
  type PromptScopedTaskRoute
} from '../route-predicates.ts';
import {
  sha256,
  uniqueInOrder,
  uniqueSorted
} from '../view-projections.ts';
import { shouldReportPlanningRootMissing } from '../../planning-repo-root.ts';

export function findActiveTaskQueueForIntent(cwd: string, intent: TaskIntent | null, options: {
  readonly sourcePromptFallback?: string | null;
  readonly taskId?: string | null;
} = {}): TaskQueueRecord | null {
  if (intent?.userPrompt) {
    const exact = findActiveTaskQueue(cwd, intent.userPrompt);
    if (exact) return exact;
  }
  if (options.sourcePromptFallback) {
    const fallback = findActiveTaskQueue(cwd, options.sourcePromptFallback);
    if (fallback) return fallback;
  }
  for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
    const scoped = findActiveTaskQueue(cwd, null, { scopeKey });
    if (scoped) return scoped;
  }
  if (options.taskId) {
    const byTask = findActiveTaskQueue(cwd, null, { taskId: options.taskId });
    if (byTask) return byTask;
  }
  return null;
}

export function reconcilePromptScopeRuntimeForClaim(
  cwd: string,
  taskIntent: TaskIntent | null,
  selectedTasks: readonly ImportedTaskSummary[]
) {
  const sourcePrompt = taskIntent?.userPrompt?.trim() ?? '';
  if (!sourcePrompt || selectedTasks.length === 0) return null;
  const existingQueue = findActiveTaskQueueForIntent(cwd, taskIntent, {
    taskId: selectedTasks[0]?.workItemId ?? null
  });
  const refreshedQueue = createOrRefreshTaskQueue({
    cwd,
    sourcePrompt,
    tasks: selectedTasks,
    taskIds: selectedTasks.map((task) => task.workItemId),
    actorId: null,
    batchId: existingQueue?.batchId ?? null,
    scopeKey: existingQueue?.scopeKey ?? null
  });
  if (existingQueue && existingQueue.queueId !== refreshedQueue.queueId && existingQueue.status === 'active') {
    abandonTaskQueue({
      cwd,
      queueId: existingQueue.queueId,
      actorId: 'atm-runtime-reconcile',
      reason: `superseded by dependency-refreshed prompt queue ${refreshedQueue.queueId}`
    });
  }
  const queueHeadTaskId = refreshedQueue.taskIds[refreshedQueue.currentIndex] ?? null;
  const queueHeadTask = queueHeadTaskId
    ? selectedTasks.find((task) => task.workItemId === queueHeadTaskId) ?? null
    : null;
  const activeBatch = refreshedQueue.batchId
    ? readActiveBatchRun(cwd, { batchId: refreshedQueue.batchId })
    : findActiveBatchRunForIntent(cwd, taskIntent, { taskId: queueHeadTaskId });
  const batchRun = activeBatch?.status === 'active'
    ? repairBatchRunFromQueue(cwd, activeBatch, refreshedQueue)
    : null;
  return {
    queue: refreshedQueue,
    batchRun,
    queueHeadTask
  };
}

export function findActiveBatchRunForIntent(cwd: string, intent: TaskIntent | null, options: {
  readonly sourcePromptFallback?: string | null;
  readonly taskId?: string | null;
} = {}) {
  if (intent?.userPrompt) {
    const exact = readActiveBatchRun(cwd, { sourcePrompt: intent.userPrompt });
    if (exact) return exact;
  }
  if (options.sourcePromptFallback) {
    const fallback = readActiveBatchRun(cwd, { sourcePrompt: options.sourcePromptFallback });
    if (fallback) return fallback;
  }
  for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
    const scoped = readActiveBatchRun(cwd, { scopeKey });
    if (scoped) return scoped;
  }
  if (options.taskId) {
    const byTask = readActiveBatchRun(cwd, { taskId: options.taskId });
    if (byTask) return byTask;
  }
  return null;
}

function deriveBatchScopeKeysFromIntent(intent: TaskIntent | null): readonly string[] {
  if (!intent) return [];
  const roots = [
    ...intent.taskRootHints,
    ...intent.mentionedTaskIds
      .map((taskId) => taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/)?.[1] ?? null)
      .filter((entry): entry is string => Boolean(entry))
  ];
  return uniqueSorted(roots.flatMap((root) => normalizeRootHintScopeKeys(root)));
}

function normalizeRootHintScopeKeys(root: string): readonly string[] {
  const normalized = root.trim().toUpperCase().replace(/_/g, '-');
  if (!normalized) return [];
  if (normalized.startsWith('TASK-')) return [normalized];
  if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(normalized)) {
    return [`TASK-${normalized}`];
  }
  return [normalized];
}

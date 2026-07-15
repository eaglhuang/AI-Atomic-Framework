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
} from './match-and-sort.ts';
import { buildPromptScopedQueueClaimCommand } from './prompt-scope-resolution.ts';
import { readConfiguredPlanningRoots } from '../planning-repo-root.ts';
import { resolveCandidatePlanningRoots } from './planning-root-preference.ts';
import { bootstrapTaskId } from '../governance-runtime.ts';
import { CliError, parseJsonText, quoteCliValue } from '../shared.ts';
import {
  abandonTaskQueue,
  buildAllowedFilesForTask,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  partitionTaskScope,
  readActiveTaskDirectionLocks,
  type TaskQueueRecord
} from '../task-direction.ts';
import {
  extractPathLikeStringsFromPrompt,
  isPathAllowedByScope,
  listActiveBatchRuns,
  readActiveBatchRun,
  repairBatchRunFromQueue
} from '../work-channels.ts';
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
} from './intent-normalizers.ts';
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
} from './route-predicates.ts';
import {
  sha256,
  uniqueInOrder,
  uniqueSorted
} from './view-projections.ts';
import { shouldReportPlanningRootMissing } from '../planning-repo-root.ts';

export type NextClaimIntent = 'write' | 'closeout-only';

function createNextProfiler(header = 'ATM_NEXT_PROFILE') {
  const enabled = process.env.ATM_NEXT_PROFILE === '1';
  const startedAt = Date.now();
  let previousAt = startedAt;
  const marks: string[] = [];
  return {
    mark(label: string) {
      if (!enabled) return;
      const now = Date.now();
      marks.push(`${label}: +${now - previousAt}ms (${now - startedAt}ms)`);
      previousAt = now;
    },
    flush(label: string) {
      if (!enabled) return;
      const now = Date.now();
      marks.push(`${label}: +${now - previousAt}ms (${now - startedAt}ms)`);
      process.stderr.write(`[${header}]\n${marks.join('\n')}\n`);
    }
  };
}

export function resolvePromptScopedTaskContext(cwd: string, input: { readonly prompt?: string | null; readonly intentPath?: string | null }): PromptScopedTaskContext {
  const taskIntent = resolveTaskIntent(cwd, {
    prompt: normalizeOptionalString(input.prompt) ?? undefined,
    intentPath: normalizeOptionalString(input.intentPath) ?? undefined
  });
  const importedTaskQueue = inspectImportedTaskQueue(cwd, taskIntent);
  return {
    taskIntent: taskIntent ? {
      userPrompt: taskIntent.userPrompt,
      explicitTaskIds: taskIntent.explicitTaskIds,
      taskScopeMentioned: taskIntent.taskScopeMentioned,
      requestedAction: taskIntent.requestedAction,
      source: taskIntent.source
    } : null,
    promptScope: importedTaskQueue.promptScope ? {
      status: importedTaskQueue.promptScope.status,
      selectedTasks: importedTaskQueue.promptScope.selectedTasks,
      targetRepo: importedTaskQueue.promptScope.targetRepo,
      diagnostics: importedTaskQueue.promptScope.diagnostics
    } : null
  };
}

export function resolveTaskIntent(cwd: string, input: { readonly prompt?: string; readonly intentPath?: string; readonly explicitTaskIds?: readonly string[] }): TaskIntent | null {
  const cliExplicitTaskIds = uniqueInOrder(input.explicitTaskIds ?? []);
  const fileIntent = input.intentPath ? readTaskIntentFile(cwd, input.intentPath) : null;
  if (fileIntent) {
    const explicitTaskIds = uniqueInOrder([...cliExplicitTaskIds, ...fileIntent.explicitTaskIds]);
    return {
      ...fileIntent,
      userPrompt: input.prompt ?? fileIntent.userPrompt,
      explicitTaskIds,
      taskScopeMentioned: fileIntent.taskScopeMentioned || explicitTaskIds.length > 0
    };
  }
  if (input.prompt && input.prompt.trim().length > 0) {
    return createDeterministicTaskIntent(input.prompt, cliExplicitTaskIds);
  }
  if (cliExplicitTaskIds.length > 0) return createDeterministicTaskIntent(cliExplicitTaskIds.join(','), cliExplicitTaskIds);
  return null;
}

function readTaskIntentFile(cwd: string, intentPath: string): TaskIntent {
  const absolutePath = path.isAbsolute(intentPath) ? intentPath : path.join(cwd, intentPath);
  const parsed = parseJsonText(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
  if (parsed.schemaId !== 'atm.taskIntent.v1') {
    throw new CliError('ATM_TASK_INTENT_SCHEMA_INVALID', 'next --intent requires schemaId atm.taskIntent.v1.', {
      exitCode: 2,
      details: { intentPath }
    });
  }
  return normalizeTaskIntent(parsed, 'atm-skill');
}

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

export function createDeterministicTaskIntent(prompt: string, explicitTaskIds: readonly string[] = []): TaskIntent {
  const mentionedTaskIds = uniqueSorted(extractTaskIdReferencesFromPrompt(prompt).flatMap((entry) => expandTaskIdReferenceAliases(entry)));
  const mentionedPlanPaths = uniqueSorted(extractPromptPathHints(prompt).filter((entry) => /\.md$/i.test(entry)));
  const targetRepoHints = uniqueSorted([
    ...(/AI-Atomic-Framework|ATM\s*framework|ATM\s*\u6846\u67b6|ATM\u6846\u67b6|\u539f\u5b50\u6846\u67b6/i.test(prompt) ? ['AI-Atomic-Framework'] : [])
  ]);
  const taskRootHints = uniqueSorted([
    ...(/self[-_ ]?atomization|\u81ea\u6211\u539f\u5b50\u5316|100%/i.test(prompt) ? ['atm-self-atomization'] : []),
    ...extractTaskFamilyRootHintsFromPrompt(prompt),
    ...extractTaskRootHintsFromPrompt(prompt, mentionedTaskIds),
    ...extractPromptPathHints(prompt).filter((entry) => !/\.md$/i.test(entry))
  ]);
  const ordinalScope = /\u524d\s*(?:3|\u4e09)\s*\u5f35|first\s+3/i.test(prompt)
    ? { kind: 'first' as const, count: 3 }
    : /\u524d\s*(?:2|\u5169|\u4e8c)\s*\u5f35|first\s+2/i.test(prompt)
      ? { kind: 'first' as const, count: 2 }
      : null;
  const queueRequested = isQueueRequestedPrompt(prompt) || Boolean(ordinalScope);
  const orderedExplicitTaskIds = uniqueInOrder(explicitTaskIds.map((entry) => entry.toUpperCase()));
  const taskScopeMentioned = orderedExplicitTaskIds.length > 0
    || mentionedTaskIds.length > 0
    || mentionedPlanPaths.length > 0
    || taskRootHints.length > 0
    || queueRequested
    || /\u4efb\u52d9\u5361|task\s*card|task[-_ ]?asa|\u8a08\u756b\u66f8/i.test(prompt);
  return {
    schemaId: 'atm.taskIntent.v1',
    userPrompt: prompt,
    explicitTaskIds: orderedExplicitTaskIds,
    mentionedTaskIds,
    mentionedPlanPaths,
    taskRootHints,
    targetRepoHints,
    requestedAction: detectRequestedTaskAction(prompt),
    confidence: orderedExplicitTaskIds.length > 0 ? 0.98 : taskScopeMentioned ? 0.7 : 0.25,
    source: 'cli-deterministic',
    ordinalScope,
    queueRequested,
    taskScopeMentioned
  };
}


export function resolvePromptScopedTaskRoute(
  cwd: string,
  tasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null,
  planningRootResolution?: ReturnType<typeof resolveCandidatePlanningRoots>
): PromptScopedTaskRoute | null {
  if (!taskIntent || !taskIntent.taskScopeMentioned) return null;
  if (taskIntent.explicitTaskIds.length > 0) {
    const selectedTasks = taskIntent.explicitTaskIds
      .map((taskId) => findTaskByTaskIdReference(tasks, taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task));
    const missingTaskIds = taskIntent.explicitTaskIds.filter((taskId) => !findTaskByTaskIdReference(selectedTasks, taskId));
    if (missingTaskIds.length > 0) {
      return {
        status: 'not-found',
        selectedTasks,
        targetRepo: resolveRouteTargetRepo(selectedTasks),
        diagnostics: ['explicit-task-range-missing-task-ids', `missing:${missingTaskIds.join(',')}`]
      };
    }
    return {
      status: selectedTasks.length > 1 ? 'queue' : 'ready',
      selectedTasks,
      targetRepo: resolveRouteTargetRepo(selectedTasks),
      diagnostics: ['explicit-task-range']
    };
  }
  const handoffRoute = resolveHandoffResumeTaskRoute(cwd, tasks, taskIntent);
  if (handoffRoute) return handoffRoute;
  const scored = tasks
    .map((task) => scoreTaskForIntent(cwd, task, taskIntent))
    .filter((task) => (task.matchScore ?? 0) > 0)
    .sort(compareScoredTasks);
  const hasExplicitScopeHints = taskIntent.mentionedTaskIds.length > 0
    || taskIntent.mentionedPlanPaths.length > 0
    || taskIntent.taskRootHints.length > 0
    || taskIntent.targetRepoHints.length > 0;
  const viableMatches = hasExplicitScopeHints
    ? scored.filter((task) => hasRequiredPromptScopeMatch(task, taskIntent))
    : scored;
  if (viableMatches.length === 0) {
    if (taskIntent.queueRequested && !hasExplicitScopeHints && tasks.length > 0) {
      // ATM-BUG-2026-07-07-047: a blanket "all/open/remaining task cards"
      // prompt names no specific task, plan, or root, so nothing scores above
      // zero against keyword-based matching. ATM already discovered open
      // imported work in `tasks`; route the whole queue instead of
      // discarding it as task-scope-not-found.
      const scoped = applyOrdinalScope(tasks, taskIntent);
      return {
        status: 'queue',
        selectedTasks: scoped,
        targetRepo: resolveRouteTargetRepo(scoped),
        diagnostics: ['queue-requested-fallback-to-full-open-queue', `scoped-queue-size:${scoped.length}`]
      };
    }
    if (
      taskIntent.taskRootHints.some((hint) => hint.startsWith('TASK-'))
      && (
      taskIntent.mentionedTaskIds.length === 0
      && taskIntent.mentionedPlanPaths.length === 0
      && taskIntent.taskRootHints.length > 0
      && (taskIntent.queueRequested || taskIntent.ordinalScope !== null || taskIntent.requestedAction === 'close')
      )
    ) {
      return {
        status: 'empty',
        selectedTasks: [],
        targetRepo: null,
        diagnostics: ['prompt-task-scope-had-no-open-imported-work']
      };
    }
    return {
      status: 'not-found',
      selectedTasks: [],
      targetRepo: null,
      diagnostics: ['prompt-task-scope-had-no-matching-task-card']
    };
  }
  if (viableMatches.every(isTaskCardSurfaceOnlyMatch)) {
    if (looksLikeNamedPlanPrompt(taskIntent.userPrompt ?? '')) {
      return {
        status: 'not-found',
        selectedTasks: [],
        targetRepo: null,
        diagnostics: ['low-confidence-task-card-surface-rejected', 'named-plan-prompt-had-no-matching-plan-tasks']
      };
    }
    return {
      status: 'ambiguous',
      selectedTasks: viableMatches.slice(0, 12),
      targetRepo: resolveRouteTargetRepo(viableMatches),
      diagnostics: ['low-confidence-task-card-surface-selection-required']
    };
  }
  const scoped = applyOrdinalScope(viableMatches, taskIntent);
  const selectedTasks = taskIntent.queueRequested || taskIntent.ordinalScope ? scoped : scoped.slice(0, 1);
  if (taskIntent.queueRequested || taskIntent.ordinalScope) {
    return {
      status: 'queue',
      selectedTasks,
      targetRepo: resolveRouteTargetRepo(selectedTasks),
      diagnostics: [`scoped-queue-size:${selectedTasks.length}`]
    };
  }
  const bestScore = viableMatches[0]?.matchScore ?? 0;
  const topMatches = viableMatches.filter((task) => (task.matchScore ?? 0) === bestScore);
  const exactTaskIdRequested = taskIntent.mentionedTaskIds.length > 0;
  if (topMatches.length === 1 && (exactTaskIdRequested || bestScore >= 60)) {
    return {
      status: 'ready',
      selectedTasks: [topMatches[0]],
      targetRepo: topMatches[0].targetRepo,
      diagnostics: topMatches[0].matchReasons ?? []
    };
  }
  return {
    status: 'ambiguous',
    selectedTasks: viableMatches.slice(0, 12),
    targetRepo: resolveRouteTargetRepo(viableMatches),
    diagnostics: ['multiple-task-candidates-matched-prompt']
  };
}

/**
 * Handoff documents are workspace-level artifacts rather than task cards, so
 * their filename cannot score against a ledger task path. When a handoff is
 * explicitly named, use the handoff's task references only as a constrained
 * hint: a referenced active claim is safe, a stale reference is not, and an
 * unqualified handoff may fall back only when exactly one active claim exists.
 */
export function resolveHandoffResumeTaskRoute(
  cwd: string,
  tasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null
): PromptScopedTaskRoute | null {
  if (!taskIntent?.userPrompt || !isHandoffPrompt(taskIntent.userPrompt)) return null;
  const handoffPath = resolvePromptHandoffPath(cwd, taskIntent.userPrompt);
  if (!handoffPath) return null;
  const activeTasks = tasks.filter(isActiveClaimedTask);
  if (activeTasks.length === 0) return null;

  const handoffText = readFileText(handoffPath);
  const referencedTaskIds = handoffText ? extractTaskIdReferencesFromPrompt(handoffText) : [];
  if (referencedTaskIds.length > 0) {
    const referencedActiveTasks = activeTasks.filter((task) =>
      referencedTaskIds.some((taskId) => expandTaskIdReferenceAliases(taskId).includes(task.workItemId.toUpperCase()))
    );
    if (referencedActiveTasks.length === 1) {
      return {
        status: 'ready',
        selectedTasks: referencedActiveTasks,
        targetRepo: referencedActiveTasks[0]?.targetRepo ?? null,
        diagnostics: ['handoff-file-task-reference', 'handoff-file-active-claim-match']
      };
    }
    if (referencedActiveTasks.length > 1) {
      return {
        status: 'ambiguous',
        selectedTasks: referencedActiveTasks,
        targetRepo: resolveRouteTargetRepo(referencedActiveTasks),
        diagnostics: ['handoff-file-multiple-active-claim-matches']
      };
    }
    return {
      status: 'not-found',
      selectedTasks: [],
      targetRepo: null,
      diagnostics: ['handoff-file-references-no-active-claim']
    };
  }

  if (activeTasks.length === 1) {
    return {
      status: 'ready',
      selectedTasks: activeTasks,
      targetRepo: activeTasks[0]?.targetRepo ?? null,
      diagnostics: ['handoff-file-unique-active-claim-fallback']
    };
  }
  return {
    status: 'ambiguous',
    selectedTasks: activeTasks,
    targetRepo: resolveRouteTargetRepo(activeTasks),
    diagnostics: ['handoff-file-multiple-active-claims']
  };
}

export function isActiveClaimedTask(task: ImportedTaskSummary): boolean {
  return normalizeTaskRouteStatus(task.status) === 'running'
    && typeof task.activeClaimActorId === 'string'
    && task.activeClaimActorId.trim().length > 0;
}

export function isHandoffPrompt(prompt: string): boolean {
  return /(?:handoff|unfinished[-_ ]work)\.md\b/i.test(prompt);
}

function resolvePromptHandoffPath(cwd: string, prompt: string): string | null {
  const candidates = new Set<string>();
  for (const match of prompt.matchAll(/[A-Za-z]:[^\s`"'<>]+\.md/gi)) {
    candidates.add(path.normalize(match[0].replace(/[),.;]+$/, '')));
  }
  for (const match of prompt.matchAll(/\b[A-Za-z0-9][A-Za-z0-9._-]*(?:handoff|unfinished[-_ ]work)[A-Za-z0-9._-]*\.md\b/gi)) {
    const basename = match[0];
    candidates.add(path.join(cwd, '.atm', 'history', 'handoff', basename));
  }
  for (const candidate of extractPathLikeStringsFromPrompt(prompt)) {
    if (/(?:handoff|unfinished[-_ ]work)\.md$/i.test(candidate)) {
      candidates.add(path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate));
    }
  }
  return [...candidates].find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function readFileText(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function findTaskByTaskIdReference(tasks: readonly ImportedTaskSummary[], taskIdReference: string): ImportedTaskSummary | null {
  const aliases = expandTaskIdReferenceAliases(taskIdReference);
  return tasks.find((task) => aliases.includes(task.workItemId.toUpperCase())) ?? null;
}

export function assertPromptBatchDoesNotConflict(input: {
  readonly cwd: string;
  readonly promptScope: PromptScopedTaskRoute | null;
  readonly allTasks: readonly ImportedTaskSummary[];
  readonly sourcePrompt: string | null;
  readonly currentBatchId?: string | null;
}) {
  if (input.promptScope?.status !== 'queue') return;
  const requestedTaskIds = input.promptScope.selectedTasks.map((task) => task.workItemId);
  const requestedAllowedFiles = uniqueSorted(input.promptScope.selectedTasks.flatMap((task) => task.targetAllowedFiles));
  const sourcePromptHash = input.sourcePrompt?.trim() ? sha256(input.sourcePrompt.trim()) : null;
  const activeBatches = listActiveBatchRuns(input.cwd);
  for (const batchRun of activeBatches) {
    if (input.currentBatchId && batchRun.batchId === input.currentBatchId) continue;
    if (sourcePromptHash && batchRun.sourcePromptHash === sourcePromptHash) continue;
    const overlappingTaskIds = requestedTaskIds.filter((taskId) => batchRun.taskIds.includes(taskId));
    if (overlappingTaskIds.length > 0) {
      throw new CliError('ATM_BATCH_TASK_OWNERSHIP_CONFLICT', 'A task cannot belong to two active batch runs. Abandon or finish the existing batch before creating another one for the same task.', {
        exitCode: 1,
        details: {
          batchId: batchRun.batchId,
          scopeKey: batchRun.scopeKey,
          overlappingTaskIds,
          requiredCommand: `node atm.mjs batch status --batch ${batchRun.batchId} --json`
        }
      });
    }
    const batchTasks = batchRun.taskIds
      .map((taskId) => input.allTasks.find((task) => task.workItemId === taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task));
    const batchAllowedFiles = uniqueSorted(batchTasks.flatMap((task) => task.targetAllowedFiles));
    const overlappingFiles = requestedAllowedFiles.filter((file) => isPathAllowedByScope(file, batchAllowedFiles));
    if (overlappingFiles.length > 0) {
      throw new CliError('ATM_BATCH_FILE_CONFLICT', 'Another active batch already owns one or more target files for this batch range.', {
        exitCode: 1,
        details: {
          conflictingBatchId: batchRun.batchId,
          conflictingScopeKey: batchRun.scopeKey,
          conflictingTaskIds: batchRun.taskIds,
          overlappingFiles,
          requiredAction: `Run node atm.mjs batch status --batch ${batchRun.batchId} --json, then checkpoint/commit or abandon that batch before claiming this overlapping range.`
        }
      });
    }
  }
}



export function scoreTaskForIntent(cwd: string, task: ImportedTaskSummary, intent: TaskIntent): ImportedTaskSummary {
  const prompt = normalizeSearchText(intent.userPrompt ?? '');
  const reasons: string[] = [];
  let score = 0;
  if (intent.mentionedTaskIds.includes(task.workItemId.toUpperCase())) {
    score += 120;
    reasons.push('task-id-exact');
  } else if (isTaskIdSuffixMentioned(task.workItemId, intent)) {
    score += 110;
    reasons.push('task-id-suffix-match');
  }
  const pathFields = [
    task.taskPath,
    task.sourcePlanPath,
    ...task.nearbyPlanPaths
  ].filter((entry): entry is string => Boolean(entry));
  for (const planHint of intent.mentionedPlanPaths) {
    if (pathFields.some((field) => pathFieldMatches(field, planHint))) {
      score += 90;
      reasons.push('plan-path-match');
      break;
    }
  }
  for (const field of pathFields) {
    const normalizedField = normalizeSearchText(field);
    const stem = normalizeSearchText(path.basename(field).replace(/\.[^.]+$/, ''));
    if ((normalizedField && prompt.includes(normalizedField)) || (stem && prompt.includes(stem))) {
      score += 85;
      reasons.push('nearby-plan-name-match');
      break;
    }
  }
  for (const rootHint of intent.taskRootHints) {
    const normalizedHint = normalizeSearchText(rootHint);
    if (normalizedHint && (
      normalizeSearchText(task.workItemId).includes(normalizedHint)
      || pathFields.some((field) => normalizeSearchText(field).includes(normalizedHint))
    )) {
      score += 65;
      reasons.push('task-root-hint-match');
      break;
    }
  }
  if (intent.targetRepoHints.length > 0 && task.targetRepo) {
    const target = normalizeSearchText(task.targetRepo);
    if (intent.targetRepoHints.some((hint) => target.includes(normalizeSearchText(hint)))) {
      score += 35;
      reasons.push('target-repo-match');
    }
  }
  const normalizedTitle = normalizeSearchText(task.title);
  if (normalizedTitle && prompt.includes(normalizedTitle)) {
    score += 60;
    reasons.push('title-exact');
  } else {
    const overlap = countTokenOverlap(prompt, task.title);
    if (overlap >= 2) {
      score += Math.min(30, overlap * 8);
      reasons.push('title-token-overlap');
    }
  }
  if (/(?:\u4efb\u52d9\u5361|task\s*card)/i.test(intent.userPrompt ?? '') && /\.task\.md$/i.test(task.taskPath)) {
    score += 10;
    reasons.push('task-card-surface');
  }
  if (task.taskPath && isTaskPathUnderPreferredPlanningRoots(cwd, task.taskPath)) {
    score += 15;
    reasons.push('canonical-planning-root');
  }
  return {
    ...task,
    matchScore: score,
    matchReasons: reasons
  };
}

export function applyOrdinalScope(tasks: readonly ImportedTaskSummary[], intent: TaskIntent): readonly ImportedTaskSummary[] {
  const planScoped = tasks.filter((task) => (task.matchReasons ?? []).some((reason) => reason.includes('plan') || reason.includes('root') || reason.includes('task-id')));
  const source = planScoped.length > 0 ? planScoped : tasks;
  if (!intent.ordinalScope) return source;
  return [...source]
    .sort((left, right) => left.workItemId.localeCompare(right.workItemId))
    .slice(0, intent.ordinalScope.count);
}



export function resolveRouteTargetRepo(tasks: readonly ImportedTaskSummary[]): string | null {
  const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry): entry is string => Boolean(entry)));
  return targets.length === 1 ? targets[0] : null;
}

export function extractTaskRootHintsFromPrompt(prompt: string, mentionedTaskIds: readonly string[]): readonly string[] {
  const directRoots = (prompt.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+\b/g) ?? [])
    .map((entry) => entry.toUpperCase())
    .filter((entry) => !/\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(entry));
  const derivedRoots = mentionedTaskIds
    .map((taskId) => taskId.match(/^(.*)-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/)?.[1] ?? null)
    .filter((entry): entry is string => Boolean(entry));
  return uniqueSorted([...directRoots, ...derivedRoots]);
}

export function extractTaskIdReferencesFromPrompt(prompt: string): readonly string[] {
  const references = new Set<string>();
  for (const match of prompt.matchAll(/\b(?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*\b/gi)) {
    const reference = match[0].toUpperCase();
    if (!isBacklogIdentifier(reference)) {
      references.add(reference);
    }
  }
  for (const match of prompt.matchAll(/\b((?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,})((?:\s*[\/,]\s*\d{2,})+)/gi)) {
    const prefix = match[1]?.toUpperCase();
    const firstNumber = match[2] ?? '';
    const suffix = match[3] ?? '';
    if (!prefix || !firstNumber) continue;
    for (const numberMatch of suffix.matchAll(/\d{2,}/g)) {
      const number = numberMatch[0]?.padStart(firstNumber.length, '0');
      if (number) references.add(`${prefix}-${number}`);
    }
  }
  return [...references].sort((left, right) => left.localeCompare(right));
}

export function isBacklogIdentifier(reference: string): boolean {
  return /^(?:ATM|PROJECT)-BUG-\d{4}-\d{2}-\d{2}-\d{3}$/i.test(reference.trim());
}

export function expandTaskIdReferenceAliases(taskIdReference: string): readonly string[] {
  const normalized = taskIdReference
    .trim()
    .toUpperCase()
    .replace(/_/g, '-')
    .replace(/^[`"'(]+|[`"'):;,]+$/g, '');
  if (!normalized) return [];
  const aliases = new Set<string>([normalized]);
  if (normalized.startsWith('TASK-')) {
    aliases.add(normalized.slice('TASK-'.length));
  } else if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(normalized)) {
    aliases.add(`TASK-${normalized}`);
  }
  return [...aliases];
}

export function extractTaskFamilyRootHintsFromPrompt(prompt: string): readonly string[] {
  const ignoredCodes = new Set(['AI', 'API', 'ATM', 'CLI', 'CPU', 'CSS', 'GIT', 'HTML', 'HTTP', 'JSON', 'MD', 'NPM', 'SDK', 'TASK', 'TS', 'UI']);
  const output = new Set<string>();
  for (const match of prompt.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)) {
    const code = match[1]?.toUpperCase();
    if (!code || ignoredCodes.has(code)) continue;
    const index = match.index ?? 0;
    const context = prompt.slice(Math.max(0, index - 30), Math.min(prompt.length, index + code.length + 40));
    if (/(?:\u7cfb\u5217|\u4efb\u52d9\u5361|\u4efb\u52d9|\u5f8c\u9762|\u5f8c\u7e8c|\u5269\u9918|\u63a5\u4e0b\u4f86|\u9010\u4e00|task\s*cards?|tasks?|task\s*family|family|remaining|next|later)/i.test(context)) {
      output.add(`TASK-${code}`);
    }
  }
  return [...output].sort((left, right) => left.localeCompare(right));
}

export function dedupeTasks(tasks: readonly ImportedTaskSummary[]): readonly ImportedTaskSummary[] {
  const seen = new Set<string>();
  const output: ImportedTaskSummary[] = [];
  for (const task of tasks) {
    const key = task.workItemId;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(task);
  }
  return output;
}

// Harmless comment for TASK-AAO-0120 deliverable check 3
export interface ImportedTaskSummaryWithOutOfScope extends ImportedTaskSummary {
  readonly outOfScope?: readonly string[];
}

export function finalizeImportedTaskSummary(task: Omit<ImportedTaskSummary, 'planningReadOnlyPaths' | 'planningMirrorPaths' | 'targetAllowedFiles'> & { readonly outOfScope?: readonly string[] }, cwd?: string): ImportedTaskSummaryWithOutOfScope {
  const partition = partitionTaskScope(task, cwd ? { cwd } : undefined);
  return {
    ...task,
    planningReadOnlyPaths: partition.planningContext.readOnlyPaths,
    planningMirrorPaths: partition.targetWork.planningMirrorPaths,
    targetAllowedFiles: partition.targetWork.allowedFiles
  };
}

export function withMirrorSyncOnlyTarget<T extends ImportedTaskSummary>(task: T): T {
  return {
    ...task,
    targetAllowedFiles: []
  };
}

export function withMirrorSyncOnlyTargetQueue(queue: ImportedTaskQueue, taskId: string): ImportedTaskQueue {
  const rewrite = (task: ImportedTaskSummary) => task.workItemId === taskId ? withMirrorSyncOnlyTarget(task) : task;
  return {
    ...queue,
    selectedTask: queue.selectedTask ? rewrite(queue.selectedTask) : queue.selectedTask,
    claimableTask: queue.claimableTask && queue.claimableTask.workItemId === taskId ? null : queue.claimableTask,
    tasks: queue.tasks.map(rewrite),
    promptScope: queue.promptScope
      ? {
        ...queue.promptScope,
        selectedTasks: queue.promptScope.selectedTasks.map(rewrite)
      }
      : queue.promptScope
  };
}

export function extractDeclaredTaskPathsFromDocument(taskDocument: Record<string, unknown>) {
  const files = new Set<string>();
  for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles', 'deliverables', 'artifacts']) {
    collectDeclaredTaskPathValues(taskDocument[key], files);
  }
  const source = taskDocument.source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const sourceRecord = source as Record<string, unknown>;
    collectDeclaredTaskPathValues(sourceRecord.path, files);
    collectDeclaredTaskPathValues(sourceRecord.planPath, files);
  }
  for (const key of ['notes', 'summary', 'description', 'acceptance']) {
    collectDeclaredTaskPathValues(taskDocument[key], files);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

export function extractLinkedSourceTaskArtifactPaths(cwd: string, sourcePlanPath: string | null) {
  if (!sourcePlanPath) return [];
  const absolutePlanPath = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
  if (!existsSync(absolutePlanPath)) return [];
  try {
    return extractTaskArtifactPathsFromMarkdown(cwd, readFileSync(absolutePlanPath, 'utf8'));
  } catch {
    return [];
  }
}

function collectDeclaredTaskPathValues(value: unknown, files: Set<string>) {
  if (typeof value === 'string') {
    const normalized = normalizeOptionalTaskPath(value);
    if (normalized && isTaskDirectionPathCandidate(normalized)) {
      files.add(normalized);
    }
    for (const candidate of extractPathLikeStringsFromText(value)) {
      files.add(candidate);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDeclaredTaskPathValues(entry, files);
    }
  }
}

export function extractTaskArtifactPathsFromMarkdown(cwd: string, text: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(text),
    ...resolveBareArtifactPathCandidates(cwd, extractBareArtifactFileNames(text)),
    ...extractCommandSurfacePathsFromMarkdown(text)
  ]);
}

function extractPathLikeStringsFromText(text: string) {
  const candidates = new Set<string>();
  const matches = text.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|\.github|\.claude|\.cursor|\.gemini)(?:\/[A-Za-z0-9._-]+)+\b|\b(?:atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)\b/g);
  for (const match of matches) {
    const normalized = normalizeOptionalTaskPath(match[0]);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function extractBareArtifactFileNames(text: string) {
  const candidates = new Set<string>();
  const matches = text.matchAll(/(?:^|[\s`"'([>-])([A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|jsonl|md|csv|tsv|txt|ya?ml|html|xml))(?:$|[\s`"')\]<,.;:])/gmi);
  for (const match of matches) {
    const fileName = match[1]?.trim();
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) continue;
    if (fileName.length > 120) continue;
    candidates.add(fileName);
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function resolveBareArtifactPathCandidates(cwd: string, fileNames: readonly string[]) {
  if (fileNames.length === 0) return [];
  const output = new Set<string>();
  const knownArtifactFiles = listKnownArtifactFiles(cwd);
  const artifactFilesByBasename = new Map<string, string[]>();
  for (const artifactPath of knownArtifactFiles) {
    const key = path.basename(artifactPath).toLowerCase();
    const existing = artifactFilesByBasename.get(key) ?? [];
    existing.push(artifactPath);
    artifactFilesByBasename.set(key, existing);
  }

  for (const fileName of fileNames) {
    for (const candidateName of artifactFileNameVariants(fileName)) {
      for (const existingPath of artifactFilesByBasename.get(candidateName.toLowerCase()) ?? []) {
        output.add(existingPath);
      }
      const atomizationCoveragePath = resolveAtomizationCoverageArtifactPath(candidateName);
      if (atomizationCoveragePath) {
        output.add(atomizationCoveragePath);
      }
    }
  }
  return [...output].sort((left, right) => left.localeCompare(right));
}

function listKnownArtifactFiles(cwd: string) {
  const roots = [
    'atomic_workbench',
    'artifacts',
    'docs',
    'fixtures',
    'reports',
    'schemas'
  ];
  return uniqueSorted(roots.flatMap((root) => {
    const absoluteRoot = path.join(cwd, root);
    return listFilesRecursive(absoluteRoot, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return ['.json', '.jsonl', '.md', '.csv', '.tsv', '.txt', '.yaml', '.yml'].includes(ext);
    }).map((filePath) => path.relative(cwd, filePath).replace(/\\/g, '/'));
  }));
}

function artifactFileNameVariants(fileName: string) {
  const variants = new Set<string>();
  const normalized = fileName.trim();
  if (!normalized) return [];
  variants.add(normalized);
  if (normalized.startsWith('atm-')) {
    variants.add(normalized.slice('atm-'.length));
  }
  return [...variants].sort((left, right) => left.localeCompare(right));
}

function resolveAtomizationCoverageArtifactPath(fileName: string) {
  const basename = path.basename(fileName);
  const atomizationCoverageArtifacts = new Set([
    'dogfood-score.json',
    'dogfood-score.md',
    'exclusion-inventory.json',
    'generated-fixture-boundaries.json',
    'path-to-atom-map.json',
    'manifest.json'
  ]);
  if (!atomizationCoverageArtifacts.has(basename)) return null;
  if (basename === 'manifest.json') {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json';
  }
  return `atomic_workbench/atomization-coverage/${basename}`;
}

function extractCommandSurfacePathsFromMarkdown(text: string) {
  const paths = new Set<string>();
  for (const match of text.matchAll(/\bnode\s+atm\.mjs\s+(guard|validate)\s+([a-z][a-z0-9-]*)\b/gi)) {
    const command = match[1]?.toLowerCase();
    const topic = match[2]?.toLowerCase();
    if (command === 'guard') {
      paths.add('packages/cli/src/commands/guard.ts');
    }
    if (command === 'validate') {
      paths.add('packages/cli/src/commands/validate.ts');
      addValidateTopicPaths(paths, topic);
    }
  }
  for (const match of text.matchAll(/\bnpm\s+run\s+validate:([a-z][a-z0-9-]*)\b/gi)) {
    addValidateTopicPaths(paths, match[1]?.toLowerCase());
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function addValidateTopicPaths(paths: Set<string>, topic: string | undefined) {
  if (!topic) return;
  paths.add('package.json');
  paths.add(`scripts/validate-${topic}.ts`);
}

export function resolveQuickfixScope(prompt: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(prompt),
    ...extractPathLikeStringsFromPrompt(prompt)
  ]);
}


interface PendingTaskArtifactScopeDiagnostic {
  readonly schemaId: 'atm.taskArtifactScopeDiagnostic.v1';
  readonly ignoredUntrackedFiles: readonly string[];
  readonly advisoryTrackedFiles: readonly string[];
}

/**
 * TASK-AAO-0011: claim/checkpoint must not hard-block on unrelated untracked
 * files (e.g. an unrelated svg in `docs/assets/`, a peer agent's WIP, screenshots,
 * tmp patches). Untracked candidates are demoted to a warning surfaced via
 * `ignoredUntrackedFiles`; the claim still produces a valid direction lock.
 *
 * The hard-block path remains for STAGED or MODIFIED-TRACKED files that look
 * like a deliverable for this task but live outside its allowedFiles — those
 * are the real "scope expansion required" cases that demand
 * `tasks scope --add` instead of editing runtime locks.
 */
export function checkPendingTaskArtifactScopeExpansion(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
}): PendingTaskArtifactScopeDiagnostic {
  const allowedFiles = buildAllowedFilesForTask(input.task);
  const { stagedOrTracked, untracked } = listPendingGitFilesByKind(input.cwd);
  const foreignDirectionLocks = readActiveTaskDirectionLocks(input.cwd)
    .filter((lock) => lock.taskId !== input.task.workItemId);
  const outsideScope = (entry: string) =>
    !entry.startsWith('.atm/') && !isPathAllowedByScope(entry, allowedFiles);
  const isAdvisoryOutsideScopePath = (entry: string) =>
    isAdvisoryPendingTaskArtifactPath(entry)
    || foreignDirectionLocks.some((lock) => isPathAllowedByScope(entry, lock.allowedFiles));

  const advisoryTrackedFiles = stagedOrTracked
    .filter(outsideScope)
    .filter(isAdvisoryOutsideScopePath);
  const stagedExpansion = stagedOrTracked
    .filter(outsideScope)
    .filter((entry) => !isAdvisoryOutsideScopePath(entry))
    .filter((entry) => looksLikeTaskArtifact(entry, input.task));
  const untrackedExpansion = untracked
    .filter(outsideScope)
    .filter((entry) => !isAdvisoryOutsideScopePath(entry))
    .filter((entry) => looksLikeTaskArtifact(entry, input.task));

  if (stagedExpansion.length > 0) {
    throw new CliError(
      'ATM_TASK_SCOPE_EXPANSION_REQUIRED',
      `Task ${input.task.workItemId} has staged or modified deliverable-like files outside targetWork.allowedFiles; update the task scope/deliverables instead of editing runtime locks.`,
      {
        exitCode: 1,
        details: {
          taskId: input.task.workItemId,
          outsideAllowedFiles: stagedExpansion,
          advisoryTrackedFiles,
          ignoredUntrackedFiles: untrackedExpansion,
          allowedFiles,
          requiredAction: 'Add these real deliverables to the task card frontmatter scope/deliverables (then re-import) or run `node atm.mjs tasks scope --add <paths>`; do not edit runtime locks.',
          notAllowed: 'Do not edit .atm/runtime/locks/** or task direction lock JSON to bypass this scope mismatch.'
        }
      }
    );
  }

  return {
    schemaId: 'atm.taskArtifactScopeDiagnostic.v1',
    ignoredUntrackedFiles: untrackedExpansion,
    advisoryTrackedFiles
  };
}

function isAdvisoryPendingTaskArtifactPath(filePath: string): boolean {
  const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
  if (!normalized) return false;
  return normalized === 'atomic_workbench/atomization-coverage/path-to-atom-map.json'
    || normalized.startsWith('release/atm-root-drop/')
    || normalized.startsWith('release/atm-onefile/');
}

function listPendingGitFilesByKind(cwd: string): {
  readonly stagedOrTracked: readonly string[];
  readonly untracked: readonly string[];
} {
  const collect = (args: readonly string[]) => {
    const result = spawnSync('git', args as string[], { cwd, encoding: 'utf8' });
    if (result.status !== 0) return [] as string[];
    return result.stdout
      .split(/\r?\n/)
      .map((entry: string) => normalizeOptionalTaskPath(entry))
      .filter((entry: string | null): entry is string => Boolean(entry));
  };
  const staged = [
    ...collect(['diff', '--name-only', '--cached']),
    ...collect(['diff', '--name-only'])
  ];
  const untracked = collect(['ls-files', '--others', '--exclude-standard']);
  return {
    stagedOrTracked: uniqueSorted(staged),
    untracked: uniqueSorted(untracked)
  };
}

function listPendingGitFiles(cwd: string): readonly string[] {
  const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
  return uniqueSorted([...stagedOrTracked, ...untracked]);
}

function listIgnoredArtifactCandidates(cwd: string): readonly string[] {
  const artifactRoots = ['artifacts', 'reports', 'atomic_workbench/evidence', 'atomic_workbench/reports'];
  const result = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...artifactRoots], {
    cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) return [];
  return uniqueSorted(result.stdout
    .split(/\r?\n/)
    .map((entry: string) => normalizeOptionalTaskPath(entry))
    .filter((entry: string | null): entry is string => Boolean(entry)));
}

function isPromptGeneratedArtifactPath(filePath: string): boolean {
  const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
  if (!normalized) return false;
  return normalized.startsWith('artifacts/')
    || normalized.startsWith('reports/')
    || normalized.startsWith('atomic_workbench/evidence/')
    || normalized.startsWith('atomic_workbench/reports/');
}

function buildPromptWorktreeHint(cwd: string, prompt: string) {
  const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
  const ignoredArtifacts = listIgnoredArtifactCandidates(cwd);
  const promptPathHints = extractPathLikeStringsFromText(prompt);
  const promptMatchedFiles = new Set<string>();
  const atmManagedFiles = new Set<string>();
  const generatedArtifactFiles = new Set<string>();
  const releaseMirrorFiles = new Set<string>();
  const unrelatedTrackedFiles = new Set<string>();
  const unrelatedUntrackedFiles = new Set<string>();
  const matchesPromptHint = (filePath: string) => promptPathHints.some((hint) =>
    filePath === hint
    || filePath.startsWith(`${hint}/`)
    || hint.startsWith(`${filePath}/`)
  );

  const classify = (filePath: string, tracked: boolean) => {
    if (matchesPromptHint(filePath)) {
      promptMatchedFiles.add(filePath);
      return;
    }
    if (filePath.startsWith('.atm/')) {
      atmManagedFiles.add(filePath);
      return;
    }
    if (filePath.startsWith('release/')) {
      releaseMirrorFiles.add(filePath);
      return;
    }
    if (isPromptGeneratedArtifactPath(filePath)) {
      generatedArtifactFiles.add(filePath);
      return;
    }
    (tracked ? unrelatedTrackedFiles : unrelatedUntrackedFiles).add(filePath);
  };

  stagedOrTracked.forEach((filePath) => classify(filePath, true));
  untracked.forEach((filePath) => classify(filePath, false));

  return {
    schemaId: 'atm.promptWorktreeHint.v1' as const,
    promptPathHints,
    promptMatchedFiles: uniqueSorted([...promptMatchedFiles]),
    atmManagedFiles: uniqueSorted([...atmManagedFiles]),
    generatedArtifactFiles: uniqueSorted([...generatedArtifactFiles]),
    releaseMirrorFiles: uniqueSorted([...releaseMirrorFiles]),
    unrelatedTrackedFiles: uniqueSorted([...unrelatedTrackedFiles]),
    unrelatedUntrackedFiles: uniqueSorted([...unrelatedUntrackedFiles]),
    ignoredArtifactCount: ignoredArtifacts.length,
    note: 'No task scope is active yet. Prompt-matched files are only hints; every other dirty bucket stays advisory until ATM selects a governed route or task.'
  };
}

function buildIgnoredArtifactForceAddHints(cwd: string) {
  return listIgnoredArtifactCandidates(cwd).map((filePath) => ({
    path: filePath,
    requiredCommand: `git add -f -- ${quoteCliValue(filePath)}`,
    reason: 'This path is currently hidden by .gitignore; use force-add only if it is the intended deliverable for the selected route.'
  }));
}

export function buildNonPlaybookRouteHints(cwd: string, prompt: string) {
  return {
    playbookState: 'absent' as const,
    structuredOutputHint: {
      schemaId: 'atm.nextStructuredOutputHint.v1' as const,
      hasPlaybook: false,
      treatCliJsonAs: 'structured-tool-guidance' as const,
      followNextActionField: 'evidence.nextAction.command' as const
    },
    ignoredArtifactForceAddHints: buildIgnoredArtifactForceAddHints(cwd),
    promptWorktreeHint: buildPromptWorktreeHint(cwd, prompt)
  };
}



export function listTaskCardFiles(cwd: string): readonly string[] {
  const output = new Set<string>();
  for (const filePath of listRootLevelTaskCardFiles(cwd)) {
    output.add(filePath);
  }
  for (const root of listTaskCardDiscoveryRoots(cwd)) {
    for (const filePath of listFilesRecursive(root, (candidate) => candidate.endsWith('.task.md'))) {
      output.add(filePath);
    }
  }
  return uniqueSorted(Array.from(output));
}

function listRootLevelTaskCardFiles(cwd: string): readonly string[] {
  return safeReadDir(cwd)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.task.md'))
    .map((entry) => path.join(cwd, entry.name));
}

function listTaskCardDiscoveryRoots(cwd: string): readonly string[] {
  const relativeRoots = [
    'docs',
    'atomic_workbench',
    'specs',
    'schemas',
    'templates',
    'integrations',
    'examples',
    'tests',
    'packages',
    'scripts',
    '.agents',
    '.github',
    '.claude',
    '.cursor',
    '.gemini'
  ];
  return uniqueSorted(relativeRoots
    .map((entry) => path.join(cwd, entry))
    .filter((entry) => existsSync(entry)));
}

export function listPromptScopedExternalTaskCardFiles(
  cwd: string,
  intent: TaskIntent | null,
  planningRoots: readonly string[] = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
  }).roots
): readonly string[] {
  if (!intent?.userPrompt || !intent.taskScopeMentioned) return [];
  const output = new Set<string>();
  for (const root of planningRoots) {
    const markdownFiles = listFilesRecursive(root, (filePath) => filePath.endsWith('.md') && !filePath.endsWith('.task.md'));
    for (const planPath of markdownFiles) {
      if (!planFileMatchesPrompt(cwd, planPath, intent)) continue;
      const taskDir = path.join(path.dirname(planPath), 'tasks');
      for (const taskPath of listFilesRecursive(taskDir, (filePath) => filePath.endsWith('.task.md'))) {
        output.add(taskPath);
      }
    }
    if (intent.mentionedTaskIds.length > 0 || intent.taskRootHints.length > 0) {
      for (const taskPath of listFilesRecursive(root, (filePath) => filePath.endsWith('.task.md'))) {
        if (taskCardPathMatchesIntent(taskPath, intent)) {
          output.add(taskPath);
        }
      }
    }
  }
  return uniqueSorted(Array.from(output));
}

export function isTaskPathUnderPreferredPlanningRoots(cwd: string, taskPath: string): boolean {
  const absoluteTaskPath = path.resolve(cwd, taskPath);
  const resolution = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
  });
  return resolution.roots.some((root) => absoluteTaskPath.startsWith(`${root}${path.sep}`));
}

function planFileMatchesPrompt(cwd: string, planPath: string, intent: TaskIntent): boolean {
  const prompt = normalizeSearchText(intent.userPrompt ?? '');
  const relativePlanPath = path.relative(cwd, planPath).replace(/\\/g, '/');
  if (intent.mentionedPlanPaths.some((hint) => pathFieldMatches(relativePlanPath, hint) || pathFieldMatches(planPath, hint))) {
    return true;
  }

  const stem = normalizeSearchText(path.basename(planPath).replace(/\.[^.]+$/, ''));
  if (stem.length >= 8 && prompt.includes(stem)) return true;

  const title = readMarkdownTitle(planPath);
  const normalizedTitle = title ? normalizeSearchText(title) : '';
  if (normalizedTitle.length >= 8 && prompt.includes(normalizedTitle)) return true;

  return false;
}

function readMarkdownTitle(filePath: string): string | null {
  try {
    const head = readFileSync(filePath, 'utf8').split(/\r?\n/, 40);
    for (const line of head) {
      const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  } catch {
    return null;
  }
  return null;
}

function taskCardPathMatchesIntent(taskPath: string, intent: TaskIntent): boolean {
  const normalizedTaskPath = normalizeSearchText(taskPath);
  const basename = path.basename(taskPath).replace(/\.task\.md$/i, '').toUpperCase();
  if (intent.mentionedTaskIds.some((taskId) => basename === taskId || normalizedTaskPath.includes(normalizeSearchText(taskId)))) {
    return true;
  }
  return intent.taskRootHints.some((hint) => {
    const normalizedHint = normalizeSearchText(hint);
    return normalizedHint.length > 0 && normalizedTaskPath.includes(normalizedHint);
  });
}

function listFilesRecursive(directoryPath: string, predicate: (filePath: string) => boolean): readonly string[] {
  if (!existsSync(directoryPath)) return [];
  const stats = safeStat(directoryPath);
  if (!stats) return [];
  if (stats.isFile()) return predicate(directoryPath) ? [directoryPath] : [];
  const output: string[] = [];
  for (const entry of safeReadDir(directoryPath)) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory() && shouldSkipRecursiveDiscoveryDirectory(absolutePath)) continue;
    if (entry.isDirectory()) {
      output.push(...listFilesRecursive(absolutePath, predicate));
    } else if (entry.isFile() && predicate(absolutePath)) {
      output.push(absolutePath);
    }
  }
  return output;
}

export function findNearbyPlanPaths(cwd: string, taskPath: string): readonly string[] {
  const taskDir = path.dirname(taskPath);
  const parent = path.basename(taskDir).toLowerCase() === 'tasks' ? path.dirname(taskDir) : taskDir;
  if (!existsSync(parent)) return [];
  return safeReadDir(parent)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.task.md'))
    .map((entry) => path.relative(cwd, path.join(parent, entry.name)).replace(/\\/g, '/'));
}

function safeReadDir(directoryPath: string): readonly Dirent[] {
  try {
    return readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(filePath: string) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function shouldSkipRecursiveDiscoveryDirectory(directoryPath: string) {
  const normalized = directoryPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const ignoredSegmentNames = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'release',
    '.atm-temp',
    'scratch',
    'tmp',
    'temp',
    'library',
    'coverage',
    '.next',
    '.turbo'
  ]);
  const basename = segments[segments.length - 1] ?? '';
  if (ignoredSegmentNames.has(basename)) return true;
  return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp'));
}



export function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}







export function detectRequestedTaskAction(prompt: string): RequestedTaskAction | null {
  if (/\u91cd\u505a|redo/i.test(prompt)) return 'redo';
  if (/\u91cd\u65b0\u6253\u958b|reopen/i.test(prompt)) return 'reopen';
  if (/\u95dc\u9589|\u5b8c\u6210|close|done/i.test(prompt)) return 'close';
  if (/audit|\u7a3d\u6838|\u6aa2\u8a0e/i.test(prompt)) return 'audit';
  if (/cleanup|\u6e05\u7406/i.test(prompt)) return 'cleanup';
  if (/\u5206\u6790|analy[sz]e/i.test(prompt)) return 'analyze';
  if (/implement|\u5be6\u4f5c|\u958b\u767c/i.test(prompt)) return 'implement';
  return null;
}



export function extractPromptPathHints(prompt: string): readonly string[] {
  const matches = prompt.match(/(?:[A-Za-z]:)?(?:[A-Za-z0-9_%\u4e00-\u9fff() -]+[\\/])+[A-Za-z0-9_%\u4e00-\u9fff(). -]+(?:\.md)?|[A-Za-z0-9_%\u4e00-\u9fff() -]+\.md/gi) ?? [];
  return uniqueSorted(matches
    .map((entry) => entry.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter((entry) => entry.length > 2)
    .filter((entry) => /[./\\]|\.md$/i.test(entry))
    .filter(isLikelyPromptPathHint));
}

export interface PromptScopedTaskContext {
  readonly taskIntent: {
    readonly userPrompt: string | null;
    readonly explicitTaskIds: readonly string[];
    readonly taskScopeMentioned: boolean;
    readonly requestedAction: RequestedTaskAction | null;
    readonly source: TaskIntentSource;
  } | null;
  readonly promptScope: {
    readonly status: PromptScopedRouteStatus;
    readonly selectedTasks: readonly ImportedTaskSummary[];
    readonly targetRepo: string | null;
    readonly diagnostics: readonly string[];
  } | null;
}

export function inspectImportedTaskQueue(cwd: string, taskIntent: TaskIntent | null, claimIntent: NextClaimIntent = 'write'): ImportedTaskQueue {
  const profile = createNextProfiler('ATM_NEXT_QUEUE_PROFILE');
  const planningRootResolution = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
  });
  profile.mark('resolve-planning-roots');
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  const jsonTasks = existsSync(taskStorePath) ? readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ImportedTaskSummaryWithOutOfScope[] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const rawText = readFileSync(filePath, 'utf8');
        const metadata = extractJsonTaskMetadata(rawText);
        if (metadata.schemaVersion !== 'atm.workItem.v0.2' && !metadata.hasSource) {
          return [];
        }
        const workItemId = metadata.workItemId;
        if (!workItemId) return [];
        const status = metadata.status ?? 'planned';
        const shouldHydrateScope = isTaskRoutable(status, taskIntent)
          || isTaskIdMentioned(workItemId, taskIntent)
          || (isHandoffPrompt(taskIntent?.userPrompt ?? '') && normalizeTaskRouteStatus(status) === 'running');
        if (!shouldHydrateScope) {
          return [buildMinimalImportedJsonTaskSummary({
            cwd,
            filePath,
            workItemId,
            title: metadata.title ?? workItemId,
            status,
            sourcePlanPath: metadata.sourcePlanPath
          })];
        }
        const parsed = parseJsonText(rawText) as Record<string, unknown>;
        const dependencies = Array.isArray(parsed.dependencies)
          ? parsed.dependencies.filter((entry): entry is string => typeof entry === 'string')
          : [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        const source = parsed.source && typeof parsed.source === 'object' ? parsed.source as Record<string, unknown> : {};
        const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
        const outOfScope = readStringArray(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
        return [finalizeImportedTaskSummary({
          workItemId,
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : workItemId,
          status,
          closedAt: normalizeOptionalString(parsed.closedAt ?? parsed.closed_at),
          closedByActor: normalizeOptionalString(parsed.closedByActor ?? parsed.closed_by_actor),
          closurePacket: normalizeOptionalString(parsed.closurePacket ?? parsed.closure_packet),
          lastTransitionId: normalizeOptionalString(parsed.lastTransitionId ?? parsed.last_transition_id),
          lastTransitionAt: normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at),
          milestone: typeof parsed.milestone === 'string' ? parsed.milestone : null,
          dependencies,
          taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
          format: 'json',
          sourcePlanPath,
          nearbyPlanPaths: [],
          scopePaths: shouldHydrateScope ? (() => {
            const explicit = uniqueSorted([
              ...readStringArray(parsed.scope),
              ...readStringArray(parsed.scopePaths),
              ...readStringArray(parsed.files)
            ].map((p) => {
              const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
              return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
            }));
            const claimFiles = readStringArray(claimRecord.files);
            // ATM-BUG-2026-07-07-043/044: `tasks scope add` merges amended paths into
            // taskDirectionLock.allowedFiles (and claim.files), but never rewrites this
            // task's own static scope/scopePaths/files declaration. Re-hydrating scope
            // here from `explicit` alone (and filtering claim.files against it) silently
            // dropped scope-amendment paths on the next `next --claim`. Treat the
            // governed taskDirectionLock.allowedFiles as an equally trusted source so
            // scope amendments survive re-claim.
            const directionLock = parsed.taskDirectionLock;
            const lockAllowedFiles = directionLock && typeof directionLock === 'object' && !Array.isArray(directionLock)
              ? readStringArray((directionLock as Record<string, unknown>).allowedFiles)
              : [];
            const rawScope = explicit.length > 0
              ? uniqueSorted([
                ...explicit,
                ...claimFiles.filter((file) => isPathAllowedByScope(file, explicit)),
                ...lockAllowedFiles
              ])
              : uniqueSorted([
                ...extractDeclaredTaskPathsFromDocument(parsed),
                ...extractLinkedSourceTaskArtifactPaths(cwd, sourcePlanPath)
              ].map((p) => {
                const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
              }));
            return outOfScope.length > 0
              ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
              : rawScope;
          })() : [],
          outOfScope,
          targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
          planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
          allowPlanningMirror: allowsPlanningMirror(parsed),
          closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
          activeClaimActorId: claimRecord.state === 'active' && typeof claimRecord.actorId === 'string'
            ? claimRecord.actorId
            : null,
          activeClaimIntent: claimRecord.state === 'active' && typeof claimRecord.intent === 'string'
            ? claimRecord.intent
            : (claimRecord.state === 'active' ? 'write' : null)
        }, cwd)];
      } catch {
        return [];
      }
    }) : [];
  profile.mark(`read-json-tasks count=${jsonTasks.length}`);
  const skipMarkdownTaskDiscovery = shouldSkipMarkdownTaskDiscovery(cwd, jsonTasks, taskIntent);
  profile.mark(`should-skip-markdown-task-discovery value=${skipMarkdownTaskDiscovery}`);
  const skipExternalTaskCardScan = skipMarkdownTaskDiscovery || shouldSkipExternalTaskCardScan(cwd, jsonTasks, taskIntent);
  profile.mark(`should-skip-external-task-card-scan value=${skipExternalTaskCardScan}`);
  const markdownTaskFiles = shouldDiscoverMarkdownTaskCards(taskIntent) && !skipMarkdownTaskDiscovery
    ? uniqueSorted([
      ...listTaskCardFiles(cwd),
      ...(skipExternalTaskCardScan ? [] : listPromptScopedExternalTaskCardFiles(cwd, taskIntent, planningRootResolution.roots))
    ])
    : [];
  profile.mark('list-markdown-task-files');
  const markdownTasks = markdownTaskFiles
    .map((filePath): ImportedTaskSummaryWithOutOfScope | null => {
      const rawText = readFileSync(filePath, 'utf8');
      const parsed = parseMarkdownFrontmatter(rawText);
      const workItemId = normalizeOptionalString(parsed.task_id ?? parsed.taskId ?? parsed.workItemId ?? parsed.id)
        ?? path.basename(filePath).replace(/\.task\.md$/, '');
      if (!workItemId) return null;
      const dependencies = splitListValue(parsed.dependencies ?? parsed.depends_on ?? parsed.dependsOn ?? parsed.blocked_by ?? parsed.blockedBy);
      const relativeTaskPath = path.relative(cwd, filePath).replace(/\\/g, '/');
      const outOfScope = splitListValue(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
      return finalizeImportedTaskSummary({
        workItemId,
        title: normalizeOptionalString(parsed.title ?? parsed.name) ?? workItemId,
        status: normalizeOptionalString(parsed.status) ?? 'planned',
        closedAt: normalizeOptionalString(parsed.closed_at ?? parsed.closedAt),
        closedByActor: normalizeOptionalString(parsed.closed_by_actor ?? parsed.closedByActor),
        closurePacket: normalizeOptionalString(parsed.closure_packet ?? parsed.closurePacket),
        lastTransitionId: normalizeOptionalString(parsed.last_transition_id ?? parsed.lastTransitionId),
        lastTransitionAt: normalizeOptionalString(parsed.last_transition_at ?? parsed.lastTransitionAt),
        milestone: normalizeOptionalString(parsed.milestone),
        dependencies,
        taskPath: relativeTaskPath,
        format: 'markdown',
        sourcePlanPath: normalizeOptionalString(parsed.plan_path ?? parsed.planPath ?? parsed.source_plan ?? parsed.sourcePlan ?? parsed.related_plan ?? parsed.relatedPlan),
        nearbyPlanPaths: findNearbyPlanPaths(cwd, filePath),
        scopePaths: (() => {
          const explicit = uniqueSorted([
            ...splitListValue(parsed.scope ?? parsed.scope_paths ?? parsed.scopePaths),
            ...splitListValue(parsed.files ?? parsed.file_paths ?? parsed.filePaths),
            ...splitListValue(parsed.allowed_files ?? parsed.allowedFiles),
            ...splitListValue(parsed.deliverables),
            ...splitListValue(parsed.paths)
          ].map((p) => {
            const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
            return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
          }));
          const rawScope = explicit.length > 0
            ? explicit
            : uniqueSorted([
              ...extractTaskArtifactPathsFromMarkdown(cwd, rawText)
            ].map((p) => {
              const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
              return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
            }));
          return outOfScope.length > 0
            ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
            : rawScope;
        })(),
        outOfScope,
        targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
        planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
        allowPlanningMirror: allowsPlanningMirror(parsed),
        closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
        activeClaimActorId: null,
        activeClaimIntent: null
      }, cwd);
    })
    .filter((entry): entry is ImportedTaskSummaryWithOutOfScope => entry !== null);
  profile.mark('read-markdown-tasks');
  const allTasks = dedupeTasks([...jsonTasks, ...markdownTasks]);
  profile.mark('dedupe-tasks');

  const tasks = allTasks
    .filter((task) => isTaskRoutable(task.status, taskIntent)
      || isTaskExplicitlyMentioned(task, taskIntent)
      || (isHandoffPrompt(taskIntent?.userPrompt ?? '') && isActiveClaimedTask(task)))
    .sort((left, right) => {
      const statusWeight = statusQueueWeight(left.status) - statusQueueWeight(right.status);
      return statusWeight !== 0 ? statusWeight : left.workItemId.localeCompare(right.workItemId);
    });
  const statusById = new Map(allTasks.map((task) => [task.workItemId, task.status]));
  const activeQueue = findActiveTaskQueueForIntent(cwd, taskIntent);
  profile.mark('find-active-task-queue');
  const activeQueueTasks = activeQueue
    ? activeQueue.taskIds
      .slice(activeQueue.currentIndex)
      .map((taskId) => allTasks.find((task) => task.workItemId === taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task))
    : [];
  const promptScope = activeQueue && activeQueueTasks.length > 0
    ? {
      status: 'queue' as const,
      selectedTasks: activeQueueTasks,
      targetRepo: activeQueue.targetRepo,
      diagnostics: [`active-queue:${activeQueue.queueId}`, `queue-index:${activeQueue.currentIndex}`]
    }
    : resolvePromptScopedTaskRoute(cwd, tasks, taskIntent, planningRootResolution);
  profile.mark('resolve-prompt-scoped-task-route');
  const planningRootMissing = promptScope?.status === 'not-found' && taskIntent
    ? shouldReportPlanningRootMissing({
      cwd,
      taskScopeMentioned: taskIntent.taskScopeMentioned,
      mentionedPlanPaths: taskIntent.mentionedPlanPaths,
      userPrompt: taskIntent.userPrompt,
      matchedTaskCount: tasks.filter((task) => (task.matchScore ?? 0) > 0).length
    })
    : null;
  const selectedTaskPool = promptScope?.selectedTasks ?? [];
  const explicitSingleTaskRoute = isExplicitSingleTaskRoute(promptScope, taskIntent);
  const selectedTask = selectImportedTaskForPromptScope(
    selectedTaskPool,
    promptScope?.status === 'queue',
    explicitSingleTaskRoute,
    statusById,
    cwd
  );
  profile.mark('select-imported-task-for-prompt-scope');
  const claimableTask = selectedTask
    && selectedTask.format === 'json'
    && (isSelectedTaskClaimableForIntent(selectedTask, claimIntent) || isTaskAlreadyActivelyClaimed(selectedTask))
    && (areTaskDependenciesSatisfied(selectedTask, statusById, cwd) || isTaskAlreadyActivelyClaimed(selectedTask))
    ? selectedTask
    : null;
  profile.mark('resolve-claimable-task');

  profile.flush('inspect-imported-task-queue');
  return {
    taskStorePath: existsSync(taskStorePath) ? path.relative(cwd, taskStorePath).replace(/\\/g, '/') : '.atm/history/tasks',
    openTaskCount: tasks.length,
    selectedTask,
    claimableTask,
    tasks,
    promptScope,
    planningRootWarnings: planningRootResolution.warnings,
    planningRootMissing
  };
}

export function isTaskIdMentioned(workItemId: string, intent: TaskIntent | null) {
  if (!intent || intent.mentionedTaskIds.length === 0) return false;
  return intent.mentionedTaskIds.includes(workItemId.trim().toUpperCase())
    || isTaskIdSuffixMentioned(workItemId, intent);
}

export function isTaskIdSuffixMentioned(workItemId: string, intent: TaskIntent | null) {
  if (!intent || intent.mentionedTaskIds.length === 0) return false;
  const normalizedWorkItemId = workItemId.trim().toUpperCase();
  return intent.mentionedTaskIds.some((taskId) => {
    const normalizedTaskId = taskId.trim().toUpperCase();
    return normalizedTaskId.length > 0
      && normalizedTaskId !== normalizedWorkItemId
      && normalizedWorkItemId.endsWith(`-${normalizedTaskId}`);
  });
}

export function extractJsonTaskMetadata(rawText: string) {
  const pick = (key: string) => {
    const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'm').exec(rawText);
    if (!match?.[1]) return null;
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  };
  const sourcePlanPath = /"source"\s*:\s*\{[\s\S]*?"planPath"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/m.exec(rawText)?.[1] ?? null;
  return {
    schemaVersion: pick('schemaVersion'),
    workItemId: pick('workItemId') ?? pick('id') ?? '',
    title: pick('title'),
    status: pick('status'),
    sourcePlanPath: sourcePlanPath ? JSON.parse(`"${sourcePlanPath}"`) as string : (pick('planPath') ?? pick('plan_path')),
    hasSource: /"source"\s*:/.test(rawText)
  };
}

export function buildMinimalImportedJsonTaskSummary(input: {
  readonly cwd: string;
  readonly filePath: string;
  readonly workItemId: string;
  readonly title: string;
  readonly status: string;
  readonly sourcePlanPath: string | null;
}): ImportedTaskSummaryWithOutOfScope {
  return {
    workItemId: input.workItemId,
    title: input.title,
    status: input.status,
    closedAt: null,
    closedByActor: null,
    closurePacket: null,
    lastTransitionId: null,
    lastTransitionAt: null,
    milestone: null,
    dependencies: [],
    taskPath: path.relative(input.cwd, input.filePath).replace(/\\/g, '/'),
    format: 'json',
    sourcePlanPath: input.sourcePlanPath,
    nearbyPlanPaths: [],
    scopePaths: [],
    outOfScope: [],
    targetRepo: null,
    planningRepo: null,
    allowPlanningMirror: false,
    closureAuthority: null,
    activeClaimActorId: null,
    activeClaimIntent: null,
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    targetAllowedFiles: []
  };
}

export function shouldSkipExternalTaskCardScan(
  cwd: string,
  jsonTasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null
): boolean {
  if (!taskIntent?.taskScopeMentioned) return false;
  if (taskIntent.mentionedPlanPaths.length > 0) return false;
  const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
  if (promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0) {
    return true;
  }
  if (taskIntent.mentionedTaskIds.length === 0 && taskIntent.taskRootHints.length === 0) return false;
  return jsonTasks.some((task) => isTaskExplicitlyMentioned(task, taskIntent));
}

export function shouldSkipMarkdownTaskDiscovery(
  cwd: string,
  jsonTasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null
): boolean {
  if (!taskIntent?.taskScopeMentioned) return false;
  if (taskIntent.mentionedPlanPaths.length > 0) return false;
  if (
    taskIntent.mentionedTaskIds.length > 0
    && jsonTasks.some((task) => isTaskIdMentioned(task.workItemId, taskIntent))
  ) {
    return true;
  }
  const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
  return Boolean(promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0);
}

export function selectImportedTaskForPromptScope(
  selectedTaskPool: readonly ImportedTaskSummary[],
  isActiveQueue: boolean,
  explicitSingleTaskRoute: boolean,
  statusById: ReadonlyMap<string, string>,
  cwd: string
): ImportedTaskSummary | null {
  if (isActiveQueue || explicitSingleTaskRoute) {
    return selectedTaskPool[0] ?? null;
  }
  return selectedTaskPool.find((task) => areTaskDependenciesSatisfied(task, statusById, cwd)) ?? null;
}

export function isSelectedTaskClaimableForIntent(task: ImportedTaskSummary, claimIntent: NextClaimIntent) {
  const status = normalizeTaskRouteStatus(task.status);
  if (canTaskBePreparedForClaim(status)) return true;
  return status === 'review' && claimIntent === 'closeout-only';
}

export function hasPromptScopedWorkItems(importedTaskQueue: ImportedTaskQueue) {
  return importedTaskQueue.tasks.some((task) => task.workItemId !== bootstrapTaskId);
}

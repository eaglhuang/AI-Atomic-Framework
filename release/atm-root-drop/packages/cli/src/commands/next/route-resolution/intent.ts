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
  isJournalingPrompt,
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
import { extractTaskFamilyRootHintsFromPrompt, extractTaskIdReferencesFromPrompt, expandTaskIdReferenceAliases, extractTaskRootHintsFromPrompt } from './matching.ts';
import { inspectImportedTaskQueue } from './queue-inspection.ts';

export type NextClaimIntent = 'write' | 'closeout-only';

export function createNextProfiler(header = 'ATM_NEXT_PROFILE') {
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

export function createDeterministicTaskIntent(prompt: string, explicitTaskIds: readonly string[] = []): TaskIntent {
  const journalingPrompt = isJournalingPrompt(prompt);
  const mentionedTaskIds = journalingPrompt ? [] : uniqueSorted(extractTaskIdReferencesFromPrompt(prompt).flatMap((entry) => expandTaskIdReferenceAliases(entry)));
  const mentionedPlanPaths = journalingPrompt ? [] : uniqueSorted(extractPromptPathHints(prompt).filter((entry) => /\.md$/i.test(entry)));
  const targetRepoHints = uniqueSorted([
    ...(/AI-Atomic-Framework|ATM\s*framework|ATM\s*\u6846\u67b6|ATM\u6846\u67b6|\u539f\u5b50\u6846\u67b6/i.test(prompt) ? ['AI-Atomic-Framework'] : [])
  ]);
  const taskRootHints = journalingPrompt ? [] : uniqueSorted([
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
  const queueRequested = isQueueRequestedPrompt(prompt) || (!journalingPrompt && Boolean(ordinalScope));
  const orderedExplicitTaskIds = uniqueInOrder(explicitTaskIds.map((entry) => entry.toUpperCase()));
  const taskScopeMentioned = (queueRequested || !journalingPrompt) && (orderedExplicitTaskIds.length > 0
    || mentionedTaskIds.length > 0
    || mentionedPlanPaths.length > 0
    || taskRootHints.length > 0
    || queueRequested
    || /\u4efb\u52d9\u5361|task\s*card|task[-_ ]?asa|\u8a08\u756b\u66f8/i.test(prompt));
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

export function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function detectRequestedTaskAction(prompt: string): RequestedTaskAction | null {
  if (/\u91cd\u505a|redo/i.test(prompt)) return 'redo';
  if (/\u91cd\u65b0\u6253\u958b|reopen/i.test(prompt)) return 'reopen';
  if (/\u95dc\u9589|\u5b8c\u6210|(?<![A-Za-z0-9-])close(?![A-Za-z0-9-])|(?<![A-Za-z0-9-])done(?![A-Za-z0-9-])/i.test(prompt)) return 'close';
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

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
import { resolveQuickfixScope } from './artifact-scope.ts';

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

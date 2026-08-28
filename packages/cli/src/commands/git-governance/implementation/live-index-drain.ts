/**
 * Drain reconciliation debt from its own durable receipt.
 *
 * `recoverLiveIndexAfterSuccessfulCommit` recovers one named commit, and proves
 * its pre-state from that commit's parent tree. That is the right proof while a
 * single commit is behind, and it correctly refuses once a later commit rewrote
 * the same path: the live index then holds the blob from before the FIRST
 * unreconciled commit, while the worktree matches HEAD, so no single commit's
 * parent-and-tree pair describes the state.
 *
 * Accumulated debt therefore needs its own proof, and it has one. A path is
 * drainable exactly when its live index entry still equals the parent tree of
 * the commit that first left it unreconciled — nothing has touched that entry
 * since — and its worktree bytes equal HEAD. Both facts are checked here per
 * path; anything else is retained untouched, including every foreign entry.
 *
 * The receipt supplies the lineage, so this needs no operator-supplied sha: the
 * durable record of the problem is sufficient input to the repair.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../../shared.ts';
import { runGitCommand } from './git-process-port.ts';
import {
  applyLiveIndexHeadEntry,
  readHeadCommit,
  readIndexEntries,
  readTreeEntries,
  readWorktreeEntries,
  sameEntry,
  type Entry
} from './live-index-reconciliation.ts';
import type { LiveIndexLockRetryPolicy } from './live-index-lock-retry.ts';

export const LIVE_INDEX_DRAIN_SCHEMA_ID = 'atm.liveIndexDrain.v1';

const QUIET_STDIO = ['ignore', 'pipe', 'pipe'] as const;

export type LiveIndexDrainSkipReason =
  | 'missing-lineage'
  | 'concurrent-index-change'
  | 'worktree-diverged'
  | 'unresolvable-lineage';

export interface LiveIndexDrainSkippedPath {
  readonly path: string;
  readonly reason: LiveIndexDrainSkipReason;
}

export interface LiveIndexDrain {
  readonly schemaId: typeof LIVE_INDEX_DRAIN_SCHEMA_ID;
  readonly taskId: string;
  readonly headSha: string | null;
  readonly dryRun: boolean;
  readonly mutated: boolean;
  readonly drainedPaths: readonly string[];
  /** Paths a previous drain already advanced; a repeat run is a no-op. */
  readonly alreadyAlignedPaths: readonly string[];
  readonly retainedPaths: readonly LiveIndexDrainSkippedPath[];
  readonly clean: boolean;
}

interface ReceiptRetainedEntry {
  readonly path?: unknown;
  readonly firstUnreconciledCommit?: unknown;
}

function receiptRelativePath(taskId: string): string {
  return `.atm/history/evidence/${taskId}.live-index-reconciliation.json`;
}

function readReceipt(cwd: string, taskId: string): readonly ReceiptRetainedEntry[] {
  const absolutePath = path.join(cwd, receiptRelativePath(taskId));
  if (!existsSync(absolutePath)) {
    throw new CliError(
      'ATM_LIVE_INDEX_DRAIN_RECEIPT_MISSING',
      'Draining reconciliation debt requires the durable live-index reconciliation receipt for this task.',
      { exitCode: 1, details: { taskId, expectedPath: receiptRelativePath(taskId) } }
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new CliError(
      'ATM_LIVE_INDEX_DRAIN_RECEIPT_UNREADABLE',
      'The live-index reconciliation receipt could not be parsed, so the debt it records cannot be proven.',
      { exitCode: 1, details: { taskId, path: receiptRelativePath(taskId), cause: String(error) } }
    );
  }
  const retained = (parsed as { retainedPaths?: unknown })?.retainedPaths;
  return Array.isArray(retained) ? (retained as ReceiptRetainedEntry[]) : [];
}

function resolveParentSha(cwd: string, commitSha: string): string | null {
  try {
    return runGitCommand(cwd, ['rev-parse', '--verify', `${commitSha}^`], QUIET_STDIO).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Advance every retained path whose pre-state is still provable, and leave the
 * rest exactly as they are.
 */
export function drainLiveIndexReconciliationReceipt(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly dryRun: boolean;
  readonly budgetBytes?: number;
  readonly lockRetry?: LiveIndexLockRetryPolicy;
}): LiveIndexDrain {
  const { cwd, taskId, dryRun, budgetBytes } = input;
  const headSha = readHeadCommit(cwd);
  const entries = readReceipt(cwd, taskId);
  const drainedPaths: string[] = [];
  const alreadyAlignedPaths: string[] = [];
  const retainedPaths: LiveIndexDrainSkippedPath[] = [];

  const paths = entries
    .map((entry) => (typeof entry?.path === 'string' ? entry.path : ''))
    .filter(Boolean);
  if (paths.length === 0 || headSha === null) {
    return report({ taskId, headSha, dryRun, drainedPaths, alreadyAlignedPaths, retainedPaths });
  }

  const current = readIndexEntries(cwd, paths, undefined, budgetBytes);
  const head = readTreeEntries(cwd, headSha, paths, budgetBytes);
  const worktree = readWorktreeEntries(cwd, paths, head, budgetBytes);

  for (const entry of entries) {
    const filePath = typeof entry?.path === 'string' ? entry.path : '';
    if (!filePath) continue;
    const lineage = typeof entry?.firstUnreconciledCommit === 'string' ? entry.firstUnreconciledCommit : '';
    if (!lineage) {
      // A receipt written before lineage was recorded cannot prove a pre-state.
      // It is reported, never guessed at.
      retainedPaths.push({ path: filePath, reason: 'missing-lineage' });
      continue;
    }
    // A drained path leaves the receipt describing history rather than debt.
    // Recognising it here is what makes a repeat run a no-op instead of reading
    // the completed repair as a concurrent index change.
    if (sameEntry(current[filePath], head[filePath])) {
      alreadyAlignedPaths.push(filePath);
      continue;
    }
    const parentSha = resolveParentSha(cwd, lineage);
    if (parentSha === null) {
      retainedPaths.push({ path: filePath, reason: 'unresolvable-lineage' });
      continue;
    }
    const preState: Entry = readTreeEntries(cwd, parentSha, [filePath], budgetBytes)[filePath] ?? null;
    if (!sameEntry(current[filePath], preState)) {
      retainedPaths.push({ path: filePath, reason: 'concurrent-index-change' });
      continue;
    }
    if (!sameEntry(worktree[filePath], head[filePath])) {
      retainedPaths.push({ path: filePath, reason: 'worktree-diverged' });
      continue;
    }
    if (!dryRun) {
      applyLiveIndexHeadEntry(cwd, filePath, head[filePath], input.lockRetry);
    }
    drainedPaths.push(filePath);
  }

  return report({ taskId, headSha, dryRun, drainedPaths, alreadyAlignedPaths, retainedPaths });
}

function report(input: {
  readonly taskId: string;
  readonly headSha: string | null;
  readonly dryRun: boolean;
  readonly drainedPaths: readonly string[];
  readonly alreadyAlignedPaths: readonly string[];
  readonly retainedPaths: readonly LiveIndexDrainSkippedPath[];
}): LiveIndexDrain {
  return {
    schemaId: LIVE_INDEX_DRAIN_SCHEMA_ID,
    taskId: input.taskId,
    headSha: input.headSha,
    dryRun: input.dryRun,
    mutated: !input.dryRun && input.drainedPaths.length > 0,
    drainedPaths: input.drainedPaths,
    alreadyAlignedPaths: input.alreadyAlignedPaths,
    retainedPaths: input.retainedPaths,
    clean: input.retainedPaths.length === 0
  };
}

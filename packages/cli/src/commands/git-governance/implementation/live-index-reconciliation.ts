/**
 * Reconcile the live shared index after a task-scoped commit moved HEAD through
 * a sealed candidate index.
 *
 * The candidate index intentionally isolates the commit from unrelated staged
 * work. That also means Git cannot advance the live index automatically. This
 * module restores the missing postcondition without treating the whole index as
 * owned by the committer: a path is advanced to the new HEAD only when its live
 * index entry still equals the pre-commit snapshot and its worktree bytes equal
 * the committed tree. Concurrent index or worktree changes are retained.
 *
 * The transaction boundary lives here rather than in the caller. Whether a
 * commit returned or threw, the only question that decides reconciliation is
 * whether HEAD actually advanced, and answering it in one place is what keeps
 * `try`/`finally`, HEAD comparison, and Git invocation details out of every
 * commit surface. The boundary also refuses to convert a reconciliation problem
 * into a commit failure: a commit that landed is reported as landed, and any
 * reconciliation trouble is reported as a diagnosable field beside it.
 *
 * Path lists reach this module already sized by a commit bundle, which for a
 * release-style commit means hundreds of entries. Every Git invocation here is
 * therefore batched against a platform argv budget; see `pathspec-argv-batching`
 * for why the stdin pathspec route is not an option in this repository.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGitCommand, runGitCommandWithEnv } from './git-process-port.ts';
import { forEachPathspecBatch, planPathspecBatches } from './pathspec-argv-batching.ts';

export const LIVE_INDEX_RECONCILIATION_SCHEMA_ID = 'atm.liveIndexReconciliation.v1';

const QUIET_STDIO = ['ignore', 'pipe', 'pipe'] as const;
const INDEX_ENTRY = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/i;
const LS_FILES_ARGS = ['ls-files', '-s', '--'] as const;
const ADD_ARGS = ['add', '-A', '-f', '--'] as const;

type Entry = { readonly mode: string; readonly blobId: string } | null;

export type LiveIndexRetentionReason = 'concurrent-index-change' | 'worktree-diverged';

export interface LiveIndexSnapshot {
  readonly paths: readonly string[];
  readonly entries: Readonly<Record<string, Entry>>;
}

export interface LiveIndexRetainedPath {
  readonly path: string;
  readonly reason: LiveIndexRetentionReason;
}

/**
 * The small stable result a governed commit reports.
 *
 * It answers three operator questions and nothing else: did this transaction
 * have anything to reconcile, which paths were left alone and why, and can the
 * index be treated as clean. The underlying snapshot, temporary indexes, and
 * batching plans stay inside this module.
 */
export interface LiveIndexReconciliation {
  readonly schemaId: typeof LIVE_INDEX_RECONCILIATION_SCHEMA_ID;
  /** False when the commit never landed, which is the only no-op case. */
  readonly headAdvanced: boolean;
  readonly reconciledPaths: readonly string[];
  readonly retainedPaths: readonly LiveIndexRetainedPath[];
  /** True only when nothing was retained and nothing failed. */
  readonly clean: boolean;
  readonly failure: { readonly code: string; readonly message: string } | null;
}

interface BudgetOptions {
  readonly budgetBytes?: number;
}

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function sameEntry(left: Entry, right: Entry): boolean {
  return left === null || right === null
    ? left === right
    : left.mode === right.mode && left.blobId === right.blobId;
}

function collectIndexEntries(entries: Record<string, Entry>, output: string): void {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(INDEX_ENTRY);
    if (!match) continue;
    const filePath = normalizePath(match[3]);
    if (Object.hasOwn(entries, filePath)) {
      entries[filePath] = { mode: match[1], blobId: match[2] };
    }
  }
}

function readIndexEntries(
  cwd: string,
  paths: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
  budgetBytes: number | undefined
): Readonly<Record<string, Entry>> {
  const entries: Record<string, Entry> = Object.fromEntries(paths.map((filePath) => [filePath, null]));
  forEachPathspecBatch({ paths, fixedArgs: LS_FILES_ARGS, budgetBytes }, (batch) => {
    const args = [...LS_FILES_ARGS, ...batch];
    const output = env
      ? runGitCommandWithEnv(cwd, args, env, QUIET_STDIO)
      : runGitCommand(cwd, args, QUIET_STDIO);
    collectIndexEntries(entries, output);
  });
  return entries;
}

function readHeadEntries(
  cwd: string,
  paths: readonly string[],
  budgetBytes: number | undefined
): Readonly<Record<string, Entry>> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-head-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    runGitCommandWithEnv(cwd, ['read-tree', 'HEAD'], env, QUIET_STDIO);
    return readIndexEntries(cwd, paths, env, budgetBytes);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readWorktreeEntries(
  cwd: string,
  paths: readonly string[],
  headEntries: Readonly<Record<string, Entry>>,
  budgetBytes: number | undefined
): Readonly<Record<string, Entry>> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-worktree-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    runGitCommandWithEnv(cwd, ['read-tree', 'HEAD'], env, QUIET_STDIO);
    const stageablePaths = paths.filter(
      (filePath) => headEntries[filePath] !== null || existsSync(path.join(cwd, filePath))
    );
    forEachPathspecBatch({ paths: stageablePaths, fixedArgs: ADD_ARGS, budgetBytes }, (batch) => {
      runGitCommandWithEnv(cwd, [...ADD_ARGS, ...batch], env, QUIET_STDIO);
    });
    return readIndexEntries(cwd, paths, env, budgetBytes);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** The commit HEAD points at, or null in a repository with no commits yet. */
export function readHeadCommit(cwd: string): string | null {
  try {
    return runGitCommand(cwd, ['rev-parse', 'HEAD'], QUIET_STDIO).trim() || null;
  } catch {
    return null;
  }
}

export function captureLiveIndexSnapshot(
  cwd: string,
  pathsInput: readonly string[],
  options: BudgetOptions = {}
): LiveIndexSnapshot {
  const { paths } = planPathspecBatches({
    paths: pathsInput,
    fixedArgs: LS_FILES_ARGS,
    budgetBytes: options.budgetBytes
  });
  return { paths, entries: readIndexEntries(cwd, paths, undefined, options.budgetBytes) };
}

export function reconcileCommittedPathsInLiveIndex(input: {
  readonly cwd: string;
  readonly snapshot: LiveIndexSnapshot;
  readonly budgetBytes?: number;
}): { readonly reconciledPaths: readonly string[]; readonly retainedPaths: readonly LiveIndexRetainedPath[] } {
  const { cwd, snapshot, budgetBytes } = input;
  const current = readIndexEntries(cwd, snapshot.paths, undefined, budgetBytes);
  const head = readHeadEntries(cwd, snapshot.paths, budgetBytes);
  const worktree = readWorktreeEntries(cwd, snapshot.paths, head, budgetBytes);
  const reconciledPaths: string[] = [];
  const retainedPaths: LiveIndexRetainedPath[] = [];

  for (const filePath of snapshot.paths) {
    if (!sameEntry(current[filePath], snapshot.entries[filePath])) {
      retainedPaths.push({ path: filePath, reason: 'concurrent-index-change' });
      continue;
    }
    if (!sameEntry(worktree[filePath], head[filePath])) {
      retainedPaths.push({ path: filePath, reason: 'worktree-diverged' });
      continue;
    }
    const target = head[filePath];
    if (target === null) {
      runGitCommand(cwd, ['update-index', '--force-remove', '--', filePath], QUIET_STDIO);
    } else {
      runGitCommand(cwd, ['update-index', '--add', '--cacheinfo', `${target.mode},${target.blobId},${filePath}`], QUIET_STDIO);
    }
    reconciledPaths.push(filePath);
  }

  return { reconciledPaths, retainedPaths };
}

function report(input: {
  readonly headAdvanced: boolean;
  readonly reconciledPaths?: readonly string[];
  readonly retainedPaths?: readonly LiveIndexRetainedPath[];
  readonly failure?: { readonly code: string; readonly message: string } | null;
}): LiveIndexReconciliation {
  const reconciledPaths = input.reconciledPaths ?? [];
  const retainedPaths = input.retainedPaths ?? [];
  const failure = input.failure ?? null;
  return {
    schemaId: LIVE_INDEX_RECONCILIATION_SCHEMA_ID,
    headAdvanced: input.headAdvanced,
    reconciledPaths,
    retainedPaths,
    clean: retainedPaths.length === 0 && failure === null,
    failure
  };
}

/**
 * The transaction boundary: reconcile if and only if the commit attempt moved
 * HEAD, and never throw.
 *
 * Both outcomes of a commit attempt reach this function, so it cannot signal by
 * throwing without changing what a commit failure means. A commit that landed
 * and then failed downstream must still surface the downstream error, and a
 * reconciliation that fails on top of that must not replace it. Trouble is
 * therefore returned as `failure`, which also drives `clean` to false so no
 * caller can read a half-reconciled index as a clean one.
 */
export function reconcileLiveIndexAfterCommitAttempt(input: {
  readonly cwd: string;
  readonly snapshot: LiveIndexSnapshot;
  readonly headBefore: string | null;
  readonly budgetBytes?: number;
}): LiveIndexReconciliation {
  let headAdvanced = false;
  try {
    headAdvanced = readHeadCommit(input.cwd) !== input.headBefore;
    if (!headAdvanced) return report({ headAdvanced: false });
    const outcome = reconcileCommittedPathsInLiveIndex({
      cwd: input.cwd,
      snapshot: input.snapshot,
      budgetBytes: input.budgetBytes
    });
    return report({ headAdvanced: true, ...outcome });
  } catch (error) {
    const failure = error as { code?: unknown; message?: unknown };
    return report({
      headAdvanced,
      failure: {
        code: typeof failure?.code === 'string' ? failure.code : 'ATM_LIVE_INDEX_RECONCILIATION_FAILED',
        message: typeof failure?.message === 'string' ? failure.message : String(error)
      }
    });
  }
}

/**
 * Persist a reconciliation that did not finish cleanly.
 *
 * A clean reconciliation needs no record: the index matches HEAD and there is
 * nothing for an operator to act on. A retained path or a reconciliation
 * failure is the opposite — the commit itself succeeded, so nothing else in the
 * run will look wrong, and without a durable record the leftover staged entry
 * reads as unexplained residue that invites exactly the manual index edit this
 * governance forbids.
 */
export function recordLiveIndexReconciliation(
  cwd: string,
  taskId: string | null | undefined,
  reconciliation: LiveIndexReconciliation
): string | null {
  if (!taskId || reconciliation.clean !== false) return null;
  const relativePath = `.atm/history/evidence/${taskId}.live-index-reconciliation.json`;
  const absolutePath = path.join(cwd, relativePath);
  // This is a state receipt, not an append-only attempt log.  A repeated
  // governed commit can reconcile a fresh task-event while retaining exactly
  // the same foreign index entry. Rewriting this file in that case creates a
  // new task-scoped dirty file after every commit and makes close impossible.
  // The task-event ledger already preserves attempt history; keep this receipt
  // byte-stable until the unresolved reconciliation state actually changes.
  if (existsSync(absolutePath)) {
    try {
      const existing = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
      // The receipt path already binds task identity.  Retention is the sole
      // unresolved state that requires a durable recovery receipt; successful
      // reconciled paths are attempt telemetry and live in task-events.
      if (
        existing.schemaId === LIVE_INDEX_RECONCILIATION_SCHEMA_ID
        && existing.clean === false
        && JSON.stringify(existing.retainedPaths) === JSON.stringify(reconciliation.retainedPaths)
        && JSON.stringify(existing.failure ?? null) === JSON.stringify(reconciliation.failure ?? null)
      ) return relativePath;
    } catch {
      // A malformed prior receipt is replaced with the current attributable
      // state; leaving it in place would make recovery unverifiable.
    }
  }
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    `${JSON.stringify({ ...reconciliation, taskId, createdAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  return relativePath;
}

const RECONCILIATION_ON_ERROR = Symbol.for('atm.liveIndexReconciliation');

/**
 * Carry a reconciliation report on an error without altering the error itself.
 *
 * A commit failure has to propagate exactly as thrown — its type, message, and
 * code are what callers gate on — while the operator still needs to know what
 * happened to the index underneath it. A symbol-keyed, non-enumerable property
 * adds the second fact without disturbing the first.
 */
export function attachLiveIndexReconciliation<E>(error: E, reconciliation: LiveIndexReconciliation): E {
  if (error !== null && typeof error === 'object') {
    Object.defineProperty(error, RECONCILIATION_ON_ERROR, {
      value: reconciliation,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return error;
}

export function readLiveIndexReconciliationFromError(error: unknown): LiveIndexReconciliation | null {
  if (error === null || typeof error !== 'object') return null;
  const carried = (error as Record<symbol, unknown>)[RECONCILIATION_ON_ERROR];
  return (carried as LiveIndexReconciliation | undefined) ?? null;
}

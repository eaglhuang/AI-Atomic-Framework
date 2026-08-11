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
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGitCommand, runGitCommandWithEnv } from './git-process-port.ts';

const QUIET_STDIO = ['ignore', 'pipe', 'pipe'] as const;
const INDEX_ENTRY = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/i;

type Entry = { readonly mode: string; readonly blobId: string } | null;

export interface LiveIndexSnapshot {
  readonly paths: readonly string[];
  readonly entries: Readonly<Record<string, Entry>>;
}

export interface LiveIndexReconciliation {
  readonly reconciledPaths: readonly string[];
  readonly retainedPaths: readonly {
    readonly path: string;
    readonly reason: 'concurrent-index-change' | 'worktree-diverged';
  }[];
}

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function sameEntry(left: Entry, right: Entry): boolean {
  return left === null || right === null
    ? left === right
    : left.mode === right.mode && left.blobId === right.blobId;
}

function readIndexEntries(cwd: string, paths: readonly string[], env?: NodeJS.ProcessEnv): Readonly<Record<string, Entry>> {
  const entries: Record<string, Entry> = Object.fromEntries(paths.map((filePath) => [filePath, null]));
  if (paths.length === 0) return entries;
  const output = env
    ? runGitCommandWithEnv(cwd, ['ls-files', '-s', '--', ...paths], env, QUIET_STDIO)
    : runGitCommand(cwd, ['ls-files', '-s', '--', ...paths], QUIET_STDIO);
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(INDEX_ENTRY);
    if (!match) continue;
    const filePath = normalizePath(match[3]);
    if (Object.hasOwn(entries, filePath)) {
      entries[filePath] = { mode: match[1], blobId: match[2] };
    }
  }
  return entries;
}

function readHeadEntries(cwd: string, paths: readonly string[]): Readonly<Record<string, Entry>> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-head-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    runGitCommandWithEnv(cwd, ['read-tree', 'HEAD'], env, QUIET_STDIO);
    return readIndexEntries(cwd, paths, env);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readWorktreeEntries(
  cwd: string,
  paths: readonly string[],
  headEntries: Readonly<Record<string, Entry>>
): Readonly<Record<string, Entry>> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-worktree-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    runGitCommandWithEnv(cwd, ['read-tree', 'HEAD'], env, QUIET_STDIO);
    const stageablePaths = paths.filter(
      (filePath) => headEntries[filePath] !== null || existsSync(path.join(cwd, filePath))
    );
    if (stageablePaths.length > 0) {
      runGitCommandWithEnv(cwd, ['add', '-A', '-f', '--', ...stageablePaths], env, QUIET_STDIO);
    }
    return readIndexEntries(cwd, paths, env);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function captureLiveIndexSnapshot(cwd: string, pathsInput: readonly string[]): LiveIndexSnapshot {
  const paths = [...new Set(pathsInput.map(normalizePath).filter(Boolean))].sort();
  return { paths, entries: readIndexEntries(cwd, paths) };
}

export function reconcileCommittedPathsInLiveIndex(input: {
  readonly cwd: string;
  readonly snapshot: LiveIndexSnapshot;
}): LiveIndexReconciliation {
  const { cwd, snapshot } = input;
  const current = readIndexEntries(cwd, snapshot.paths);
  const head = readHeadEntries(cwd, snapshot.paths);
  const worktree = readWorktreeEntries(cwd, snapshot.paths, head);
  const reconciledPaths: string[] = [];
  const retainedPaths: { path: string; reason: 'concurrent-index-change' | 'worktree-diverged' }[] = [];

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

import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ATM-GOV-0369 amendment 1 — restore the index after a refused commit.
 *
 * The previous boundary snapshotted staged *names* under `--diff-filter=ACMRT`.
 * `D` is absent from that filter, so a staged deletion appeared in neither the
 * before nor the after list and survived every rollback, while the operation
 * reported an unchanged HEAD as evidence that nothing was left behind. HEAD is
 * only one of the three surfaces a commit attempt can mutate.
 *
 * This module snapshots the index as git itself describes it — mode, blob, and
 * stage per path — so a restoration can be exact rather than approximate, and
 * can prove itself afterwards instead of assuming success.
 */

export interface IndexEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly stage: string;
}

export interface IndexRestorationSnapshot {
  /** Path -> index entry, for every tracked path at capture time. */
  readonly entries: ReadonlyMap<string, IndexEntry>;
}

export interface IndexRestorationOutcome {
  /** Paths the operation changed in the index and that were put back. */
  readonly restoredPaths: readonly string[];
  /** Paths still differing from the snapshot after restoration. */
  readonly residualPaths: readonly string[];
  /** True only when a re-read of the index matches the snapshot exactly. */
  readonly verified: boolean;
}

function git(cwd: string, args: readonly string[], env = process.env): string {
  const executable = process.env.ATM_GIT_EXECUTABLE || 'git';
  return execFileSync(executable, ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], env
  });
}

function readIndexEntries(cwd: string): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>();
  const output = git(cwd, ['ls-files', '-s']);
  for (const line of output.split(/\r?\n/)) {
    // `<mode> <object> <stage>\t<path>`
    const separator = line.indexOf('\t');
    if (separator === -1) continue;
    const [mode, objectId, stage] = line.slice(0, separator).split(/\s+/);
    const filePath = line.slice(separator + 1).trim();
    if (!mode || !objectId || !filePath) continue;
    entries.set(filePath, { mode, objectId, stage: stage ?? '0' });
  }
  return entries;
}

export function captureIndexRestorationSnapshot(cwd: string): IndexRestorationSnapshot {
  return { entries: readIndexEntries(cwd) };
}

function sameEntry(left: IndexEntry | undefined, right: IndexEntry | undefined): boolean {
  if (!left || !right) return left === right;
  return left.mode === right.mode && left.objectId === right.objectId && left.stage === right.stage;
}

function diffPaths(
  snapshot: ReadonlyMap<string, IndexEntry>,
  current: ReadonlyMap<string, IndexEntry>
): readonly string[] {
  const paths = new Set<string>([...snapshot.keys(), ...current.keys()]);
  return [...paths].filter((filePath) => !sameEntry(snapshot.get(filePath), current.get(filePath))).sort();
}

/**
 * Put back exactly the paths that changed since the snapshot, and nothing else.
 *
 * Bounding restoration to the diff is what keeps another lane's staged work
 * intact: a path the operation never touched is never rewritten, so a foreign
 * staged blob is preserved as the bytes it already was rather than "restored"
 * from HEAD.
 */
export function restoreIndexToSnapshot(
  cwd: string,
  snapshot: IndexRestorationSnapshot,
  ownership?: { readonly paths: readonly string[]; readonly expected: IndexRestorationSnapshot }
): IndexRestorationOutcome {
  if (ownership) return restoreOwnedIndexEntries(cwd, snapshot, ownership);
  const changed = diffPaths(snapshot.entries, readIndexEntries(cwd));
  if (changed.length === 0) {
    return { restoredPaths: [], residualPaths: [], verified: true };
  }
  for (const filePath of changed) {
    const original = snapshot.entries.get(filePath);
    try {
      if (original) {
        // Rewrite the exact mode/blob/stage the index held, without consulting
        // HEAD or the worktree.
        git(cwd, ['update-index', '--add', '--cacheinfo', `${original.mode},${original.objectId},${filePath}`]);
      } else {
        // The path was untracked at capture time; remove the entry the
        // operation added rather than inventing content for it.
        git(cwd, ['update-index', '--force-remove', '--', filePath]);
      }
    } catch {
      // Fall through: the verification pass below reports what remains.
    }
  }
  const residualPaths = diffPaths(snapshot.entries, readIndexEntries(cwd));
  return {
    restoredPaths: changed.filter((filePath) => !residualPaths.includes(filePath)),
    residualPaths,
    verified: residualPaths.length === 0
  };
}

/** Restore only declared operation writes that still equal their observed
 * post-write entry. Hold Git's real index lock across comparison and atomic
 * publication, so a concurrent writer cannot slip between the two checks. */
function restoreOwnedIndexEntries(cwd: string, snapshot: IndexRestorationSnapshot, ownership: { readonly paths: readonly string[]; readonly expected: IndexRestorationSnapshot }): IndexRestorationOutcome {
  const paths = [...new Set(ownership.paths)].sort();
  if (paths.length === 0) return { restoredPaths: [], residualPaths: [], verified: true };
  const indexPath = path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'index']).trim());
  const lockPath = `${indexPath}.lock`;
  let descriptor: number | null = null;
  let ownsLock = false;
  let tempDir: string | null = null;
  const restoredPaths: string[] = [];
  const residualPaths: string[] = [];
  try {
    descriptor = openSync(lockPath, 'wx');
    ownsLock = true;
    const current = readIndexEntries(cwd);
    const changed = paths.filter((file) => !sameEntry(snapshot.entries.get(file), current.get(file)));
    if (!changed.length) return { restoredPaths, residualPaths, verified: true };
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-owned-index-rollback-'));
    const candidate = path.join(tempDir, 'index');
    const env = { ...process.env, GIT_INDEX_FILE: candidate };
    if (existsSync(indexPath)) copyFileSync(indexPath, candidate); else git(cwd, ['read-tree', '--empty'], env);
    for (const file of changed) {
      const expected = ownership.expected.entries.get(file);
      const original = snapshot.entries.get(file);
      if (!sameEntry(current.get(file), expected) || (original && original.stage !== '0') || (expected && expected.stage !== '0')) { residualPaths.push(file); continue; }
      if (original) git(cwd, ['update-index', '--add', '--cacheinfo', `${original.mode},${original.objectId},${file}`], env);
      else git(cwd, ['update-index', '--force-remove', '--', file], env);
      restoredPaths.push(file);
    }
    if (restoredPaths.length) {
      writeFileSync(descriptor, readFileSync(candidate));
      closeSync(descriptor); descriptor = null;
      renameSync(lockPath, indexPath);
      ownsLock = false;
    }
    return { restoredPaths, residualPaths, verified: residualPaths.length === 0 };
  } catch {
    return { restoredPaths: [], residualPaths: paths, verified: false };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (ownsLock) rmSync(lockPath, { force: true });
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

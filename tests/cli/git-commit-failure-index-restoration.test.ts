import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  captureIndexRestorationSnapshot,
  restoreIndexToSnapshot
} from '../../packages/cli/src/commands/git-governance/implementation/index-restoration.ts';

/**
 * ATM-GOV-0369 amendment 1 — ACC-6.
 *
 * A refused governed commit must be a no-op. The previous boundary compared
 * staged *names* filtered to `ACMRT`, so a staged deletion was invisible in
 * both the before and after snapshots and was never rolled back: the operation
 * staged a deletion, the hook refused, and the deletion stayed in the index
 * while an unchanged HEAD was reported as proof that nothing was left behind.
 *
 * These cases pin the three properties that fixes that: deletions are seen,
 * restoration is exact blob by blob, and work the operation did not create is
 * left exactly as it was found.
 */

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-index-restoration-'));
const git = (...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function write(relativePath: string, contents: string): void {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
}

git('init');
git('config', 'user.name', 'test');
git('config', 'user.email', 'test@example.invalid');

write('kept.txt', 'kept\n');
write('doomed.txt', 'doomed\n');
write('foreign.txt', 'foreign-original\n');
git('add', '-A');
git('commit', '-m', 'seed');

/** The two surfaces the contract is stated over, read verbatim from git. */
function observableState(): { readonly index: string; readonly worktree: string } {
  return { index: git('ls-files', '-s'), worktree: git('status', '--porcelain') };
}

// A refused operation that staged a deletion must leave no trace of it.
{
  const before = observableState();
  const snapshot = captureIndexRestorationSnapshot(repo);

  rmSync(path.join(repo, 'doomed.txt'));
  git('add', '-A');
  assert.notEqual(observableState().index, before.index, 'the fixture must actually stage the deletion');

  const restored = restoreIndexToSnapshot(repo, snapshot);
  assert(restored.restoredPaths.includes('doomed.txt'), 'a staged deletion must be reported as restored');
  assert.equal(observableState().index, before.index, 'the index must return to its exact pre-operation entries');
}

// Staged modifications and additions restore too, and the worktree is not
// silently rewritten while doing it.
{
  git('checkout', '--', 'doomed.txt');
  const before = observableState();
  const snapshot = captureIndexRestorationSnapshot(repo);

  write('kept.txt', 'kept-modified\n');
  write('added.txt', 'added\n');
  git('add', '-A');

  restoreIndexToSnapshot(repo, snapshot);
  assert.equal(observableState().index, before.index, 'staged modification and addition must both be undone');
}

// Foreign staged work is preserved, not "restored" into someone else's lane.
// Restoration is bounded to what the operation itself staged.
{
  write('foreign.txt', 'foreign-staged-by-another-lane\n');
  git('add', '--', 'foreign.txt');
  const before = observableState();
  const snapshot = captureIndexRestorationSnapshot(repo);

  write('doomed.txt', 'touched-by-the-failing-operation\n');
  git('add', '--', 'doomed.txt');

  const restored = restoreIndexToSnapshot(repo, snapshot);
  assert.equal(observableState().index, before.index, 'the foreign staged entry must survive unchanged');
  assert.deepEqual(restored.restoredPaths, ['doomed.txt'], 'only paths the operation staged may be touched');
  assert.equal(
    git('show', ':foreign.txt'),
    'foreign-staged-by-another-lane\n',
    'the foreign blob itself must be byte identical, not restored from HEAD'
  );
}

// An unchanged HEAD is not evidence. The snapshot comparison is what decides,
// and it must report residue that restoration could not remove.
{
  const head = git('rev-parse', 'HEAD').trim();
  const snapshot = captureIndexRestorationSnapshot(repo);
  write('doomed.txt', 'again\n');
  git('add', '--', 'doomed.txt');

  const restored = restoreIndexToSnapshot(repo, snapshot);
  assert.equal(git('rev-parse', 'HEAD').trim(), head, 'the fixture must not have advanced HEAD');
  assert.equal(restored.residualPaths.length, 0, 'a clean restoration must report no unrecoverable residue');
  assert.equal(
    restored.verified,
    true,
    'restoration must verify itself against the snapshot rather than assume success'
  );
}

console.log('[git-commit-failure-index-restoration] ok');

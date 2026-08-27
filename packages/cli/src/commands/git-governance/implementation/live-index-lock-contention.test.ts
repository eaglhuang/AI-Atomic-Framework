/**
 * Live-index reconciliation must treat `.git/index.lock` as a wait condition.
 *
 * A governed commit advances HEAD through a sealed candidate index, then
 * reconciles the committed paths back into the shared live index. That second
 * step is the only one that takes the live lock, and its write window is
 * milliseconds wide. Before this regression existed, the first collision with a
 * competing Git process ended the whole transaction: reconciliation threw, the
 * receipt named no retained path, and every committed path stayed behind HEAD.
 * The debt then compounded across later commits until closure was impossible.
 * Recorded as ATM-BUG-2026-08-12-001.
 *
 * caseId: test_int_live_index_lock_retry_drains_write_window
 * semanticKey: transient_index_lock_retries_instead_of_failing_reconciliation
 * contractEdge: live-index-reconciliation-transaction
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isIndexLockContention } from './live-index-lock-retry.ts';
import {
  captureLiveIndexSnapshot,
  reconcileLiveIndexAfterCommitAttempt,
  readHeadCommit
} from './live-index-reconciliation.ts';

function git(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', [...args], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

/**
 * Build the exact pre-state the defect occurs in: HEAD already carries the new
 * content, the worktree matches HEAD, and the live index still holds the old
 * blobs because the commit went through a candidate index.
 */
function repositoryWithUnreconciledCommit(paths: readonly string[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-lock-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  for (const filePath of paths) write(root, filePath, 'old\n');
  git(root, ['add', '--', ...paths]);
  git(root, ['commit', '--quiet', '-m', 'baseline']);

  const headBefore = readHeadCommit(root);
  const snapshot = captureLiveIndexSnapshot(root, paths);

  for (const filePath of paths) write(root, filePath, 'new\n');
  const candidateDir = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-lock-candidate-'));
  const env = { GIT_INDEX_FILE: path.join(candidateDir, 'index') };
  git(root, ['read-tree', 'HEAD'], env);
  git(root, ['add', '-A', '-f', '--', ...paths], env);
  const tree = git(root, ['write-tree'], env);
  const commitSha = git(root, ['commit-tree', tree, '-p', String(headBefore), '-m', 'candidate'], env);
  git(root, ['update-ref', 'HEAD', commitSha]);
  rmSync(candidateDir, { recursive: true, force: true });

  return { root, snapshot, headBefore };
}

function lockPath(root: string): string {
  return path.join(root, '.git', 'index.lock');
}

// Contention detection is narrow: a Git failure that is not the index lock keeps
// its terminal meaning, so the retry cannot widen what reconciliation tolerates.
{
  assert.equal(
    isIndexLockContention({ stderr: 'fatal: Unable to create index.lock: File exists.' }),
    true
  );
  assert.equal(isIndexLockContention({ stderr: 'fatal: not a git repository' }), false);
  assert.equal(isIndexLockContention(new Error('boom')), false);
  assert.equal(isIndexLockContention(null), false);
}

// Baseline: with no contention the transaction is clean and the retry policy
// never fires.
{
  const { root, snapshot, headBefore } = repositoryWithUnreconciledCommit(['a.txt']);
  const slept: number[] = [];
  const report = reconcileLiveIndexAfterCommitAttempt({
    cwd: root,
    snapshot,
    headBefore,
    lockRetry: { attempts: 3, delayMs: 0, sleep: (ms) => slept.push(ms) }
  });
  assert.equal(report.headAdvanced, true);
  assert.deepEqual(report.reconciledPaths, ['a.txt']);
  assert.equal(report.clean, true);
  assert.equal(slept.length, 0);
  rmSync(root, { recursive: true, force: true });
}

// A lock that clears inside the retry window is reconciled, not failed. The
// injected sleep stands in for the competing process finishing its write.
{
  const { root, snapshot, headBefore } = repositoryWithUnreconciledCommit(['a.txt']);
  writeFileSync(lockPath(root), '', 'utf8');
  let sleeps = 0;
  const report = reconcileLiveIndexAfterCommitAttempt({
    cwd: root,
    snapshot,
    headBefore,
    lockRetry: {
      attempts: 4,
      delayMs: 0,
      sleep: () => {
        sleeps += 1;
        // The competing process releases on its second yield.
        if (sleeps === 2) rmSync(lockPath(root), { force: true });
      }
    }
  });
  assert.ok(sleeps >= 2, 'the write window must actually be retried');
  assert.deepEqual(report.reconciledPaths, ['a.txt']);
  assert.deepEqual(report.retainedPaths, []);
  assert.equal(report.clean, true);
  assert.equal(report.failure, null);
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '');
  rmSync(root, { recursive: true, force: true });
}

// A lock that never clears leaves durable, drainable debt: every committed path
// is named, the established failure code is preserved, and the landed commit is
// still reported as landed. The pre-fix code threw on the first path and named
// none of them.
{
  const { root, snapshot, headBefore } = repositoryWithUnreconciledCommit(['a.txt', 'b.txt']);
  writeFileSync(lockPath(root), '', 'utf8');
  const report = reconcileLiveIndexAfterCommitAttempt({
    cwd: root,
    snapshot,
    headBefore,
    lockRetry: { attempts: 1, delayMs: 0, sleep: () => {} }
  });
  assert.equal(report.headAdvanced, true);
  assert.equal(report.clean, false);
  assert.equal(report.failure?.code, 'ATM_LIVE_INDEX_RECONCILIATION_FAILED');
  assert.deepEqual(
    [...report.retainedPaths].map((entry) => entry.path).sort(),
    ['a.txt', 'b.txt'],
    'the loop must not abort on the first locked path'
  );
  assert.ok(report.retainedPaths.every((entry) => entry.reason === 'index-locked'));
  assert.deepEqual(report.reconciledPaths, []);
  assert.ok(existsSync(lockPath(root)), 'a foreign lock is never removed by reconciliation');
  rmSync(lockPath(root), { force: true });

  // Draining is idempotent: once the lock clears, the same retained paths
  // reconcile on a repeat run without any manual index edit.
  const drained = reconcileLiveIndexAfterCommitAttempt({ cwd: root, snapshot, headBefore });
  assert.deepEqual([...drained.reconciledPaths].sort(), ['a.txt', 'b.txt']);
  assert.equal(drained.clean, true);
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '');
  rmSync(root, { recursive: true, force: true });
}

console.log('[live-index-lock-contention:test] ok');

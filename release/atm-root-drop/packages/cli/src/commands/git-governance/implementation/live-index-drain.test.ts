/**
 * Reconciliation debt must be drainable from its own durable receipt.
 *
 * A governed commit advances HEAD through a sealed candidate index and then
 * reconciles the committed paths into the shared live index. When that second
 * step is blocked, the receipt at
 * `.atm/history/evidence/<taskId>.live-index-reconciliation.json` is the durable
 * record of the non-green postcondition — but it records only which paths were
 * retained, never which commit left them behind. Nothing can therefore act on it
 * without an operator supplying the commit sha by hand.
 *
 * The debt also compounds. Once a second commit rewrites a path that is still
 * unreconciled, the proven pre-state stops being any single commit's parent
 * tree: the live index holds the blob from before the FIRST unreconciled commit,
 * while the worktree matches HEAD. `recoverLiveIndexAfterSuccessfulCommit`
 * correctly refuses both commits in that state, which leaves no route at all.
 *
 * Recorded as ATM-BUG-2026-08-12-001.
 *
 * caseId: test_int_live_index_receipt_drain_accumulated_debt
 * semanticKey: receipt_alone_drains_accumulated_reconciliation_debt
 * contractEdge: live-index-reconciliation-drain
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { drainLiveIndexReconciliationReceipt } from './live-index-drain.ts';
import {
  captureLiveIndexSnapshot,
  recordLiveIndexReconciliation,
  reconcileLiveIndexAfterCommitAttempt,
  recoverLiveIndexAfterSuccessfulCommit,
  readHeadCommit,
  type LiveIndexSnapshot
} from './live-index-reconciliation.ts';

const TASK_ID = 'TASK-FIXTURE-0001';

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

function repository(paths: readonly string[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-drain-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  for (const filePath of paths) write(root, filePath, 'old\n');
  git(root, ['add', '--', ...paths]);
  git(root, ['commit', '--quiet', '-m', 'baseline']);
  return root;
}

/**
 * Commit through a candidate index, exactly as a task-scoped governed commit
 * does, so the live index is left holding the pre-commit blobs. Records the
 * resulting receipt the way the commit surface records it.
 */
function committedWithoutReconciling(
  root: string,
  paths: readonly string[],
  content: string,
  snapshot: LiveIndexSnapshot
): string {
  const headBefore = readHeadCommit(root);
  for (const filePath of paths) write(root, filePath, content);
  const candidateDir = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-drain-candidate-'));
  const env = { GIT_INDEX_FILE: path.join(candidateDir, 'index') };
  git(root, ['read-tree', 'HEAD'], env);
  git(root, ['add', '-A', '-f', '--', ...paths], env);
  const tree = git(root, ['write-tree'], env);
  const commitSha = git(root, ['commit-tree', tree, '-p', String(headBefore), '-m', content], env);
  git(root, ['update-ref', 'HEAD', commitSha]);
  rmSync(candidateDir, { recursive: true, force: true });

  // The live index is deliberately not advanced: simulate the blocked window by
  // reconciling against a snapshot the index no longer matches.
  const blocked = reconcileLiveIndexAfterCommitAttempt({
    cwd: root,
    snapshot: { paths: snapshot.paths, entries: Object.fromEntries(snapshot.paths.map((p) => [p, null])) },
    headBefore
  });
  assert.equal(blocked.clean, false, 'the fixture must produce an unreconciled postcondition');
  recordLiveIndexReconciliation(root, TASK_ID, blocked);
  return commitSha;
}

function receipt(root: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(root, '.atm/history/evidence', `${TASK_ID}.live-index-reconciliation.json`), 'utf8')
  ) as Record<string, unknown>;
}

// The receipt must be self-addressing: a drain reads it and knows which commit
// left each retained path behind, without an operator supplying a sha.
{
  const root = repository(['p.txt']);
  const snapshot = captureLiveIndexSnapshot(root, ['p.txt']);
  const first = committedWithoutReconciling(root, ['p.txt'], 'v1\n', snapshot);

  const record = receipt(root);
  const retained = record.retainedPaths as readonly { path: string; firstUnreconciledCommit?: string }[];
  assert.ok(retained.length > 0, 'the receipt must record the retained path');
  assert.equal(
    retained[0]?.firstUnreconciledCommit,
    first,
    'each retained path must name the commit that first left it unreconciled'
  );
  rmSync(root, { recursive: true, force: true });
}

// Repeated blocked commits on the same path must keep the receipt byte-stable
// and must keep pointing at the FIRST unreconciled commit, because that parent
// tree is the only proven pre-state the live index still holds.
{
  const root = repository(['p.txt']);
  const snapshot = captureLiveIndexSnapshot(root, ['p.txt']);
  const first = committedWithoutReconciling(root, ['p.txt'], 'v1\n', snapshot);
  const before = readFileSync(
    path.join(root, '.atm/history/evidence', `${TASK_ID}.live-index-reconciliation.json`),
    'utf8'
  );
  committedWithoutReconciling(root, ['p.txt'], 'v2\n', snapshot);
  const after = readFileSync(
    path.join(root, '.atm/history/evidence', `${TASK_ID}.live-index-reconciliation.json`),
    'utf8'
  );
  assert.equal(after, before, 'an unchanged unresolved state must not rewrite the receipt');
  const retained = receipt(root).retainedPaths as readonly { firstUnreconciledCommit?: string }[];
  assert.equal(retained[0]?.firstUnreconciledCommit, first);
  rmSync(root, { recursive: true, force: true });
}

// The commit-scoped recovery cannot drain accumulated debt, and must not claim
// it did. A run that proved nothing is not clean.
{
  const root = repository(['p.txt']);
  const snapshot = captureLiveIndexSnapshot(root, ['p.txt']);
  const first = committedWithoutReconciling(root, ['p.txt'], 'v1\n', snapshot);
  committedWithoutReconciling(root, ['p.txt'], 'v2\n', snapshot);

  const recovery = recoverLiveIndexAfterSuccessfulCommit({ cwd: root, commitSha: first, dryRun: true });
  assert.deepEqual(recovery.reconciledPaths, [], 'the intermediate commit is not a drainable target');
  assert.ok(recovery.unprovenPaths.includes('p.txt'));
  assert.equal(recovery.clean, false, 'a recovery that proved nothing must not report clean');
  rmSync(root, { recursive: true, force: true });
}

// The drain: receipt in, index advanced to HEAD, one short write per path.
{
  const root = repository(['p.txt', 'q.txt']);
  const snapshot = captureLiveIndexSnapshot(root, ['p.txt', 'q.txt']);
  committedWithoutReconciling(root, ['p.txt', 'q.txt'], 'v1\n', snapshot);
  committedWithoutReconciling(root, ['p.txt', 'q.txt'], 'v2\n', snapshot);

  const dry = drainLiveIndexReconciliationReceipt({ cwd: root, taskId: TASK_ID, dryRun: true });
  assert.deepEqual([...dry.drainedPaths].sort(), ['p.txt', 'q.txt']);
  assert.equal(dry.mutated, false, 'a dry run must not touch the index');
  assert.notEqual(git(root, ['diff', '--cached', '--name-only']), '');

  const applied = drainLiveIndexReconciliationReceipt({ cwd: root, taskId: TASK_ID, dryRun: false });
  assert.deepEqual([...applied.drainedPaths].sort(), ['p.txt', 'q.txt']);
  assert.equal(applied.clean, true);
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '', 'the live index must equal HEAD after draining');

  // Idempotent: a repeat run recognises its own completed work and drains
  // nothing, rather than reading the repaired index as a concurrent change.
  const repeat = drainLiveIndexReconciliationReceipt({ cwd: root, taskId: TASK_ID, dryRun: false });
  assert.deepEqual(repeat.drainedPaths, []);
  assert.deepEqual([...repeat.alreadyAlignedPaths].sort(), ['p.txt', 'q.txt']);
  assert.equal(repeat.mutated, false);
  assert.equal(repeat.clean, true);
  rmSync(root, { recursive: true, force: true });
}

// A path whose worktree diverged from HEAD is never advanced, and a foreign
// index entry is never overwritten: the drain refuses rather than guesses.
{
  const root = repository(['p.txt', 'foreign.txt']);
  const snapshot = captureLiveIndexSnapshot(root, ['p.txt']);
  committedWithoutReconciling(root, ['p.txt'], 'v1\n', snapshot);
  write(root, 'p.txt', 'locally edited\n');
  write(root, 'foreign.txt', 'foreign staged\n');
  git(root, ['add', '--', 'foreign.txt']);
  const foreignEntry = git(root, ['ls-files', '-s', '--', 'foreign.txt']);

  const result = drainLiveIndexReconciliationReceipt({ cwd: root, taskId: TASK_ID, dryRun: false });
  assert.deepEqual(result.drainedPaths, [], 'a diverged worktree is not drainable');
  assert.equal(result.clean, false);
  assert.equal(git(root, ['ls-files', '-s', '--', 'foreign.txt']), foreignEntry, 'foreign entries are untouched');
  rmSync(root, { recursive: true, force: true });
}

console.log('[live-index-drain:test] ok');

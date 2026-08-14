// TASK-ERR-0014 extends this focused regression.
//
// caseId: test_reconcile_after_commit_error_0014
// semanticKey: commit_error_after_head_advance_still_reconciles_live_index
// coversAcceptance: ACC-1, ACC-2
// coversImpactEdges: commit-error-after-head-advance-to-reconciled-live-index
// contractEdge: live-index-reconciliation-transaction
//
// caseId: test_retained_path_observability_0014
// semanticKey: retained_paths_and_reasons_reach_the_production_caller
// coversAcceptance: ACC-3
// coversImpactEdges: retained-path-to-operator-visible-result
// contractEdge: live-index-reconciliation-transaction

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sealCommitBundle } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { runWithSealedTaskScopedCommitIndex } from './sealed-commit-attribution.ts';
import { withTaskScopedCommitIndex } from './git-index-transaction.ts';
import {
  LIVE_INDEX_RECONCILIATION_SCHEMA_ID,
  captureLiveIndexSnapshot,
  readLiveIndexReconciliationFromError,
  reconcileLiveIndexAfterCommitAttempt
  ,recordLiveIndexReconciliation
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

function repository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-reconcile-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'owned.txt', 'old\n');
  write(root, 'foreign.txt', 'old foreign\n');
  git(root, ['add', '--', 'owned.txt', 'foreign.txt']);
  git(root, ['commit', '--quiet', '-m', 'baseline']);
  return root;
}

function sealedOwnedBundle(root: string, content: string) {
  write(root, 'owned.txt', content);
  const blobId = git(root, ['hash-object', '-w', '--', 'owned.txt']);
  return sealCommitBundle({ entries: [{ path: 'owned.txt', mode: '100644', blobId, provenance: 'task-scope' }] });
}

function commit(
  root: string,
  bundle: ReturnType<typeof sealedOwnedBundle>,
  afterCommit?: () => void,
  beforeCommit?: () => void
) {
  return runWithSealedTaskScopedCommitIndex({
    cwd: root,
    paths: ['owned.txt'],
    provenance: 'task-scope',
    surface: 'focused regression',
    sealSource: { kind: 'sealed-bundle', bundle },
    run: (env) => {
      beforeCommit?.();
      git(root, ['commit', '--quiet', '-m', 'task commit'], env);
      afterCommit?.();
    }
  });
}

{
  const root = repository();
  try {
    write(root, 'foreign.txt', 'staged foreign\n');
    git(root, ['add', '--', 'foreign.txt']);
    const foreignBlob = git(root, ['rev-parse', ':foreign.txt']);
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);

    const outcome = commit(root, sealedOwnedBundle(root, 'committed\n'));

    assert.deepEqual(outcome.liveIndexReconciliation.reconciledPaths, ['owned.txt']);
    assert.deepEqual(outcome.liveIndexReconciliation.retainedPaths, []);
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--', 'owned.txt']), '');
    assert.equal(git(root, ['rev-parse', ':foreign.txt']), foreignBlob, 'foreign staged bytes must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// A retained foreign entry is state, not a new delivery on every later task
// event. Re-recording the same unresolved state must leave the receipt bytes
// unchanged so a task can commit it once and then close.
{
  const root = repository();
  try {
    const reconciliation = {
      schemaId: LIVE_INDEX_RECONCILIATION_SCHEMA_ID as typeof LIVE_INDEX_RECONCILIATION_SCHEMA_ID,
      headAdvanced: true,
      reconciledPaths: ['.atm/history/task-events/TASK-OWN/renew.json'],
      retainedPaths: [{ path: '.atm/history/evidence/git-head.jsonl', reason: 'worktree-diverged' as const }],
      clean: false,
      failure: null
    };
    const receipt = recordLiveIndexReconciliation(root, 'TASK-OWN', reconciliation);
    assert.ok(receipt);
    const before = readFileSync(path.join(root, receipt), 'utf8');
    recordLiveIndexReconciliation(root, 'TASK-OWN', {
      ...reconciliation,
      reconciledPaths: ['.atm/history/task-events/TASK-OWN/renew-again.json']
    });
    assert.equal(readFileSync(path.join(root, receipt), 'utf8'), before, 'unchanged retained state must not create post-commit receipt drift');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = repository();
  try {
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const concurrentBlob = git(root, ['hash-object', '-w', '--stdin'], undefined).trim();
    const outcome = commit(root, sealedOwnedBundle(root, 'committed\n'), () => {
      git(root, ['update-index', '--add', '--cacheinfo', `100644,${concurrentBlob},owned.txt`]);
    });

    assert.deepEqual(outcome.liveIndexReconciliation.reconciledPaths, []);
    assert.deepEqual(outcome.liveIndexReconciliation.retainedPaths, [
      { path: 'owned.txt', reason: 'concurrent-index-change' }
    ]);
    assert.equal(git(root, ['rev-parse', ':owned.txt']), concurrentBlob, 'concurrent index bytes must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = repository();
  try {
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const outcome = commit(root, sealedOwnedBundle(root, 'committed\n'), () => {
      write(root, 'owned.txt', 'new worktree bytes\n');
    });

    assert.deepEqual(outcome.liveIndexReconciliation.reconciledPaths, []);
    assert.deepEqual(outcome.liveIndexReconciliation.retainedPaths, [
      { path: 'owned.txt', reason: 'worktree-diverged' }
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-1: a commit error raised after HEAD advanced still reconciles.
//
// This is the case the straight-line implementation lost: the commit object
// exists, so the live index is stale in exactly the way reconciliation repairs,
// and skipping it leaves the committed path staged against nobody.

{
  const root = repository();
  try {
    write(root, 'foreign.txt', 'staged foreign\n');
    git(root, ['add', '--', 'foreign.txt']);
    const foreignBlob = git(root, ['rev-parse', ':foreign.txt']);
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const headBefore = git(root, ['rev-parse', 'HEAD']);

    const postCommitFailure = new Error('receipt write failed after the commit landed');
    assert.throws(
      () => commit(root, sealedOwnedBundle(root, 'committed\n'), () => {
        throw postCommitFailure;
      }),
      (error: unknown) => {
        assert.equal(error, postCommitFailure, 'the original commit error must reach the caller unswallowed');
        const report = readLiveIndexReconciliationFromError(error);
        assert.ok(report, 'a commit error must carry the reconciliation that ran despite it');
        assert.equal(report.schemaId, LIVE_INDEX_RECONCILIATION_SCHEMA_ID);
        assert.equal(report.headAdvanced, true);
        assert.deepEqual(report.reconciledPaths, ['owned.txt']);
        assert.equal(report.failure, null);
        return true;
      }
    );

    assert.notEqual(git(root, ['rev-parse', 'HEAD']), headBefore, 'the fixture must actually advance HEAD');
    assert.equal(
      git(root, ['diff', '--cached', '--name-only', '--', 'owned.txt']),
      '',
      'no pre-commit blob may remain staged for a path the commit already captured'
    );
    assert.equal(git(root, ['rev-parse', ':foreign.txt']), foreignBlob, 'foreign staged bytes must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-2: a failure before HEAD moves must not reconcile anything.

{
  const root = repository();
  try {
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const headBefore = git(root, ['rev-parse', 'HEAD']);
    const indexBefore = git(root, ['ls-files', '-s']);

    const preCommitFailure = new Error('hook rejected the commit');
    assert.throws(
      () => commit(root, sealedOwnedBundle(root, 'committed\n'), undefined, () => {
        throw preCommitFailure;
      }),
      (error: unknown) => {
        assert.equal(error, preCommitFailure);
        const report = readLiveIndexReconciliationFromError(error);
        assert.ok(report, 'even a no-op boundary must report itself');
        assert.equal(report.headAdvanced, false, 'HEAD did not move, so nothing may be reconciled');
        assert.deepEqual(report.reconciledPaths, []);
        assert.deepEqual(report.retainedPaths, []);
        return true;
      }
    );

    assert.equal(git(root, ['rev-parse', 'HEAD']), headBefore, 'a rejected commit must not advance HEAD');
    assert.equal(git(root, ['ls-files', '-s']), indexBefore, 'the live index must be left byte-identical');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-3: retained paths and their reasons reach the production caller.
//
// withTaskScopedCommitIndex is the seam every governed commit goes through. If
// it hands back only the commit result, a retention is computed and thrown
// away, and the operator reads a green commit as a clean index.

{
  const root = repository();
  try {
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const concurrentBlob = git(root, ['hash-object', '-w', '--stdin']).trim();
    const bundle = sealedOwnedBundle(root, 'committed\n');

    const outcome = withTaskScopedCommitIndex(
      root,
      ['owned.txt'],
      'claude-008',
      'TASK-ERR-0014',
      (env: NodeJS.ProcessEnv) => {
        git(root, ['commit', '--quiet', '-m', 'task commit'], env);
        git(root, ['update-index', '--add', '--cacheinfo', `100644,${concurrentBlob},owned.txt`]);
        return 'commit-result';
      },
      { kind: 'sealed-bundle', bundle }
    );

    assert.equal(outcome.result, 'commit-result', 'the commit result must still be returned');
    const report = outcome.liveIndexReconciliation;
    assert.equal(report.schemaId, LIVE_INDEX_RECONCILIATION_SCHEMA_ID);
    assert.deepEqual(report.retainedPaths, [{ path: 'owned.txt', reason: 'concurrent-index-change' }]);
    assert.equal(report.clean, false, 'a retained path must never be reported as a clean index');
    assert.equal(git(root, ['rev-parse', ':owned.txt']), concurrentBlob, 'concurrent index bytes must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-4: a path list too large for one argv is still reconciled in full.
//
// The budget is passed explicitly so the batching boundary is exercised with a
// small fixture instead of a release-sized one; equivalence is the assertion
// that matters, and it is budget-independent.

{
  const root = repository();
  try {
    const paths = Array.from({ length: 60 }, (_, index) => `generated/module-${String(index).padStart(3, '0')}/index.ts`);
    for (const filePath of paths) write(root, filePath, `export const value = ${JSON.stringify(filePath)};\n`);
    git(root, ['add', '--', ...paths]);
    git(root, ['commit', '--quiet', '-m', 'bulk baseline']);

    const budgetBytes = 512;
    const snapshot = captureLiveIndexSnapshot(root, paths, { budgetBytes });
    assert.deepEqual([...snapshot.paths], [...paths].sort(), 'a batched snapshot must cover every path');
    for (const filePath of paths) {
      assert.ok(snapshot.entries[filePath], `batching must not drop ${filePath} from the snapshot`);
    }

    const headBefore = git(root, ['rev-parse', 'HEAD']);
    const report = reconcileLiveIndexAfterCommitAttempt({ cwd: root, snapshot, headBefore, budgetBytes });
    assert.equal(report.headAdvanced, false);

    const single = captureLiveIndexSnapshot(root, paths);
    assert.deepEqual(snapshot.entries, single.entries, 'batched and single-invocation snapshots must be equivalent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('[live-index-reconciliation] ok');

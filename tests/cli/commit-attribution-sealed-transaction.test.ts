/**
 * TASK-GIT-0029 — sealed commit attribution transaction.
 *
 * Case ids:
 *   test_task_git_commit_sealed_content_attribution
 *   test_broker_apply_admission_before_ref_update
 *
 * The incident this suite encodes is generic: two writers share one worktree
 * and one index. Nothing here depends on which tasks, actors or dates were
 * involved when it was first observed — the fixtures use synthetic ids so the
 * same shape replays for any future pair of writers.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE,
  ATM_COMMIT_ATTRIBUTION_MISMATCH,
  assertSealedBundleNotEmpty,
  compareCommitTreeToSealedBundle,
  sealCommitBundle
} from '../../packages/core/src/commit-attribution/sealed-commit-bundle.ts';
import {
  assembleSealedCommitIndex,
  assertCommitAttribution,
  readCandidateTreeEntries,
  readCommittedTreeEntries,
  runWithSealedTaskScopedCommitIndex,
  sealCommitBundleFromLiveIndex
} from '../../packages/cli/src/commands/git-governance/implementation/sealed-commit-attribution.ts';
import {
  ATM_BROKER_BATCH_COMMIT_HEAD_MOVED,
  applySealedSharedDeliveryCommit,
  runSharedDeliveryCommitTransaction
} from '../../packages/cli/src/commands/broker/shared-delivery-commit-transaction.ts';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

const now = '2026-07-31T00:00:00.000Z';
const roots: string[] = [];

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function head(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']);
}

function write(root: string, relative: string, content: string) {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function createRepository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-attribution-'));
  roots.push(root);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture-writer']);
  git(root, ['config', 'user.email', 'fixture-writer@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'baseline.txt', 'baseline\n');
  git(root, ['add', '--', 'baseline.txt']);
  git(root, ['commit', '--quiet', '-m', 'baseline']);
  return root;
}

function expectThrows(run: () => unknown, code: string): { code?: string; details?: Record<string, unknown> } {
  try {
    run();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}`);
    return error as { code?: string; details?: Record<string, unknown> };
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

// --- policy: exact match is the only pass verdict -------------------------

const sealed = sealCommitBundle({
  entries: [
    { path: 'a.txt', mode: '100644', blobId: 'aaa', provenance: 'task-scope' },
    { path: 'b.txt', mode: '100644', blobId: 'bbb', provenance: 'task-scope' }
  ]
});

assert.equal(
  compareCommitTreeToSealedBundle({
    sealed,
    actual: [
      { path: 'a.txt', mode: '100644', blobId: 'aaa' },
      { path: 'b.txt', mode: '100644', blobId: 'bbb' }
    ]
  }).ok,
  true,
  'identical content must pass'
);

const missing = compareCommitTreeToSealedBundle({ sealed, actual: [{ path: 'a.txt', mode: '100644', blobId: 'aaa' }] });
assert.equal(missing.ok, false);
assert.deepEqual(missing.findings.map((finding) => finding.kind), ['missing-path']);

const extra = compareCommitTreeToSealedBundle({
  sealed,
  actual: [
    { path: 'a.txt', mode: '100644', blobId: 'aaa' },
    { path: 'b.txt', mode: '100644', blobId: 'bbb' },
    { path: 'foreign.txt', mode: '100644', blobId: 'fff' }
  ]
});
assert.equal(extra.ok, false);
assert.deepEqual(extra.findings.map((finding) => `${finding.kind}:${finding.path}`), ['unexpected-path:foreign.txt']);

const swapped = compareCommitTreeToSealedBundle({
  sealed,
  actual: [
    { path: 'a.txt', mode: '100644', blobId: 'zzz' },
    { path: 'b.txt', mode: '100644', blobId: 'bbb' }
  ]
});
assert.equal(swapped.ok, false);
assert.equal(swapped.code, ATM_COMMIT_ATTRIBUTION_MISMATCH);
assert.deepEqual(swapped.findings.map((finding) => finding.kind), ['content-mismatch']);

const modeChanged = compareCommitTreeToSealedBundle({
  sealed,
  actual: [
    { path: 'a.txt', mode: '100755', blobId: 'aaa' },
    { path: 'b.txt', mode: '100644', blobId: 'bbb' }
  ]
});
assert.deepEqual(modeChanged.findings.map((finding) => finding.kind), ['mode-mismatch']);

expectThrows(() => assertSealedBundleNotEmpty(sealCommitBundle({ entries: [] })), ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE);

// --- adapter: a same-path blob swap cannot reach the candidate tree -------

{
  const root = createRepository();
  const admitted = 'src/admitted.txt';
  write(root, admitted, 'admitted content\n');
  git(root, ['add', '--', admitted]);

  const bundle = sealCommitBundleFromLiveIndex({ cwd: root, paths: [admitted], provenance: 'task-scope' });
  assert.equal(bundle.entries.length, 1);
  const admittedBlob = bundle.entries[0].blobId;

  // A concurrent writer replaces the content behind the admitted path after
  // admission. Path-scoped staging would silently ship this instead.
  write(root, admitted, 'substituted by another writer\n');
  git(root, ['add', '--', admitted]);
  assert.notEqual(git(root, ['rev-parse', `:${admitted}`]), admittedBlob, 'live index must hold the substituted blob');

  const beforeHead = head(root);
  runWithSealedTaskScopedCommitIndex({
    cwd: root,
    paths: [admitted],
    provenance: 'task-scope',
    surface: 'test',
    sealedBundle: bundle,
    run: (env) => execFileSync('git', ['commit', '--quiet', '-m', 'sealed commit'], {
      cwd: root,
      env: { ...env, GIT_AUTHOR_NAME: 'fixture-writer', GIT_AUTHOR_EMAIL: 'fixture-writer@example.com' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  });
  assert.notEqual(head(root), beforeHead, 'sealed commit must land');

  const committed = readCommittedTreeEntries(root, head(root));
  assert.deepEqual(committed.map((entry) => entry.path), [admitted]);
  assert.equal(committed[0].blobId, admittedBlob, 'the committed blob must be the sealed one, not the substituted one');
}

// --- adapter: an unexpected candidate entry fails before any commit -------

{
  const root = createRepository();
  const admitted = 'src/mine.txt';
  const foreign = 'src/theirs.txt';
  write(root, admitted, 'mine\n');
  write(root, foreign, 'theirs\n');
  git(root, ['add', '--', admitted, foreign]);

  const bundle = sealCommitBundleFromLiveIndex({ cwd: root, paths: [admitted], provenance: 'task-scope' });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-candidate-'));
  roots.push(tempDir);
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  assembleSealedCommitIndex({ cwd: root, bundle, env });

  // The sealed assembly alone already excludes the foreign path.
  assert.deepEqual(readCandidateTreeEntries({ cwd: root, env }).map((entry) => entry.path), [admitted]);

  // Force the foreign entry into the candidate to prove the assertion, not the
  // assembly, is what fails closed.
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${git(root, ['rev-parse', `:${foreign}`])},${foreign}`], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const beforeHead = head(root);
  const error = expectThrows(
    () => assertCommitAttribution({
      sealed: bundle,
      actual: readCandidateTreeEntries({ cwd: root, env }),
      surface: 'test'
    }),
    ATM_COMMIT_ATTRIBUTION_MISMATCH
  );
  assert.equal(head(root), beforeHead, 'a failed attribution assertion must not move HEAD');
  const findings = (error.details?.findings ?? []) as { kind: string; path: string }[];
  assert.deepEqual(findings.map((finding) => `${finding.kind}:${finding.path}`), [`unexpected-path:${foreign}`]);
}

// --- adapter: a sealed path already equal to the base tree still matches --

{
  // A bundle legitimately contains paths whose staged content equals HEAD —
  // governance evidence that ATM re-emits identically, for example. Those
  // produce no diff entry, so comparing the seal against the diff alone would
  // report them as missing and block a correct commit.
  const root = createRepository();
  const unchanged = 'baseline.txt';
  const changed = 'src/changed.txt';
  write(root, changed, 'changed\n');
  git(root, ['add', '--', changed, unchanged]);

  const bundle = sealCommitBundleFromLiveIndex({ cwd: root, paths: [unchanged, changed], provenance: 'task-scope' });
  assert.deepEqual(bundle.entries.map((entry) => entry.path).sort(), [changed, unchanged].sort());

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-unchanged-'));
  roots.push(tempDir);
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  assembleSealedCommitIndex({ cwd: root, bundle, env });
  const proof = assertCommitAttribution({
    sealed: bundle,
    actual: readCandidateTreeEntries({ cwd: root, env, sealedPaths: bundle.entries.map((entry) => entry.path) }),
    surface: 'test'
  });
  assert.equal(proof.ok, true, 'an unchanged sealed path must not be reported missing');
  assert.equal(proof.matchedEntryCount, 2);
}

// --- adapter: an empty bundle no longer commits the live index ------------

{
  const root = createRepository();
  write(root, 'stray.txt', 'staged by someone else\n');
  git(root, ['add', '--', 'stray.txt']);
  const beforeHead = head(root);
  expectThrows(
    () => runWithSealedTaskScopedCommitIndex({
      cwd: root,
      paths: [],
      provenance: 'task-scope',
      surface: 'test',
      run: () => {
        throw new Error('run must never be reached for an empty bundle');
      }
    }),
    ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE
  );
  assert.equal(head(root), beforeHead, 'an empty bundle must not produce a commit');
}

// --- broker: admission runs before any ref update ------------------------

function schedulerFixture(taskIds: readonly string[]) {
  let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
  for (const taskId of taskIds) {
    scheduler = enqueueWaveBrokerTicket(scheduler, {
      waveId: 'wave-commit',
      taskId,
      surfaceKind: 'commit',
      surfaceFamily: 'cli',
      payloadDigest: `sha256:${taskId}`,
      now
    }).document;
  }
  const decision = planWaveBrokerBatch({
    document: scheduler,
    waveId: 'wave-commit',
    surfaceKind: 'commit',
    surfaceFamily: 'cli',
    expectedTaskIds: [...taskIds],
    now
  });
  return { scheduler, decision };
}

{
  const root = createRepository();
  const memberTasks = ['WAVE-MEMBER-A', 'WAVE-MEMBER-B'];
  const files = ['src/one.txt', 'src/two.txt'];
  write(root, files[0], 'one\n');
  write(root, files[1], 'two\n');
  git(root, ['add', '--', ...files]);
  const { scheduler, decision } = schedulerFixture(memberTasks);
  const fileSlices = { [memberTasks[0]]: [files[0]], [memberTasks[1]]: [files[1]] };
  const basePlanInput = {
    decision,
    scheduler,
    actorId: 'fixture-writer',
    manifestDigest: 'sha256:manifest',
    sealedBaseSha: 'sha256:base',
    currentHeadSha: head(root),
    expectedHeadSha: null,
    claimedTaskIds: memberTasks,
    validatorTaskIds: memberTasks,
    stagedFiles: files,
    fileSlices,
    temporaryIndexPath: path.join(root, '.git', 'atm-temp-index'),
    provenance: null
  };

  // Rejected admission: apply is requested, but the plan is blocked because a
  // member has no validator evidence. HEAD must not move.
  const beforeRejected = head(root);
  const rejected = runSharedDeliveryCommitTransaction({
    cwd: root,
    apply: true,
    actorId: 'fixture-writer',
    taskIds: memberTasks,
    expectedHeadSha: beforeRejected,
    payloadFiles: files,
    planInput: { ...basePlanInput, validatorTaskIds: [] }
  });
  assert.equal(rejected.plan.ok, false, 'missing validator evidence must block the plan');
  assert.equal(rejected.applied, null, 'a blocked plan must not apply');
  assert.equal(rejected.headMoved, false);
  assert.equal(head(root), beforeRejected, 'a rejected shared-delivery plan must leave HEAD unchanged');

  // Admitted: the commit lands and the receipt is derived from the tree that
  // actually landed rather than from the expected slices.
  const beforeAdmitted = head(root);
  const admittedTransaction = runSharedDeliveryCommitTransaction({
    cwd: root,
    apply: true,
    actorId: 'fixture-writer',
    taskIds: memberTasks,
    expectedHeadSha: beforeAdmitted,
    payloadFiles: files,
    planInput: basePlanInput
  });
  assert.equal(admittedTransaction.plan.ok, true, admittedTransaction.plan.reason);
  assert.ok(admittedTransaction.applied, 'an admitted plan must apply');
  assert.equal(head(root), admittedTransaction.applied!.commitSha);
  assert.deepEqual([...admittedTransaction.applied!.committedFiles].sort(), [...files].sort());
  const payloadAssertion = admittedTransaction.plan.receipt!.payloadAssertion;
  assert.equal(payloadAssertion.status, 'passed');
  assert.equal(payloadAssertion.committedFileCount, files.length);
  assert.deepEqual(payloadAssertion.unexpectedFiles, []);
  assert.deepEqual(payloadAssertion.missingFiles, []);
  assert.equal(admittedTransaction.applied!.attributionProof.ok, true);
}

// --- broker: a HEAD that moves after admission is a CAS failure, not a force

{
  const root = createRepository();
  const payload = 'src/queued.txt';
  write(root, payload, 'queued\n');
  git(root, ['add', '--', payload]);
  const staleHead = head(root);

  // Another lane lands first while this delivery was being prepared.
  write(root, 'other-lane.txt', 'other lane\n');
  git(root, ['add', '--', 'other-lane.txt']);
  git(root, ['commit', '--quiet', '-m', 'other lane commit']);
  const movedHead = head(root);
  assert.notEqual(movedHead, staleHead);

  const error = expectThrows(
    () => applySealedSharedDeliveryCommit({
      cwd: root,
      actorId: 'fixture-writer',
      taskIds: ['WAVE-MEMBER-A'],
      expectedHeadSha: staleHead,
      files: [payload]
    }),
    ATM_BROKER_BATCH_COMMIT_HEAD_MOVED
  );
  assert.equal(head(root), movedHead, 'the CAS update must not overwrite the other lane');
  assert.ok(String(error.details?.requiredCommand ?? '').includes('broker batch execute'), 'recovery must route back through the broker queue');
}

for (const root of roots) rmSync(root, { recursive: true, force: true });
console.log('commit-attribution-sealed-transaction: ok');

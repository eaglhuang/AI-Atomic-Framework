/**
 * Sealed commit concurrency and override-free attribution gates.
 *
 * Case ids:
 *   test_sealed_commit_dual_lane_prepare_and_broker_finalization
 *   test_governed_commit_seal_source_and_provenance_gates
 *
 * The properties under test are the ones that make parallel governed commits
 * safe by construction rather than by turn-taking: two lanes may seal at the
 * same time because sealing reads nothing the other lane owns, only the ref
 * update serializes, and it serializes through compare-and-swap so the loser
 * requeues instead of overwriting. Nothing here depends on which tasks, actors
 * or dates were involved when the incident was first observed.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ATM_COMMIT_ATTRIBUTION_MISMATCH,
  ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE,
  findSealedBundleProvenanceConflicts,
  sealCommitBundle
} from '../../packages/core/src/commit-attribution/sealed-commit-bundle.ts';
import {
  assembleSealedCommitIndex,
  mergeSealedCommitBundles,
  proveCommitAttribution,
  readCandidateTreeEntries,
  resolveGovernedCommitSeal,
  runWithSealedTaskScopedCommitIndex,
  sealCommitBundleFromLiveIndex
} from '../../packages/cli/src/commands/git-governance/implementation/sealed-commit-attribution.ts';
import { withTaskScopedCommitIndex } from '../../packages/cli/src/commands/git-governance/implementation/git-index-transaction.ts';
import {
  ATM_BROKER_BATCH_COMMIT_HEAD_MOVED,
  applySealedSharedDeliveryCommit
} from '../../packages/cli/src/commands/broker/shared-delivery-commit-transaction.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-concurrency-'));
  roots.push(root);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture-writer']);
  git(root, ['config', 'user.email', 'fixture-writer@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'baseline.txt', 'baseline\n');
  write(root, 'lane-a.txt', 'a base\n');
  write(root, 'lane-b.txt', 'b base\n');
  git(root, ['add', '--', 'baseline.txt', 'lane-a.txt', 'lane-b.txt']);
  git(root, ['commit', '--quiet', '-m', 'baseline']);
  return root;
}

function withTemporaryIndex<T>(run: (env: NodeJS.ProcessEnv) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'atm-candidate-index-'));
  try {
    return run({ ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

function readSource(relative: string): string {
  return readFileSync(path.join(repositoryRoot, relative), 'utf8');
}

// --- two lanes prepare concurrently; only the ref update serializes -------

{
  const root = createRepository();
  const baseHead = head(root);

  // Both lanes stage into the one shared index, which is the whole point: the
  // seal has to be lane-scoped even though the index is not.
  write(root, 'lane-a.txt', 'a from lane one\n');
  git(root, ['add', '--', 'lane-a.txt']);
  const sealA = sealCommitBundleFromLiveIndex({ cwd: root, paths: ['lane-a.txt'], provenance: 'shared-delivery-slice' });

  write(root, 'lane-b.txt', 'b from lane two\n');
  git(root, ['add', '--', 'lane-b.txt']);
  const sealB = sealCommitBundleFromLiveIndex({ cwd: root, paths: ['lane-b.txt'], provenance: 'shared-delivery-slice' });

  assert.deepEqual(sealA.entries.map((entry) => entry.path), ['lane-a.txt'], 'lane one must seal only its own path');
  assert.deepEqual(sealB.entries.map((entry) => entry.path), ['lane-b.txt'], 'lane two must seal only its own path');

  // Lane two's later staging cannot retroactively change what lane one sealed.
  const resealA = sealCommitBundleFromLiveIndex({ cwd: root, paths: ['lane-a.txt'], provenance: 'shared-delivery-slice' });
  assert.equal(resealA.entries[0]?.blobId, sealA.entries[0]?.blobId, 'a prepared seal must be stable across the other lane staging');

  // Each lane proves its own candidate tree in its own index, in parallel.
  for (const [seal, own, foreign] of [[sealA, 'lane-a.txt', 'lane-b.txt'], [sealB, 'lane-b.txt', 'lane-a.txt']] as const) {
    withTemporaryIndex((env) => {
      assembleSealedCommitIndex({ cwd: root, bundle: seal, env, baseRef: baseHead });
      const candidate = readCandidateTreeEntries({
        cwd: root,
        env,
        baseRef: baseHead,
        sealedPaths: seal.entries.map((entry) => entry.path)
      });
      assert.equal(proveCommitAttribution({ sealed: seal, actual: candidate }).ok, true, `${own} candidate must equal its seal`);
      assert.ok(!candidate.some((entry) => entry.path === foreign), `${own} candidate must not carry ${foreign}`);
    });
  }

  // Finalization is the only serialized step, and it is compare-and-swap.
  const laneOne = applySealedSharedDeliveryCommit({
    cwd: root,
    actorId: 'lane-one',
    taskIds: ['LANE-ONE'],
    expectedHeadSha: baseHead,
    files: ['lane-a.txt']
  });
  assert.equal(head(root), laneOne.commitSha, 'the admitted lane must publish its commit');

  const contended = expectThrows(
    () => applySealedSharedDeliveryCommit({
      cwd: root,
      actorId: 'lane-two',
      taskIds: ['LANE-TWO'],
      expectedHeadSha: baseHead,
      files: ['lane-b.txt']
    }),
    ATM_BROKER_BATCH_COMMIT_HEAD_MOVED
  );
  const details = (contended.details ?? {}) as Record<string, unknown>;
  assert.equal(head(root), laneOne.commitSha, "the other lane's commit must survive untouched");
  assert.equal(
    details.requiredCommand,
    'node atm.mjs broker batch execute --surface commit --json',
    'a moved HEAD must route back through the broker queue'
  );
  assert.deepEqual(details.safeNextActions, ['requeue-through-the-broker-and-re-plan-against-the-new-head']);
  // The losing lane wrote a commit object but never published it: the retry is
  // a requeue against the new HEAD, not a force of the object it already has.
  assert.equal(git(root, ['cat-file', '-t', String(details.unpublishedCommitSha)]), 'commit');
  assert.notEqual(details.unpublishedCommitSha, head(root));
}

// --- the shared-delivery surface has no non-CAS finalization route --------

{
  const transactionSource = readSource('packages/cli/src/commands/broker/shared-delivery-commit-transaction.ts');
  const brokerSource = readSource('packages/cli/src/commands/broker/batch-execute-actions.ts');
  const refUpdates = [...transactionSource.matchAll(/'update-ref'[^\]]*\]/g)].map((match) => match[0]);
  assert.equal(refUpdates.length, 1, 'exactly one ref update site may exist on the shared-delivery surface');
  assert.match(refUpdates[0]!, /expectedHeadSha/, 'the ref update must compare against the admitted HEAD');
  assert.ok(!/'-f'|'--force'/.test(transactionSource), 'the shared-delivery finalization must never force a ref');
  assert.ok(!/'git',\s*\['commit'/.test(transactionSource), 'HEAD must move through commit-tree plus a CAS update-ref, not git commit');
  // Batch execute is the caller, so it must own no finalization primitive of
  // its own: read-only plumbing is all that may remain there.
  for (const primitive of ["'update-ref'", "'commit-tree'", "'write-tree'", "'reset'"]) {
    assert.ok(!brokerSource.includes(primitive), `broker batch execute must delegate ${primitive} to the transaction module`);
  }
}

// --- a successful governed commit uses no override lease -----------------

{
  const root = createRepository();
  write(root, 'lane-a.txt', 'sealed success path\n');
  git(root, ['add', '--', 'lane-a.txt']);
  const bundle = sealCommitBundleFromLiveIndex({ cwd: root, paths: ['lane-a.txt'], provenance: 'task-scope' });
  const outcome = runWithSealedTaskScopedCommitIndex({
    cwd: root,
    paths: ['lane-a.txt'],
    provenance: 'task-scope',
    surface: 'test',
    sealSource: { kind: 'sealed-bundle', bundle },
    run: (env) => execFileSync('git', ['commit', '--quiet', '-m', 'sealed success'], {
      cwd: root,
      env: { ...env, GIT_AUTHOR_NAME: 'fixture-writer', GIT_AUTHOR_EMAIL: 'fixture-writer@example.com' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  });
  assert.equal(outcome.proof.ok, true);
  assert.equal(outcome.sealSource, 'sealed-bundle');
  assert.equal(outcome.liveIndexSealDiagnostic, null);
  assert.ok(!existsSync(path.join(root, '.atm', 'runtime', 'git-index-leases')), 'the success path must not mint an index override lease');
  assert.ok(!existsSync(path.join(root, '.atm', 'history', 'protected-override-audit')), 'the success path must not record override authority');

  // Static half of the same property: the sealed transaction modules cannot
  // request or consume override authority even if a caller wanted them to.
  for (const relative of [
    'packages/cli/src/commands/git-governance/implementation/sealed-commit-attribution.ts',
    'packages/cli/src/commands/broker/shared-delivery-commit-transaction.ts'
  ]) {
    assert.ok(!/OverrideLease/.test(readSource(relative)), `${relative} must stay override-lease free`);
  }
}

// --- provenance mismatch is a named finding and fails closed -------------

{
  const conflicts = findSealedBundleProvenanceConflicts([
    { path: 'shared.txt', mode: '100644', blobId: 'aaa', provenance: 'task-scope' },
    { path: 'shared.txt', mode: '100644', blobId: 'aaa', provenance: 'shared-delivery-slice' }
  ]);
  assert.deepEqual(conflicts.map((finding) => finding.kind), ['provenance-mismatch']);
  assert.equal(conflicts[0]?.sealedProvenance, 'task-scope');
  assert.equal(conflicts[0]?.conflictingProvenance, 'shared-delivery-slice');
  // Identical content is exactly the case a content-only comparison misses.
  assert.equal(conflicts[0]?.sealedBlobId, conflicts[0]?.actualBlobId);

  const root = createRepository();
  const beforeHead = head(root);
  write(root, 'lane-a.txt', 'admitted content\n');
  git(root, ['add', '--', 'lane-a.txt']);
  const admitted = sealCommitBundleFromLiveIndex({ cwd: root, paths: ['lane-a.txt'], provenance: 'task-scope' });
  const relabelled = sealCommitBundle({
    entries: admitted.entries.map((entry) => ({ ...entry, provenance: 'governance-evidence' }))
  });

  const rejected = expectThrows(() => mergeSealedCommitBundles(admitted, relabelled), ATM_COMMIT_ATTRIBUTION_MISMATCH);
  const findings = ((rejected.details ?? {}) as { findings?: readonly { kind: string; path: string }[] }).findings ?? [];
  assert.deepEqual(findings.map((finding) => `${finding.kind}:${finding.path}`), ['provenance-mismatch:lane-a.txt']);
  assert.equal(head(root), beforeHead, 'a provenance conflict must be refused before anything moves a ref');

  // Declared supersession stays legal: ATM staging its own governance evidence
  // over a path the task also admitted is the one relabel that is accounted for.
  const merged = mergeSealedCommitBundles(admitted, relabelled, { supersedingPaths: ['lane-a.txt'] });
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0]?.provenance, 'governance-evidence');
}

// --- the governed path cannot fall back to the live index ----------------

{
  const root = createRepository();
  write(root, 'stray.txt', 'staged by someone else\n');
  git(root, ['add', '--', 'stray.txt']);
  const beforeHead = head(root);
  const neverRun = () => {
    throw new Error('run must never be reached without a named seal source');
  };

  const unnamed = expectThrows(
    () => runWithSealedTaskScopedCommitIndex({
      cwd: root,
      paths: ['stray.txt'],
      provenance: 'task-scope',
      surface: 'test',
      sealSource: undefined as never,
      run: neverRun
    }),
    ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE
  );
  assert.equal(((unnamed.details ?? {}) as { sealSourceKind?: unknown }).sealSourceKind, null);

  // The governed wrapper is the route a real commit takes, so it has to fail
  // the same way rather than quietly sealing whatever the shared index holds.
  expectThrows(
    () => withTaskScopedCommitIndex(root, ['stray.txt'], 'claude-006', 'TASK-TEST-0001', neverRun, null),
    ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE
  );
  expectThrows(
    () => runWithSealedTaskScopedCommitIndex({
      cwd: root,
      paths: ['stray.txt'],
      provenance: 'task-scope',
      surface: 'test',
      sealSource: { kind: 'live-index-diagnostic', reason: '   ' },
      run: neverRun
    }),
    ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE
  );
  assert.equal(head(root), beforeHead, 'no unsealed attempt may produce a commit');

  // The remaining live-index route is named, carries its reason into the
  // outcome, and is never what a governed commit resolves to.
  // A no-op callback never produces a committed tree, so the transaction must
  // fail rather than treating a pre-commit diagnostic as post-commit proof.
  expectThrows(
    () => runWithSealedTaskScopedCommitIndex({
      cwd: root,
      paths: ['stray.txt'],
      provenance: 'pre-staged-index',
      surface: 'test',
      sealSource: { kind: 'live-index-diagnostic', reason: 'attribution probe' },
      run: () => 'observed'
    }),
    ATM_COMMIT_ATTRIBUTION_MISMATCH
  );
  assert.equal(head(root), beforeHead, 'a no-op diagnostic callback must not move a ref');

  const governed = resolveGovernedCommitSeal({
    cwd: root,
    admittedBundle: null,
    paths: ['stray.txt'],
    provenance: 'pre-staged-index'
  });
  assert.equal(governed.kind, 'sealed-bundle', 'the governed resolver always produces an explicit seal');
}

for (const root of roots) rmSync(root, { recursive: true, force: true });
console.log('commit-attribution concurrency and override-free gates: all assertions passed');

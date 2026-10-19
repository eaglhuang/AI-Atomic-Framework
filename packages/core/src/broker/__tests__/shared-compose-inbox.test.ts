// Cross-writer batch coordinator: one commit for a compatible batch, maximal legal subset on conflict.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { composeBrokerProposals } from '../compose.ts';
import { applyUnifiedPatch } from '../unified-patch.ts';
import { hashComposeBytes, recoverSharedComposeInbox, submitSharedComposeProposal, type SharedComposeReceipt } from '../shared-compose-inbox.ts';
import { materializeMember, proveOrderIndependentMerge, type ReadyMember } from '../shared-compose-inbox-merge.ts';
import {
  BASE,
  assertClean,
  assertCommittedBytes,
  createScene,
  patchLine,
  runJobs,
  workerJob
} from './shared-compose-inbox.fixture.ts';

function assertEmptyPatchMemberIsIdentity(): void {
  // A rename-only member submits an empty patch; it must materialize to the
  // declared base, while a non-empty patch without hunks still fails closed.
  for (const patch of ['', '\n', '  \n']) {
    const made = materializeMember({ proposalId: 'rename', arrivedAt: 0, baseBytes: BASE, patch });
    assert.equal(made.ok, true);
    if (made.ok) assert.equal(made.ready.mine, BASE);
  }
  const prose = materializeMember({ proposalId: 'prose', arrivedAt: 0, baseBytes: BASE, patch: 'please rename the file\n' });
  assert.equal(prose.ok, false);
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-compose-inbox-'));
  try {
    assertDisjointComposeStillParallelSafe();
    assertEmptyPatchMemberIsIdentity();
    await testImmediateWindowRecomputesOnNewBase(root);
    await testWindowExpiryRecomputesLateProposal(root);
    await testTwoProcessBarrier(root);
    await testArrivalOrdersShareSetKey(root);
    await testSameRegionMergeable(root);
    await testConflictAcceptsMaximalSubset(root);
    await testFullRejectHasNoSideEffects(root);
    await testCrashPeerRecovers(root);
    await testCrashExplicitCleanup(root);
    await testResubmitIsIdempotent(root);
    console.log('ok: shared compose inbox');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertDisjointComposeStillParallelSafe(): void {
  const left = proposal('prop-left', patchLine('demo.txt', 1, 'BETA'));
  const right = proposal('prop-right', patchLine('demo.txt', 4, 'EPSILON'));
  const result = composeBrokerProposals([left, right]);
  assert.equal(result.ok, true);
  assert.equal(result.mergePlan.verdict, 'parallel-safe');
}

async function testImmediateWindowRecomputesOnNewBase(root: string): Promise<void> {
  const scene = createScene(root, 'immediate');
  const first = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA')));
  assert.equal(first.batchSize, 1);
  assert.equal(first.terminal, 'committed');
  assert.equal(first.stopReason, 'acked-in-window');
  assert.deepEqual(first.stagesReached, ['admission', 'batch', 'compose', 'commit']);
  assert.equal(first.scope, 'scope-prop-a');
  assert.deepEqual(first.validators, ['validator-noop']);
  assert.equal(first.retryCount, 0);
  assertCommittedBytes(first, scene.targetPath);
  const afterFirst = readFileSync(scene.targetPath, 'utf8');

  const adjacent = await submitSharedComposeProposal(scene.input('prop-b', 'writer-b', patchLine(scene.targetFile, 2, 'GAMMA')));
  assert.equal(adjacent.terminal, 'rejected-conflict');
  assert.equal(adjacent.stopReason, 'conflict');
  assert.equal(adjacent.late, true);
  assert.notEqual(adjacent.batchId, first.batchId);
  assert.equal(adjacent.batchSize, 1);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), afterFirst);
  assertClean(scene.targetPath, 'adjacent-recompute');
  assert.equal(readFileSync(scene.targetPath, 'utf8').includes('GAMMA'), false);

  const third = await submitSharedComposeProposal(scene.input('prop-c', 'writer-c', patchLine(scene.targetFile, 4, 'EPSILON')));
  assert.equal(third.terminal, 'committed');
  assert.equal(third.batchSize, 1);
  assert.notEqual(third.baseHash, first.baseHash);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), proveOne(afterFirst, 'prop-c', patchLine(scene.targetFile, 4, 'EPSILON')));
  assertCommittedBytes(third, scene.targetPath);

  const denied = await submitSharedComposeProposal({
    ...scene.input('prop-deny', 'writer-d', patchLine(scene.targetFile, 5, 'ZETA')),
    admission: { admitted: false, reasonCode: 'not-admitted' }
  });
  assert.equal(denied.terminal, 'rejected-admission');
  assert.equal(denied.batchId, null);
  assert.equal(denied.stopReason, 'not-admitted');
}

async function testWindowExpiryRecomputesLateProposal(root: string): Promise<void> {
  const scene = createScene(root, 'expiry');
  const first = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    composeWindowMs: 80,
    maxBatchSize: 8
  }));
  const second = await submitSharedComposeProposal(scene.input('prop-b', 'writer-b', patchLine(scene.targetFile, 4, 'EPSILON'), {
    composeWindowMs: 80,
    maxBatchSize: 8
  }));
  assert.equal(first.batchSize, 1);
  assert.equal(second.batchSize, 1);
  assert.equal(first.terminal, 'committed');
  assert.equal(second.terminal, 'committed');
  assert.equal(second.late, true);
  assert.notEqual(first.batchId, second.batchId);
  assert.equal(first.baseHash, hashComposeBytes(BASE));
  assert.notEqual(second.baseHash, first.baseHash);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), proveMany(BASE, [
    ['prop-a', patchLine(scene.targetFile, 1, 'BETA')],
    ['prop-b', patchLine(scene.targetFile, 4, 'EPSILON')]
  ]));
  assertCommittedBytes(second, scene.targetPath);
}

async function testTwoProcessBarrier(root: string): Promise<void> {
  const scene = createScene(root, 'barrier');
  const barrierDir = path.join(scene.dir, 'barrier');
  const results = await runJobs([
    workerJob(scene, 'prop-a', patchLine(scene.targetFile, 1, 'BETA'), { composeWindowMs: 2_000, maxBatchSize: 2, barrierDir }),
    workerJob(scene, 'prop-b', patchLine(scene.targetFile, 4, 'EPSILON'), { composeWindowMs: 2_000, maxBatchSize: 2, barrierDir })
  ]);
  const left = must(results[0]);
  const right = must(results[1]);
  assert.equal(left.terminal, 'committed');
  assert.equal(right.terminal, 'committed');
  assert.equal(left.batchId, right.batchId);
  assert.equal(left.batchSize, 2);
  assert.equal(right.batchSize, 2);
  assert.equal(left.renameCount, 1);
  assert.equal(right.renameCount, 1);
  assert.deepEqual(left.acceptedSetKey, ['prop-a', 'prop-b']);
  assert.deepEqual(left.memberProposalIds.slice().sort(), ['prop-a', 'prop-b']);
  assert.equal(left.resultHash, right.resultHash);
  assert.equal(left.baseHash, hashComposeBytes(BASE));
  assert.equal(readFileSync(scene.targetPath, 'utf8'), proveMany(BASE, [
    ['prop-a', patchLine(scene.targetFile, 1, 'BETA')],
    ['prop-b', patchLine(scene.targetFile, 4, 'EPSILON')]
  ]));
  assertCommittedBytes(left, scene.targetPath);
}

async function testArrivalOrdersShareSetKey(root: string): Promise<void> {
  const keys: string[][] = [];
  for (const first of ['prop-a', 'prop-b'] as const) {
    const scene = createScene(root, `order-${first}`);
    const second = first === 'prop-a' ? 'prop-b' : 'prop-a';
    const patchA = patchLine(scene.targetFile, 0, 'ALPHA');
    const patchB = patchLine(scene.targetFile, 2, 'GAMMA');
    const [left, right] = await Promise.all([
      submitSharedComposeProposal(scene.input(first, 'writer-1', first === 'prop-a' ? patchA : patchB, { composeWindowMs: 2_000, maxBatchSize: 2 })),
      submitSharedComposeProposal(scene.input(second, 'writer-2', second === 'prop-b' ? patchB : patchA, { composeWindowMs: 2_000, maxBatchSize: 2 }))
    ]);
    assert.equal(left.batchId, right.batchId);
    assert.equal(left.batchSize, 2);
    assert.equal(left.terminal, 'committed');
    assert.equal(right.terminal, 'committed');
    keys.push(left.acceptedSetKey);
    assert.equal(readFileSync(scene.targetPath, 'utf8'), proveMany(BASE, [['prop-a', patchA], ['prop-b', patchB]]));
    assertClean(scene.targetPath, first);
  }
  assert.deepEqual(keys[0], keys[1]);
  assert.deepEqual(keys[0], ['prop-a', 'prop-b']);
}

async function testSameRegionMergeable(root: string): Promise<void> {
  const scene = createScene(root, 'same-region');
  const patchA = patchLine(scene.targetFile, 0, 'ALPHA');
  const patchB = patchLine(scene.targetFile, 2, 'GAMMA');
  const [left, right] = await Promise.all([
    submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchA, { composeWindowMs: 2_000, maxBatchSize: 2 })),
    submitSharedComposeProposal(scene.input('prop-b', 'writer-b', patchB, { composeWindowMs: 2_000, maxBatchSize: 2 }))
  ]);
  assert.equal(left.terminal, 'committed');
  assert.equal(right.terminal, 'committed');
  assert.equal(left.renameCount, 1);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), proveMany(BASE, [['prop-a', patchA], ['prop-b', patchB]]));
  assertCommittedBytes(left, scene.targetPath);
}

async function testConflictAcceptsMaximalSubset(root: string): Promise<void> {
  const scene = createScene(root, 'maximal');
  const patchA = patchLine(scene.targetFile, 1, 'BETA-A');
  const patchB = patchLine(scene.targetFile, 1, 'BETA-B');
  const patchC = patchLine(scene.targetFile, 4, 'EPSILON');
  const [a, b, c] = await Promise.all([
    submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchA, { composeWindowMs: 2_000, maxBatchSize: 3 })),
    submitSharedComposeProposal(scene.input('prop-b', 'writer-b', patchB, { composeWindowMs: 2_000, maxBatchSize: 3 })),
    submitSharedComposeProposal(scene.input('prop-c', 'writer-c', patchC, { composeWindowMs: 2_000, maxBatchSize: 3 }))
  ]);
  const byId = new Map([a, b, c].map((receipt) => [receipt.proposalId, receipt]));
  assert.equal(byId.get('prop-a')?.terminal, 'committed');
  assert.equal(byId.get('prop-c')?.terminal, 'committed');
  assert.equal(byId.get('prop-b')?.terminal, 'rejected-conflict');
  assert.equal(byId.get('prop-b')?.stopReason, 'excluded-by-arrival-maximal-subset');
  assert.deepEqual(a.acceptedSetKey, ['prop-a', 'prop-c']);
  assert.equal(a.batchSize, 3);
  assert.equal(a.renameCount, 1);
  assert.equal(byId.get('prop-b')?.renameCount, 0);
  const text = assertClean(scene.targetPath, 'maximal');
  assert.equal(text.includes('BETA-B'), false);
  assert.equal(text, proveMany(BASE, [['prop-a', patchA], ['prop-c', patchC]]));
  const rejectedAlone = proveMany(BASE, [['prop-b', patchB]]);
  assert.notEqual(rejectedAlone, text);
  const withRejected = proveOrderIndependentMerge(BASE, readyMembers([
    ['prop-a', patchA],
    ['prop-b', patchB],
    ['prop-c', patchC]
  ]));
  assert.equal(withRejected.ok, false);
  assertCommittedBytes(a, scene.targetPath);
}

async function testFullRejectHasNoSideEffects(root: string): Promise<void> {
  const scene = createScene(root, 'unapplicable');
  const broken = ['--- a/shared.txt', '+++ b/shared.txt', '@@ -2,1 +2,1 @@', '-nope', '+NOPE', ''].join('\n');
  const before = readFileSync(scene.targetPath, 'utf8');
  const receipt = await submitSharedComposeProposal(scene.input('prop-bad', 'writer-a', broken));
  assert.equal(receipt.terminal, 'error');
  assert.equal(readFileSync(scene.targetPath, 'utf8'), before);
  assert.equal(receipt.renameCount, 0);
  assertClean(scene.targetPath, 'full-reject');
}

async function testCrashPeerRecovers(root: string): Promise<void> {
  const scene = createScene(root, 'crash-peer');
  writeFileSync(path.join(scene.inboxDir, 'crash-once'), '1');
  const barrierDir = path.join(scene.dir, 'barrier');
  const results = await runJobs([
    { ...workerJob(scene, 'prop-a', patchLine(scene.targetFile, 1, 'BETA'), { composeWindowMs: 2_000, maxBatchSize: 2, barrierDir }), crashOnFlag: true },
    { ...workerJob(scene, 'prop-b', patchLine(scene.targetFile, 4, 'EPSILON'), { composeWindowMs: 2_000, maxBatchSize: 2, barrierDir }), crashOnFlag: true }
  ], { allowExit: new Set([0, 99]) });
  assert.ok(results.some((result) => result.status === 99));
  assert.ok(results.some((result) => result.status === 0));
  assert.equal(readFileSync(scene.targetPath, 'utf8'), proveMany(BASE, [
    ['prop-a', patchLine(scene.targetFile, 1, 'BETA')],
    ['prop-b', patchLine(scene.targetFile, 4, 'EPSILON')]
  ]));
  for (const id of ['prop-a', 'prop-b']) {
    const receipt = JSON.parse(readFileSync(path.join(scene.inboxDir, 'receipts', `${id}.json`), 'utf8')) as SharedComposeReceipt;
    assert.equal(receipt.terminal, 'committed');
    assert.equal(receipt.batchSize, 2);
    assert.equal(receipt.renameCount, 1);
  }
  assert.equal(readdirSync(scene.dir).some((name) => name.includes('.tmp-compose-')), false);
}

async function testCrashExplicitCleanup(root: string): Promise<void> {
  const scene = createScene(root, 'crash-cleanup');
  writeFileSync(path.join(scene.inboxDir, 'crash-once'), '1');
  const [result] = await runJobs([
    { ...workerJob(scene, 'prop-a', patchLine(scene.targetFile, 1, 'BETA'), { composeWindowMs: 0, maxBatchSize: 1, barrierDir: null }), crashOnFlag: true }
  ], { allowExit: new Set([99]) });
  assert.equal(result?.status, 99);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), BASE);
  assert.equal(existsSync(path.join(scene.inboxDir, 'receipts', 'prop-a.json')), false);
  const tempsBefore = readdirSync(scene.dir).filter((name) => name.includes('.tmp-compose-'));
  assert.ok(tempsBefore.length >= 1);
  const recovered = recoverSharedComposeInbox({ inboxDir: scene.inboxDir, force: true });
  assert.ok(recovered.recoveredBatchIds.length >= 1);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), applyUnifiedPatch(BASE, patchLine(scene.targetFile, 1, 'BETA')));
  assert.equal(readdirSync(scene.dir).some((name) => name.includes('.tmp-compose-')), false);
  assert.ok(recovered.removedTempFiles.length >= 1);
  const again = recoverSharedComposeInbox({ inboxDir: scene.inboxDir, force: true });
  assert.deepEqual([...again.recoveredBatchIds], []);
  const receipt = JSON.parse(readFileSync(path.join(scene.inboxDir, 'receipts', 'prop-a.json'), 'utf8')) as SharedComposeReceipt;
  assert.equal(receipt.terminal, 'committed');
  assert.equal(receipt.batchSize, 1);
  assert.equal(receipt.renameCount, 1);
}

async function testResubmitIsIdempotent(root: string): Promise<void> {
  const scene = createScene(root, 'idempotent');
  const patch = patchLine(scene.targetFile, 1, 'BETA');
  const first = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patch));
  const second = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patch));
  assert.equal(second.terminal, 'committed');
  assert.equal(second.batchId, first.batchId);
  assert.equal(second.renameCount, 1);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), applyUnifiedPatch(BASE, patch));
}

function must(result: { receipt: SharedComposeReceipt } | undefined): SharedComposeReceipt {
  if (!result?.receipt) throw new Error('缺少提案收據');
  return result.receipt;
}

function proveOne(windowBase: string, proposalId: string, patch: string): string {
  return proveMany(windowBase, [[proposalId, patch]]);
}

function proveMany(windowBase: string, members: readonly (readonly [string, string])[]): string {
  const proof = proveOrderIndependentMerge(windowBase, readyMembers(members));
  if (!proof.ok) throw new Error(proof.detail);
  return proof.content;
}

function readyMembers(members: readonly (readonly [string, string])[]): ReadyMember[] {
  return members.map(([proposalId, patch]) => {
    const made = materializeMember({ proposalId, arrivedAt: 0, baseBytes: BASE, patch });
    if (!made.ok) throw new Error(made.detail);
    return made.ready;
  });
}

function proposal(proposalId: string, patch: string) {
  return {
    schemaId: 'atm.patchProposal.v1' as const,
    specVersion: '0.1.0' as const,
    migration: { strategy: 'none' as const, fromVersion: null, notes: 'test' },
    proposalId,
    taskId: `TASK-${proposalId}`,
    actorId: proposalId,
    baseCommit: '0'.repeat(40),
    fileBeforeHash: hashComposeBytes(BASE),
    targetFile: 'demo.txt',
    atomRefs: [{ atomId: `atom.${proposalId}`, atomCid: `cid.${proposalId}` }],
    anchors: [{ kind: 'line', hint: proposalId }],
    intent: proposalId,
    patch,
    validators: [] as string[],
    rollback: 'discard'
  };
}

await main();

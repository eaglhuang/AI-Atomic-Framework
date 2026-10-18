// Deadline, retry, and terminal-state contract for the shared compose inbox.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyUnifiedPatch } from '../unified-patch.ts';
import {
  hashComposeBytes,
  reconcileSharedComposeProposal,
  recoverSharedComposeInbox,
  registerSharedComposeEntryPoint,
  stopSharedComposeEntryPoint,
  submitSharedComposeProposal
} from '../shared-compose-inbox.ts';
import { SHARED_COMPOSE_CONTRACT } from '../shared-compose-inbox-contract.ts';
import { BASE, assertClean, assertCommittedBytes, createScene, patchLine } from './shared-compose-inbox.fixture.ts';

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-compose-time-'));
  try {
    await testRetryLimitStopsOnNinthAttempt(root);
    await testRecomposeCountsAndClockDoesNotReset(root);
    await testExecutableSecondsUseItemStop(root);
    await testDurableUnacked(root);
    await testLateCommitAfterTimeout(root);
    await testReconciliationIncomplete(root);
    await testCleanupKeepsLiveWriterTemp(root);
    console.log('ok: shared compose inbox time contract');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testRetryLimitStopsOnNinthAttempt(root: string): Promise<void> {
  const scene = createScene(root, 'retry-limit');
  let drifts = 0;
  const receipt = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    deadlineMs: 60_000,
    onBeforeHashCheck: () => {
      drifts += 1;
      writeFileSync(scene.targetPath, `DRIFT-${drifts}\n`);
    }
  }));
  assert.equal(receipt.terminal, 'retry-exhausted');
  assert.equal(receipt.stopReason, 'retry-limit');
  assert.equal(receipt.attemptCount, SHARED_COMPOSE_CONTRACT.maxAttempts);
  assert.equal(receipt.retryCount, SHARED_COMPOSE_CONTRACT.maxRetriesAfterFirstSubmit);
  assert.equal(drifts, SHARED_COMPOSE_CONTRACT.maxAttempts);
  assert.equal(readFileSync(scene.targetPath, 'utf8').includes('BETA'), false);
  assert.equal(receipt.renameCount, 0);
  assertClean(scene.targetPath, 'retry-limit');
}

async function testRecomposeCountsAndClockDoesNotReset(root: string): Promise<void> {
  const scene = createScene(root, 'clock');
  let ticks = 5_000;
  let drifts = 0;
  const receipt = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    deadlineMs: 30_000,
    now: () => ticks,
    onBeforeHashCheck: () => {
      if (drifts > 0) return;
      drifts += 1;
      ticks += 4_000;
      const current = readFileSync(scene.targetPath, 'utf8');
      writeFileSync(scene.targetPath, `${current}# drift\n`);
    }
  }));
  assert.equal(drifts, 1);
  assert.equal(receipt.terminal, 'committed');
  assert.equal(receipt.retryCount, 1);
  assert.equal(receipt.attemptCount, 2);
  assert.equal(receipt.firstSubmittedAt, 5_000);
  assert.equal(receipt.executableSeconds, 30);
  assert.equal(receipt.elapsedMs, 4_000);
  assert.equal(readFileSync(scene.targetPath, 'utf8').includes('BETA'), true);
  assertCommittedBytes(receipt, scene.targetPath);
  assertClean(scene.targetPath, 'clock');
}

async function testExecutableSecondsUseItemStop(root: string): Promise<void> {
  const scene = createScene(root, 'executable');
  let ticks = 2_000;
  const receipt = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    deadlineMs: 30_000,
    itemStopAt: 30_000,
    now: () => ticks
  }));
  assert.equal(receipt.terminal, 'committed');
  assert.equal(receipt.firstSubmittedAt, 2_000);
  assert.equal(receipt.effectiveStopAt, 30_000);
  assert.equal(receipt.executableSeconds, 28);
  assert.equal(receipt.retryCount, 0);
  assertCommittedBytes(receipt, scene.targetPath);
}

async function testDurableUnacked(root: string): Promise<void> {
  const scene = createScene(root, 'durable');
  let ticks = 0;
  const receipt = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    deadlineMs: 30_000,
    now: () => ticks,
    onBeforeAck: () => { ticks = 30_001; }
  }));
  assert.equal(receipt.terminal, 'durable-unacked');
  assert.equal(receipt.stopReason, 'ack-late');
  assert.equal(receipt.renameAt !== null && receipt.renameAt <= 30_000, true);
  assert.equal(receipt.ackAt !== null && receipt.ackAt > 30_000, true);
  assert.notEqual(receipt.terminal, 'late-commit-after-timeout');
  assert.equal(readFileSync(scene.targetPath, 'utf8'), applyUnifiedPatch(BASE, patchLine(scene.targetFile, 1, 'BETA')));
  assert.equal(hashComposeBytes(readFileSync(scene.targetPath, 'utf8')), receipt.resultHash);
  assertClean(scene.targetPath, 'durable-unacked');

  const missing = createScene(root, 'ack-missing');
  const hidden = await submitSharedComposeProposal(missing.input('prop-a', 'writer-a', patchLine(missing.targetFile, 1, 'BETA'), {
    deadlineMs: 30_000,
    now: () => 0,
    suppressAck: true
  }));
  assert.equal(hidden.terminal, 'durable-unacked');
  assert.equal(hidden.stopReason, 'ack-missing');
  assert.equal(hidden.ackAt, null);
  assert.equal(existsSync(path.join(missing.inboxDir, 'receipts', 'prop-a.json')), false);
  assert.equal(readFileSync(missing.targetPath, 'utf8'), applyUnifiedPatch(BASE, patchLine(missing.targetFile, 1, 'BETA')));
}

async function testLateCommitAfterTimeout(root: string): Promise<void> {
  const scene = createScene(root, 'late');
  let ticks = 0;
  const receipt = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    deadlineMs: 30_000,
    now: () => ticks,
    onAfterRename: () => { ticks = 30_001; }
  }));
  assert.equal(receipt.terminal, 'late-commit-after-timeout');
  assert.equal(receipt.stopReason, 'rename-after-stop');
  assert.equal(receipt.renameAt !== null && receipt.renameAt > 30_000, true);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), applyUnifiedPatch(BASE, patchLine(scene.targetFile, 1, 'BETA')));
  assertClean(scene.targetPath, 'late-commit');
}

async function testReconciliationIncomplete(root: string): Promise<void> {
  const scene = createScene(root, 'reconcile');
  registerSharedComposeEntryPoint(scene.inboxDir, 'peer-live', process.pid);
  const pending = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA'), {
    deadlineMs: 30_000,
    now: () => 1_000
  }));
  assert.equal(pending.terminal, 'reconciliation-incomplete');
  assert.equal(pending.stopReason, 'entry-points-still-live');
  assert.equal(pending.resolvedTerminal, 'committed');
  assert.equal(readFileSync(scene.targetPath, 'utf8'), applyUnifiedPatch(BASE, patchLine(scene.targetFile, 1, 'BETA')));
  stopSharedComposeEntryPoint(scene.inboxDir, 'peer-live', 1_500);
  const settled = reconcileSharedComposeProposal({
    inboxDir: scene.inboxDir,
    proposalId: 'prop-a',
    now: () => 1_500
  });
  assert.equal(settled.terminal, 'committed');
  assert.equal(settled.stopReason, 'acked-in-window');
  assert.equal(hashComposeBytes(readFileSync(scene.targetPath, 'utf8')), settled.resultHash);
  assertClean(scene.targetPath, 'reconcile');
}

async function testCleanupKeepsLiveWriterTemp(root: string): Promise<void> {
  const scene = createScene(root, 'live-temp');
  const live = path.join(scene.inboxDir, `.shared.txt.tmp-compose-${process.pid}-ab12cd`);
  const dead = path.join(scene.inboxDir, '.shared.txt.tmp-compose-2147483646-ab12cd');
  writeFileSync(live, 'live-writer');
  writeFileSync(dead, 'dead-writer');
  const recovered = recoverSharedComposeInbox({ inboxDir: scene.inboxDir, force: true });
  assert.equal(existsSync(live), true);
  assert.equal(existsSync(dead), false);
  assert.ok(recovered.removedTempFiles.some((file) => file.endsWith('2147483646-ab12cd')));
  assert.equal(readFileSync(live, 'utf8'), 'live-writer');
}

await main();

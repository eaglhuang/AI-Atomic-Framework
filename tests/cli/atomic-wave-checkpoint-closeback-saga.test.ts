import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';
import {
  createAtomicWaveCheckpointReceipt,
  evaluateAtomicWaveCheckpoint,
  planWaveGeneratedWrite
} from '../../packages/core/src/broker/wave-generated-executor.ts';
import { planSharedDeliveryCommit } from '../../packages/core/src/broker/shared-delivery-commit.ts';

const now = '2026-07-19T00:00:00.000Z';
const waveId = 'wave-checkpoint-saga';
const taskIds = ['ATM-GOV-A', 'ATM-GOV-B'];
let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
for (const surfaceKind of ['commit', 'build', 'projection'] as const) {
  for (const taskId of taskIds) {
    scheduler = enqueueWaveBrokerTicket(scheduler, {
      waveId,
      taskId,
      surfaceKind,
      surfaceFamily: surfaceKind === 'projection' ? 'atom-map' : 'cli',
      payloadDigest: `sha256:${surfaceKind}-${taskId}`,
      now
    }).document;
  }
}

const commitDecision = planWaveBrokerBatch({
  document: scheduler,
  waveId,
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: taskIds,
  now
});
const delivery = planSharedDeliveryCommit({
  decision: commitDecision,
  scheduler,
  actorId: 'checkpoint-captain',
  manifestDigest: 'sha256:manifest',
  sealedBaseSha: 'base-sha',
  currentHeadSha: 'head-sha',
  claimedTaskIds: taskIds,
  validatorTaskIds: taskIds,
  stagedFiles: ['packages/cli/src/commands/batch/implementation.ts'],
  temporaryIndexPath: path.join(os.tmpdir(), 'atm-checkpoint-index'),
  now
});
assert.equal(delivery.ok, true);

const build = makeGeneratedReceipt('build', 'cli', 'sha256:build');
const projection = makeGeneratedReceipt('projection', 'atom-map', 'sha256:projection');

const blocked = createAtomicWaveCheckpointReceipt({
  waveId,
  taskIds,
  manifestDigest: 'sha256:manifest',
  deliveryReceipts: [delivery.receipt!],
  buildReceipts: [build],
  projectionReceipts: [],
  now
});
assert.equal(blocked.ready, false);
assert.equal(blocked.schemaId, 'atm.atomicWaveCheckpointReceipt.v1');
assert.equal(blocked.evidenceReadback['ATM-GOV-A'].projection, 'missing');
assert.ok(blocked.treatment.uniqueBlock, 'blocked checkpoint must expose a stable uniqueBlock digest');
assert.deepEqual(blocked.treatment.missingSummary, ['ATM-GOV-A:projection', 'ATM-GOV-B:projection']);

const casConflict = createAtomicWaveCheckpointReceipt({
  waveId,
  taskIds,
  manifestDigest: 'sha256:manifest',
  deliveryReceipts: [delivery.receipt!],
  buildReceipts: [build],
  projectionReceipts: [projection],
  planningClosebackOk: false,
  now
});
assert.equal(casConflict.ready, false);
assert.equal(casConflict.planningCloseback.cas, 'conflict');
assert.equal(casConflict.planningCloseback.status, 'reconcile-required');
assert.equal(casConflict.treatment.readiness, 'blocked');

const ready = evaluateAtomicWaveCheckpoint({
  waveId,
  taskIds,
  manifestDigest: 'sha256:manifest',
  deliveryReceipts: [delivery.receipt!],
  buildReceipts: [build],
  projectionReceipts: [projection],
  now
});
assert.equal(ready.ready, true);

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-atomic-wave-checkpoint-'));
runGit(repo, ['init']);
runGit(repo, ['config', 'user.name', 'Fixture']);
runGit(repo, ['config', 'user.email', 'fixture@example.test']);
writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
runGit(repo, ['add', 'README.md']);
runGit(repo, ['commit', '-m', 'init']);
mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
writeFileSync(path.join(repo, '.atm', 'history', 'evidence', 'delivery.json'), `${JSON.stringify(delivery.receipt, null, 2)}\n`, 'utf8');
writeFileSync(path.join(repo, '.atm', 'history', 'evidence', 'build.json'), `${JSON.stringify(build, null, 2)}\n`, 'utf8');
writeFileSync(path.join(repo, '.atm', 'history', 'evidence', 'projection.json'), `${JSON.stringify(projection, null, 2)}\n`, 'utf8');

const cliReady = runCli([
  'batch',
  'checkpoint-readiness',
  '--cwd',
  repo,
  '--wave',
  waveId,
  '--manifest-digest',
  'sha256:manifest',
  '--task',
  'ATM-GOV-A',
  '--task',
  'ATM-GOV-B',
  '--delivery-receipt',
  '.atm/history/evidence/delivery.json',
  '--build-receipt',
  '.atm/history/evidence/build.json',
  '--projection-receipt',
  '.atm/history/evidence/projection.json',
  '--evidence-out',
  '.atm/history/evidence/checkpoint.json',
  '--json'
]);
assert.equal(cliReady.ok, true);
assert.equal(cliReady.evidence.receipt.schemaId, 'atm.atomicWaveCheckpointReceipt.v1');
assert.equal(cliReady.evidence.receiptPath, '.atm/history/evidence/checkpoint.json');
const written = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'evidence', 'checkpoint.json'), 'utf8'));
assert.equal(written.payloadDigest, cliReady.evidence.receipt.payloadDigest);
assert.equal(written.evidenceConsumed.totalReceiptCount, 3);

console.log('[atomic-wave-checkpoint-closeback-saga.test] ok');

function makeGeneratedReceipt(surfaceKind: 'build' | 'projection', surfaceFamily: string, outputDigest: string) {
  const decision = planWaveBrokerBatch({
    document: scheduler,
    waveId,
    surfaceKind,
    surfaceFamily,
    expectedTaskIds: taskIds,
    now
  });
  const plan = planWaveGeneratedWrite({
    decision,
    scheduler,
    actorId: 'checkpoint-captain',
    surfaceKind,
    surfaceFamily,
    manifestDigest: 'sha256:manifest',
    sealedSourceSha: 'base-sha',
    sourceDigest: 'sha256:source',
    outputDigest,
    expectedTaskIds: taskIds,
    now
  });
  assert.equal(plan.ok, true);
  return plan.receipt!;
}

function runCli(args: readonly string[]) {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'atm.dev.mjs'), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  assert.equal(result.status, 0, `${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

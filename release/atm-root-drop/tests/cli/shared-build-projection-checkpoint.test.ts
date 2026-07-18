import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';
import {
  evaluateAtomicWaveCheckpoint,
  fanOutWaveGeneratedReceipt,
  planWaveGeneratedWrite
} from '../../packages/core/src/broker/wave-generated-executor.ts';
import { planSharedDeliveryCommit } from '../../packages/core/src/broker/shared-delivery-commit.ts';

const now = '2026-07-18T00:00:00.000Z';
let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
for (const surfaceKind of ['commit', 'build', 'projection'] as const) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-generated',
    taskId: 'ATM-GOV-A',
    surfaceKind,
    surfaceFamily: surfaceKind === 'projection' ? 'atom-map' : 'cli',
    payloadDigest: `sha256:${surfaceKind}-a`,
    now
  }).document;
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-generated',
    taskId: 'ATM-GOV-B',
    surfaceKind,
    surfaceFamily: surfaceKind === 'projection' ? 'atom-map' : 'cli',
    payloadDigest: `sha256:${surfaceKind}-b`,
    now
  }).document;
}

const buildDecision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-generated',
  surfaceKind: 'build',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
assert.equal(buildDecision.verdict, 'batch-ready');

const buildPlan = planWaveGeneratedWrite({
  decision: buildDecision,
  scheduler,
  actorId: 'fixture-coordinator',
  surfaceKind: 'build',
  surfaceFamily: 'cli',
  manifestDigest: 'sha256:manifest',
  sealedSourceSha: 'base-sha',
  sourceDigest: 'sha256:source',
  outputDigest: 'sha256:build',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
assert.equal(buildPlan.ok, true);
assert.equal(buildPlan.receipt?.schemaId, 'atm.waveGeneratedWriteReceipt.v1');
assert.equal(buildPlan.receipt?.surfaceKind, 'build');
assert.deepEqual(fanOutWaveGeneratedReceipt(buildPlan.receipt!).map((entry) => entry.taskId), ['ATM-GOV-A', 'ATM-GOV-B']);

const projectionDecision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-generated',
  surfaceKind: 'projection',
  surfaceFamily: 'atom-map',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
const projectionPlan = planWaveGeneratedWrite({
  decision: projectionDecision,
  scheduler,
  actorId: 'fixture-coordinator',
  surfaceKind: 'projection',
  surfaceFamily: 'atom-map',
  manifestDigest: 'sha256:manifest',
  sealedSourceSha: 'base-sha',
  sourceDigest: 'sha256:source',
  outputDigest: 'sha256:projection',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
assert.equal(projectionPlan.ok, true);

const commitDecision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-generated',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
const commitPlan = planSharedDeliveryCommit({
  decision: commitDecision,
  scheduler,
  actorId: 'fixture-coordinator',
  manifestDigest: 'sha256:manifest',
  sealedBaseSha: 'base-sha',
  currentHeadSha: 'head-sha',
  claimedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  validatorTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  stagedFiles: ['packages/cli/src/commands/broker/parser.ts'],
  temporaryIndexPath: path.join(os.tmpdir(), 'atm-shared-index'),
  now
});
assert.equal(commitPlan.ok, true);

const blocked = evaluateAtomicWaveCheckpoint({
  waveId: 'wave-generated',
  taskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  manifestDigest: 'sha256:manifest',
  deliveryReceipts: [commitPlan.receipt!],
  buildReceipts: [buildPlan.receipt!],
  projectionReceipts: [],
  now
});
assert.equal(blocked.ready, false);
assert.deepEqual(blocked.missingByTask['ATM-GOV-A'], ['projection']);

const ready = evaluateAtomicWaveCheckpoint({
  waveId: 'wave-generated',
  taskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  manifestDigest: 'sha256:manifest',
  deliveryReceipts: [commitPlan.receipt!],
  buildReceipts: [buildPlan.receipt!],
  projectionReceipts: [projectionPlan.receipt!],
  now
});
assert.equal(ready.ready, true);

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-generated-checkpoint-cli-'));
runGit(repo, ['init']);
runGit(repo, ['config', 'user.name', 'Fixture']);
runGit(repo, ['config', 'user.email', 'fixture@example.test']);
writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
runGit(repo, ['add', 'README.md']);
runGit(repo, ['commit', '-m', 'init']);
mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });
mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
writeFileSync(path.join(repo, '.atm', 'runtime', 'wave-broker-scheduler.json'), `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8');
writeFileSync(path.join(repo, '.atm', 'history', 'evidence', 'shared-write.json'), `${JSON.stringify(commitPlan.receipt, null, 2)}\n`, 'utf8');
const head = runGit(repo, ['rev-parse', 'HEAD']).stdout.trim();

runCli([
  'broker',
  'batch',
  'execute',
  '--cwd',
  repo,
  '--actor',
  'fixture-coordinator',
  '--surface',
  'build',
  '--wave',
  'wave-generated',
  '--surface-family',
  'cli',
  '--expected-task',
  'ATM-GOV-A',
  '--expected-task',
  'ATM-GOV-B',
  '--manifest-digest',
  'sha256:manifest',
  '--sealed-source-sha',
  head,
  '--payload-digest',
  'sha256:source',
  '--receipt-digest',
  'sha256:build',
  '--evidence-out',
  '.atm/history/evidence/build.json',
  '--json'
]);
runCli([
  'broker',
  'batch',
  'execute',
  '--cwd',
  repo,
  '--actor',
  'fixture-coordinator',
  '--surface',
  'projection',
  '--wave',
  'wave-generated',
  '--surface-family',
  'atom-map',
  '--expected-task',
  'ATM-GOV-A',
  '--expected-task',
  'ATM-GOV-B',
  '--manifest-digest',
  'sha256:manifest',
  '--sealed-source-sha',
  head,
  '--payload-digest',
  'sha256:source',
  '--receipt-digest',
  'sha256:projection',
  '--evidence-out',
  '.atm/history/evidence/projection.json',
  '--json'
]);
const readiness = runCli([
  'batch',
  'checkpoint-readiness',
  '--cwd',
  repo,
  '--wave',
  'wave-generated',
  '--manifest-digest',
  'sha256:manifest',
  '--task',
  'ATM-GOV-A',
  '--task',
  'ATM-GOV-B',
  '--delivery-receipt',
  '.atm/history/evidence/shared-write.json',
  '--build-receipt',
  '.atm/history/evidence/build.json',
  '--projection-receipt',
  '.atm/history/evidence/projection.json',
  '--json'
]);
assert.equal(readiness.ok, true);
assert.equal(JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'evidence', 'build.json'), 'utf8')).schemaId, 'atm.waveGeneratedWriteReceipt.v1');

console.log('[shared-build-projection-checkpoint.test] ok');

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

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
import { planSharedDeliveryCommit } from '../../packages/core/src/broker/shared-delivery-commit.ts';

const now = '2026-07-18T00:00:00.000Z';
let scheduler = createEmptyWaveBrokerSchedulerDocument(now);
scheduler = enqueueWaveBrokerTicket(scheduler, {
  waveId: 'wave-commit',
  taskId: 'ATM-GOV-A',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  payloadDigest: 'sha256:a',
  now
}).document;
scheduler = enqueueWaveBrokerTicket(scheduler, {
  waveId: 'wave-commit',
  taskId: 'ATM-GOV-B',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  payloadDigest: 'sha256:b',
  now
}).document;

const decision = planWaveBrokerBatch({
  document: scheduler,
  waveId: 'wave-commit',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  now
});
assert.equal(decision.verdict, 'batch-ready');

const ready = planSharedDeliveryCommit({
  decision,
  scheduler,
  actorId: 'fixture-coordinator',
  manifestDigest: 'sha256:manifest',
  sealedBaseSha: 'base-sha',
  currentHeadSha: 'head-sha',
  expectedHeadSha: 'head-sha',
  claimedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  validatorTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
  stagedFiles: ['packages/cli/src/commands/broker/parser.ts'],
  fileSlices: {
    'ATM-GOV-A': ['packages/cli/src/commands/broker/parser.ts'],
    'ATM-GOV-B': ['packages/cli/src/commands/broker/implementation.ts']
  },
  temporaryIndexPath: path.join(os.tmpdir(), 'atm-shared-index'),
  now
});
assert.equal(ready.ok, true);
assert.equal(ready.receipt?.schemaId, 'atm.sharedWriteReceipt.v1');
assert.equal(ready.receipt?.waveId, 'wave-commit');
assert.deepEqual(ready.receipt?.taskIds, ['ATM-GOV-A', 'ATM-GOV-B']);
assert.equal(ready.receipt?.temporaryIndexIsolated, true);
assert.match(String(ready.receipt?.payloadDigest), /^sha256:[a-f0-9]{64}$/);

const unrelated = planSharedDeliveryCommit({
  ...readyInput(),
  fileSlices: {
    'ATM-GOV-A': ['a.txt'],
    'ATM-GOV-B': ['b.txt'],
    'ATM-GOV-Z': ['z.txt']
  }
});
assert.equal(unrelated.ok, false);
assert.match(unrelated.blockers.join('\n'), /unrelated task slices/);

const staleHead = planSharedDeliveryCommit({ ...readyInput(), currentHeadSha: 'new-head', expectedHeadSha: 'old-head' });
assert.equal(staleHead.ok, false);
assert.match(staleHead.blockers.join('\n'), /current HEAD/);

const missingValidator = planSharedDeliveryCommit({ ...readyInput(), validatorTaskIds: ['ATM-GOV-A'] });
assert.equal(missingValidator.ok, false);
assert.match(missingValidator.blockers.join('\n'), /ATM-GOV-B has no validator evidence/);

const serial = planSharedDeliveryCommit({
  ...readyInput(),
  decision: planWaveBrokerBatch({ document: scheduler, waveId: 'wave-commit', surfaceKind: 'commit', surfaceFamily: 'cli', expectedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B', 'ATM-GOV-C'], collectionTimeoutMs: 0, now: '2026-07-18T00:03:00.000Z' })
});
assert.equal(serial.verdict, 'serial-fallback');

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-shared-delivery-cli-'));
runGit(repo, ['init']);
runGit(repo, ['config', 'user.name', 'Fixture']);
runGit(repo, ['config', 'user.email', 'fixture@example.test']);
writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
runGit(repo, ['add', 'README.md']);
runGit(repo, ['commit', '-m', 'init']);
mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });
writeFileSync(path.join(repo, '.atm', 'runtime', 'wave-broker-scheduler.json'), `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8');
const head = runGit(repo, ['rev-parse', 'HEAD']).stdout.trim();
const cli = spawnSync(process.execPath, [
  path.join(process.cwd(), 'atm.dev.mjs'),
  'broker',
  'batch',
  'execute',
  '--cwd',
  repo,
  '--actor',
  'fixture-coordinator',
  '--surface',
  'commit',
  '--wave',
  'wave-commit',
  '--surface-family',
  'cli',
  '--expected-task',
  'ATM-GOV-A',
  '--expected-task',
  'ATM-GOV-B',
  '--claimed-task',
  'ATM-GOV-A',
  '--claimed-task',
  'ATM-GOV-B',
  '--validator-task',
  'ATM-GOV-A',
  '--validator-task',
  'ATM-GOV-B',
  '--scope-file',
  'README.md',
  '--manifest-digest',
  'sha256:manifest',
  '--sealed-source-sha',
  head,
  '--current-head',
  head,
  '--expected-head',
  head,
  '--evidence-out',
  '.atm/history/evidence/shared-write.json',
  '--json'
], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const parsed = JSON.parse(cli.stdout);
assert.equal(parsed.ok, true);
const receipt = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'evidence', 'shared-write.json'), 'utf8'));
assert.equal(receipt.schemaId, 'atm.sharedWriteReceipt.v1');
assert.equal(receipt.commitSha, null);

console.log('[shared-delivery-commit-executor:test] ok');

function readyInput() {
  return {
    decision,
    scheduler,
    actorId: 'fixture-coordinator',
    manifestDigest: 'sha256:manifest',
    sealedBaseSha: 'base-sha',
    currentHeadSha: 'head-sha',
    expectedHeadSha: 'head-sha',
    claimedTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
    validatorTaskIds: ['ATM-GOV-A', 'ATM-GOV-B'],
    stagedFiles: ['a.txt', 'b.txt'],
    fileSlices: {
      'ATM-GOV-A': ['a.txt'],
      'ATM-GOV-B': ['b.txt']
    },
    temporaryIndexPath: path.join(os.tmpdir(), 'atm-shared-index'),
    now
  };
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

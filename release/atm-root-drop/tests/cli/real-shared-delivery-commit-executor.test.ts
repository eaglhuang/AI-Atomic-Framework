import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-real-shared-delivery-'));
runGit(['init']);
runGit(['config', 'user.name', 'Fixture']);
runGit(['config', 'user.email', 'fixture@example.test']);
writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
writeFileSync(path.join(repo, 'foreign.txt'), 'base foreign\n', 'utf8');
runGit(['add', 'README.md', 'foreign.txt']);
runGit(['commit', '-m', 'init']);

const base = runGit(['rev-parse', 'HEAD']).stdout.trim();
writeFileSync(path.join(repo, 'README.md'), 'shared delivery payload\n', 'utf8');
writeFileSync(path.join(repo, 'foreign.txt'), 'foreign staged by another lane\n', 'utf8');
runGit(['add', 'foreign.txt']);

mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });
let scheduler = createEmptyWaveBrokerSchedulerDocument('2026-07-19T00:00:00.000Z');
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-commit',
    taskId,
    surfaceKind: 'commit',
    surfaceFamily: 'cli',
    payloadDigest: `sha256:${taskId.toLowerCase()}`,
    now: '2026-07-19T00:00:00.000Z'
  }).document;
}
writeFileSync(path.join(repo, '.atm', 'runtime', 'wave-broker-scheduler.json'), `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8');

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
  '--file-slice',
  'ATM-GOV-A:README.md',
  '--file-slice',
  'ATM-GOV-B:README.md',
  '--manifest-digest',
  'sha256:manifest',
  '--sealed-source-sha',
  base,
  '--expected-head',
  base,
  '--evidence-out',
  '.atm/history/evidence/shared-write.json',
  '--apply',
  '--json'
], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });

assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const parsed = JSON.parse(cli.stdout);
assert.equal(parsed.ok, true);
assert.equal(parsed.evidence.saga.schemaId, 'atm.sharedDeliverySagaPlan.v1');
assert.equal(parsed.evidence.saga.receipt.recoveryAction, 'none');
assert.equal(parsed.evidence.saga.receipt.exactlyOnce, true);
assert.equal(parsed.evidence.payloadAssertion.expectedStagedFiles.includes('README.md'), true);

const receipt = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'evidence', 'shared-write.json'), 'utf8'));
assert.equal(receipt.schemaId, 'atm.sharedWriteReceipt.v1');
assert.match(receipt.commitSha, /^[a-f0-9]{40}$/);
assert.equal(receipt.temporaryIndexIsolated, true);
assert.equal(receipt.payloadAssertion.status, 'passed');
assert.equal(receipt.telemetry.schemaId, 'atm.sharedDeliveryTreatmentTelemetry.v1');
assert.equal(receipt.telemetry.parallelAdmissionAttempted, true);
assert.equal(receipt.telemetry.composeDecision, 'compose');
assert.equal(receipt.telemetry.finalDisposition, 'committed');

const committedFiles = runGit(['show', '--name-only', '--pretty=format:', receipt.commitSha]).stdout;
assert.match(committedFiles, /README\.md/);
assert.doesNotMatch(committedFiles, /foreign\.txt/, 'temporary-index commit must not absorb foreign staged files');
assert.match(runGit(['diff', '--cached', '--name-only']).stdout, /foreign\.txt/, 'foreign staged file remains in the live index');

console.log('[real-shared-delivery-commit-executor:test] ok');

function runGit(args: readonly string[]) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

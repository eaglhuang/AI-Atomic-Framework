import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-real-generated-executor-'));
runGit(repo, ['init']);
runGit(repo, ['config', 'user.name', 'Fixture']);
runGit(repo, ['config', 'user.email', 'fixture@example.test']);
writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
runGit(repo, ['add', 'README.md']);
runGit(repo, ['commit', '-m', 'init']);
const head = runGit(repo, ['rev-parse', 'HEAD']).stdout.trim();

mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });
mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
mkdirSync(path.join(repo, 'generated'), { recursive: true });

let scheduler = createEmptyWaveBrokerSchedulerDocument('2026-07-19T00:00:00.000Z');
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-real-generated',
    taskId,
    surfaceKind: 'build',
    surfaceFamily: 'cli',
    payloadDigest: `sha256:${taskId.toLowerCase()}`,
    now: '2026-07-19T00:00:00.000Z'
  }).document;
}
writeFileSync(path.join(repo, '.atm', 'runtime', 'wave-broker-scheduler.json'), `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8');

const outputRelativePath = 'generated/build-output.txt';
const receiptRelativePath = '.atm/history/evidence/build.json';
const shellNode = JSON.stringify(process.execPath);
const command = [
  shellNode,
  '-e',
  JSON.stringify("require('fs').writeFileSync('generated/build-output.txt','built from command\\n','utf8')")
].join(' ');
const ok = runCli([
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
  'wave-real-generated',
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
  '--run-command',
  command,
  '--output-file',
  outputRelativePath,
  '--evidence-out',
  receiptRelativePath,
  '--apply',
  '--json'
]);
assert.equal(ok.ok, true);
assert.equal(existsSync(path.join(repo, outputRelativePath)), true, 'generated command must create the observed output');
assert.equal(existsSync(path.join(repo, receiptRelativePath)), true, 'successful generated command must write receipt');
const receipt = JSON.parse(readFileSync(path.join(repo, receiptRelativePath), 'utf8'));
assert.equal(receipt.schemaId, 'atm.waveGeneratedWriteReceipt.v1');
assert.equal(receipt.surfaceKind, 'build');
assert.equal(receipt.command, command);
assert.equal(receipt.commandExitCode, 0);
assert.equal(receipt.telemetry.schemaId, 'atm.generatedWriteTreatmentTelemetry.v1');
assert.equal(receipt.telemetry.executionMode, 'command-executed');
assert.equal(receipt.telemetry.commandExecuted, true);
assert.equal(receipt.telemetry.outputObserved, true);
assert.equal(receipt.telemetry.receiptValidity, 'valid');
assert.equal(typeof receipt.telemetry.phaseTimingsMs.totalElapsed, 'number');
assert.equal(receipt.telemetry.outputFileCount, 1);
assert.equal(typeof receipt.phaseTimingsMs.command, 'number');
assert.deepEqual(receipt.observedOutputFiles, [outputRelativePath]);
assert.match(receipt.outputDigest, /^sha256:[a-f0-9]{64}$/);
assert.notEqual(receipt.outputDigest, 'sha256:source', 'output digest must be observed from generated output, not copied from source input');

const failedReceiptRelativePath = '.atm/history/evidence/failed-build.json';
const failed = spawnSync(process.execPath, [
  path.join(process.cwd(), 'atm.dev.mjs'),
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
  'wave-real-generated',
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
  '--run-command',
  `${shellNode} -e "process.exit(7)"`,
  '--output-file',
  'generated/failed-output.txt',
  '--evidence-out',
  failedReceiptRelativePath,
  '--apply',
  '--json'
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 10
});
assert.notEqual(failed.status, 0, 'failed generated command must fail broker execution');
assert.match(`${failed.stdout}\n${failed.stderr}`, /ATM_BROKER_BATCH_GENERATED_BLOCKED/);
assert.equal(existsSync(path.join(repo, failedReceiptRelativePath)), false, 'failed command must not write a success receipt');

console.log('[real-build-projection-runner-sync-executor.test] ok');

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

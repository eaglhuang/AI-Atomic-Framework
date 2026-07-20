import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-generated-write-manifest-'));
mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });
let scheduler = createEmptyWaveBrokerSchedulerDocument('2026-07-20T00:00:00.000Z');
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-generated',
    taskId,
    surfaceKind: 'projection',
    surfaceFamily: 'skills',
    payloadDigest: `sha256:${taskId === 'ATM-GOV-A' ? 'a'.repeat(64) : 'd'.repeat(64)}`,
    now: '2026-07-20T00:00:00.000Z'
  }).document;
}
writeFileSync(path.join(repo, '.atm', 'runtime', 'wave-broker-scheduler.json'), `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8');

writeFileSync(path.join(repo, 'ok-manifest.json'), `${JSON.stringify({
  schemaId: 'atm.commandManifest.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'command manifest baseline' },
  executable: process.execPath,
  argv: ['-e', "require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/generated.json', JSON.stringify({ok:true})+'\\n')"],
  timeoutMs: 30000
}, null, 2)}\n`, 'utf8');
writeFileSync(path.join(repo, 'fail-manifest.json'), `${JSON.stringify({
  schemaId: 'atm.commandManifest.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'command manifest baseline' },
  executable: process.execPath,
  argv: ['-e', 'process.exit(7)'],
  timeoutMs: 30000
}, null, 2)}\n`, 'utf8');

const failedReceipt = '.atm/history/evidence/failed-generated.json';
const failed = runCli(['--command-manifest', 'fail-manifest.json', '--evidence-out', failedReceipt]);
assert.notEqual(failed.status, 0);
assert.equal(existsSync(path.join(repo, failedReceipt)), false, 'failed generated write must not emit success receipt');

const successReceipt = '.atm/history/evidence/generated.json';
const success = runCli(['--command-manifest', 'ok-manifest.json', '--evidence-out', successReceipt]);
assert.equal(success.status, 0, success.stderr || success.stdout);
const parsed = JSON.parse(success.stdout);
assert.equal(parsed.ok, true);
const receipt = JSON.parse(readFileSync(path.join(repo, successReceipt), 'utf8'));
assert.equal(receipt.outputDigest, digestOutputFiles(['out/generated.json']));
assert.equal(parsed.evidence.plan.receipt.outputDigest, receipt.outputDigest);

console.log('[generated-write-manifest:test] ok');

function runCli(extra: readonly string[]) {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'atm.dev.mjs'),
    'broker', 'batch', 'execute',
    '--cwd', repo,
    '--actor', 'fixture',
    '--surface', 'projection',
    '--wave', 'wave-generated',
    '--surface-family', 'skills',
    '--expected-task', 'ATM-GOV-A',
    '--expected-task', 'ATM-GOV-B',
    '--manifest-digest', `sha256:${'b'.repeat(64)}`,
    '--sealed-source-sha', '0123456789012345678901234567890123456789',
    '--payload-digest', `sha256:${'c'.repeat(64)}`,
    '--output-file', 'out/generated.json',
    '--apply',
    '--json',
    ...extra
  ], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
}

function digestOutputFiles(files: readonly string[]) {
  const hash = createHash('sha256');
  for (const relative of [...files].sort()) {
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(path.join(repo, relative)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

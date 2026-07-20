import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-command-manifest-'));
mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });

let scheduler = createEmptyWaveBrokerSchedulerDocument('2026-07-20T00:00:00.000Z');
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  scheduler = enqueueWaveBrokerTicket(scheduler, {
    waveId: 'wave-generated',
    taskId,
    surfaceKind: 'build',
    surfaceFamily: 'cli',
    payloadDigest: `sha256:${taskId === 'ATM-GOV-A' ? '1'.repeat(64) : '5'.repeat(64)}`,
    now: '2026-07-20T00:00:00.000Z'
  }).document;
}
writeFileSync(path.join(repo, '.atm', 'runtime', 'wave-broker-scheduler.json'), `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8');

const outputFile = 'generated-output.txt';
const manifest = {
  schemaId: 'atm.commandManifest.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'command manifest baseline' },
  executable: process.execPath,
  argv: ['-e', `require('fs').writeFileSync(${JSON.stringify(outputFile)},'ok\\n')`],
  cwd: '.',
  envRefs: ['PATH'],
  timeoutMs: 30000,
  stdinSha256: `sha256:${'0'.repeat(64)}`,
  ioDigest: `sha256:${'2'.repeat(64)}`
};
writeFileSync(path.join(repo, 'command-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const rejected = runCli([
  '--run-command', 'echo shell',
  '--output-file', outputFile,
  '--apply',
  '--json'
]);
assert.notEqual(rejected.status, 0);
assert.match(rejected.stdout + rejected.stderr, /ATM_COMMAND_MANIFEST_REQUIRED/);

const accepted = runCli([
  '--command-manifest', 'command-manifest.json',
  '--output-file', outputFile,
  '--evidence-out', '.atm/history/evidence/generated.json',
  '--apply',
  '--json'
]);
assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
const parsed = JSON.parse(accepted.stdout);
assert.equal(parsed.ok, true);
assert.equal(existsSync(path.join(repo, outputFile)), true);
assert.equal(parsed.messages.some((entry: any) => entry.code === 'ATM_RUN_COMMAND_DEPRECATED'), false);
assert.match(readFileSync(path.join(repo, '.atm/history/evidence/generated.json'), 'utf8'), /atm.waveGeneratedWriteReceipt.v1/);

const invalidManifestPath = path.join(repo, 'bad-manifest.json');
writeFileSync(invalidManifestPath, `${JSON.stringify({ ...manifest, shell: true })}\n`, 'utf8');
const invalid = runCli([
  '--command-manifest', 'bad-manifest.json',
  '--output-file', outputFile,
  '--apply',
  '--json'
]);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stdout + invalid.stderr, /ATM_COMMAND_MANIFEST_SHELL_FORBIDDEN/);

const hash = createHash('sha256').update(readFileSync(path.join(repo, outputFile))).digest('hex');
assert.match(`sha256:${hash}`, /^sha256:[a-f0-9]{64}$/);
console.log('[command-manifest-shellless:test] ok');

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, [path.join(process.cwd(), 'atm.dev.mjs'),
    'broker', 'batch', 'execute',
    '--cwd', repo,
    '--actor', 'fixture',
    '--surface', 'build',
    '--wave', 'wave-generated',
    '--surface-family', 'cli',
    '--expected-task', 'ATM-GOV-A',
    '--expected-task', 'ATM-GOV-B',
    '--manifest-digest', `sha256:${'3'.repeat(64)}`,
    '--sealed-source-sha', '0123456789012345678901234567890123456789',
    '--payload-digest', `sha256:${'4'.repeat(64)}`,
    ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
}

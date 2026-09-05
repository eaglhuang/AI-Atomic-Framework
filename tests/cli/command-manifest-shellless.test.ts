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
import { issueWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';

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
mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
for (const taskId of ['ATM-GOV-A', 'ATM-GOV-B']) {
  const ticket = issueWorkAdmissionTicket({
    taskId,
    actorId: 'fixture',
    laneSessionId: 'wave-generated',
    claimGeneration: 'wave-generated',
    allowedFiles: [outputFile],
    runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: new Date().toISOString() }
  });
  writeFileSync(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({ taskId, workAdmissionTicket: ticket }, null, 2)}\n`, 'utf8');
}

// A generated write is a declared build script with an observable output
// contract, not an inline program handed to an interpreter.
mkdirSync(path.join(repo, 'tools'), { recursive: true });
writeFileSync(
  path.join(repo, 'tools', 'emit-generated-output.mjs'),
  `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(outputFile)}, 'ok\\n');\n`,
  'utf8'
);

const baseManifest = {
  schemaId: 'atm.commandManifest.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'command manifest baseline' },
  executable: process.execPath,
  cwd: '.',
  envRefs: ['PATH'],
  timeoutMs: 30000,
  stdinSha256: `sha256:${'0'.repeat(64)}`,
  ioDigest: `sha256:${'2'.repeat(64)}`
};

writeJson('command-manifest.json', { ...baseManifest, argv: ['tools/emit-generated-output.mjs'] });

// Regression for the loophole this task closes: a shell-less `node -e`
// filesystem write used to be a *positive* fixture here. It must now fail
// closed before the process is launched.
writeJson('eval-manifest.json', {
  ...baseManifest,
  argv: ['-e', `require('fs').writeFileSync(${JSON.stringify('eval-output.txt')},'ok\\n')`]
});
writeJson('eval-equals-manifest.json', { ...baseManifest, argv: [`--eval=require('fs').writeFileSync('eval-output.txt','ok')`] });

const rejectedShellString = runCli(['--run-command', 'echo shell', '--output-file', outputFile, '--apply', '--json']);
assert.notEqual(rejectedShellString.status, 0);
assert.match(rejectedShellString.stdout + rejectedShellString.stderr, /ATM_COMMAND_MANIFEST_REQUIRED/);

// The deprecated queue-only compatibility path is no longer a generic shell
// fallback: it crosses the same gateway allowlist.
const rejectedQueueOnlyFallback = runCli([
  '--run-command', 'echo shell',
  '--fallback-mode', 'queue-only',
  '--output-file', outputFile,
  '--apply',
  '--json'
]);
assert.notEqual(rejectedQueueOnlyFallback.status, 0, 'queue-only compatibility must not reopen a generic shell fallback');
assert.match(rejectedQueueOnlyFallback.stdout + rejectedQueueOnlyFallback.stderr, /ATM_RESTRICTED_EXECUTION_BLOCKED/);
assert.match(rejectedQueueOnlyFallback.stdout + rejectedQueueOnlyFallback.stderr, /executable-not-allowlisted/);

for (const manifestName of ['eval-manifest.json', 'eval-equals-manifest.json']) {
  const rejectedEval = runCli(['--command-manifest', manifestName, '--output-file', outputFile, '--apply', '--json']);
  assert.notEqual(rejectedEval.status, 0, `${manifestName} must be denied before execution`);
  const combined = rejectedEval.stdout + rejectedEval.stderr;
  assert.match(combined, /ATM_RESTRICTED_EXECUTION_BLOCKED/);
  assert.match(combined, /interpreter-evaluation/);
  assert.match(combined, /node atm\.mjs/, 'a denial must name an ATM recovery command');
  assert.equal(existsSync(path.join(repo, 'eval-output.txt')), false, 'a denied manifest must never launch its process');
}

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
assert.equal(parsed.evidence.restrictedExecutionReceipt?.schemaId, 'atm.restrictedExecutionReceipt.v1');
assert.equal(parsed.evidence.restrictedExecutionReceipt?.decision, 'allow');
assert.equal(parsed.evidence.restrictedExecutionReceipt?.reasonCode, 'declared-generated-write-command');
assert.deepEqual(parsed.evidence.restrictedExecutionReceipt?.declaredOutputs, [outputFile]);
assert.match(readFileSync(path.join(repo, '.atm/history/evidence/generated.json'), 'utf8'), /atm.waveGeneratedWriteReceipt.v1/);

writeJson('bad-manifest.json', { ...baseManifest, argv: ['tools/emit-generated-output.mjs'], shell: true });
const invalid = runCli(['--command-manifest', 'bad-manifest.json', '--output-file', outputFile, '--apply', '--json']);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stdout + invalid.stderr, /ATM_COMMAND_MANIFEST_SHELL_FORBIDDEN/);

const hash = createHash('sha256').update(readFileSync(path.join(repo, outputFile))).digest('hex');
assert.match(`sha256:${hash}`, /^sha256:[a-f0-9]{64}$/);
console.log('[command-manifest-shellless:test] ok');

function writeJson(relativePath: string, value: unknown) {
  writeFileSync(path.join(repo, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

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

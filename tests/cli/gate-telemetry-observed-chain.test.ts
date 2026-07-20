import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-gate-telemetry-observed-chain-'));

try {
  const observed = runAtm([
    'telemetry',
    '--cwd',
    tmp,
    '--emit-fixture',
    '--task',
    'ATM-GOV-0196',
    '--gate',
    'taskflow',
    '--check-id',
    'taskflow.close-readiness',
    '--result',
    'pass',
    '--reason',
    'observed-seal-consume-chain',
    '--duration-ms',
    '11',
    '--actor',
    'test-actor',
    '--run-id',
    'run-observed-chain',
    '--lane-session-id',
    'lane-observed-chain',
    '--batch-id',
    'batch-observed-chain',
    '--wave-id',
    'wave-observed-chain',
    '--correlation-id',
    'corr-observed-chain',
    '--evidence-read-ref',
    '.atm/history/evidence/ATM-GOV-0196.seal-and-commit.json',
    '--json'
  ]);
  assert.equal(observed.status, 0, observed.combined);
  const observedJson = JSON.parse(observed.stdout);
  assert.equal(observedJson.evidence.ok, true);
  assert.match(observedJson.evidence.path, /[\\/]\.atm[\\/]runtime[\\/]telemetry[\\/]gate-events[\\/]/);

  const sealed = runAtm(['telemetry', '--cwd', tmp, '--seal', '--task', 'ATM-GOV-0196', '--window', 'observed-chain', '--json']);
  assert.equal(sealed.status, 0, sealed.combined);
  const sealedJson = JSON.parse(sealed.stdout);
  assert.equal(sealedJson.evidence.schemaId, 'atm.gateTelemetrySealDigest.v1');
  assert.equal(sealedJson.evidence.taskId, 'ATM-GOV-0196');
  assert.equal(sealedJson.evidence.eventCount, 1);
  assert.ok(sealedJson.evidence.historyDigest.startsWith('sha256:'));
  assert.ok(sealedJson.evidence.rawEventDigest.startsWith('sha256:'));
  assert.deepEqual(sealedJson.evidence.correlation.laneSessionIds, ['lane-observed-chain']);
  assert.equal(sealedJson.evidence.evidenceReadbacks, 1);

  const compactText = readFileSync(path.join(tmp, sealedJson.evidence.historyPath), 'utf8');
  assert.match(compactText, /"evidenceReadbacks": 1/);
  assert.match(compactText, /"lane-observed-chain"/);
  assert.doesNotMatch(compactText, /"evidenceReadRef":"\.atm\/history\/evidence\/ATM-GOV-0196\.seal-and-commit\.json"/);

  const summary = runAtm(['telemetry', '--cwd', tmp, '--task-summary', '--task', 'ATM-GOV-0196', '--role', 'treatment', '--json']);
  assert.equal(summary.status, 0, summary.combined);
  const summaryJson = JSON.parse(summary.stdout);
  assert.equal(summaryJson.evidence.schemaId, 'atm.gateTelemetryTaskSummary.v1');
  assert.equal(summaryJson.evidence.taskId, 'ATM-GOV-0196');
  assert.deepEqual(summaryJson.evidence.correlation.runIds, ['run-observed-chain']);
  assert.deepEqual(summaryJson.evidence.correlation.laneSessionIds, ['lane-observed-chain']);
  assert.deepEqual(summaryJson.evidence.correlation.batchIds, ['batch-observed-chain']);
  assert.deepEqual(summaryJson.evidence.correlation.waveIds, ['wave-observed-chain']);
  assert.equal(summaryJson.evidence.gateEvents['taskflow.close-readiness'].eligible, 1);
  assert.equal(summaryJson.evidence.gateEvents['taskflow.close-readiness'].resultCounts.pass, 1);
  assert.equal(summaryJson.evidence.gateEvents['taskflow.close-readiness'].evidenceReadbacks, 1);
  assert.equal(summaryJson.evidence.evidenceReadbacks, 1);
  assert.ok(summaryJson.evidence.historyDigest.startsWith('sha256:'));
  assert.ok(summaryJson.evidence.configDigest.startsWith('sha256:'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - tests/cli/gate-telemetry-observed-chain.test.ts');

function runAtm(args: readonly string[]): { status: number | null; stdout: string; stderr: string; combined: string } {
  const result = spawnSync(process.execPath, ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    env: { ...process.env, NO_COLOR: '1' }
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    combined: `${result.stdout ?? ''}\n--- STDERR ---\n${result.stderr ?? ''}`
  };
}

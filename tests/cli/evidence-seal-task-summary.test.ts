import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-seal-summary-'));

try {
  const taskId = 'ATM-GOV-0221';
  const fixture = runAtm([
    'telemetry',
    '--cwd',
    tmp,
    '--emit-fixture',
    '--task',
    taskId,
    '--gate',
    'evidence',
    '--check-id',
    'taskflow.close-readiness',
    '--result',
    'pass',
    '--duration-ms',
    '11',
    '--actor',
    'test-actor',
    '--run-id',
    'run-summary',
    '--lane-session-id',
    'lane-summary',
    '--evidence-read-ref',
    'evidence:test-readback',
    '--json'
  ]);
  assert.equal(fixture.status, 0, fixture.combined);

  const seal = runAtm(['telemetry', '--cwd', tmp, '--seal', '--task', taskId, '--window', 'summary-window', '--json']);
  assert.equal(seal.status, 0, seal.combined);
  const sealJson = JSON.parse(seal.stdout);
  assert.equal(sealJson.evidence.sourceAvailability, 'available');
  assert.match(sealJson.evidence.historyDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(sealJson.evidence.rawEventDigest, /^sha256:[a-f0-9]{64}$/);

  const summary = runAtm(['telemetry', '--cwd', tmp, '--task-summary', '--task', taskId, '--role', 'm2-preflight', '--json']);
  assert.equal(summary.status, 0, summary.combined);
  const summaryJson = JSON.parse(summary.stdout);
  assert.equal(summaryJson.evidence.schemaId, 'atm.gateTelemetryTaskSummary.v1');
  assert.equal(summaryJson.evidence.window.watermark, null);
  assert.deepEqual(summaryJson.evidence.correlation.runIds, ['run-summary']);
  assert.equal(summaryJson.evidence.evidenceReadbacks, 1);
  assert.equal(summaryJson.evidence.baselineOrTreatmentRole, 'm2-preflight');
  assert.match(summaryJson.evidence.inputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(summaryJson.evidence.sealedDigest, /^sha256:[a-f0-9]{64}$/);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - tests/cli/evidence-seal-task-summary.test.ts');

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

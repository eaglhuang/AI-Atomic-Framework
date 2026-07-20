import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-gate-telemetry-coverage-'));

try {
  const coverage = runAtm(['telemetry', '--cwd', tmp, '--coverage-report', '--json']);
  assert.equal(coverage.status, 0, coverage.combined);
  const coverageJson = JSON.parse(coverage.stdout);
  assert.equal(coverageJson.evidence.schemaId, 'atm.gateTelemetryRegistryCoverageReport.v1');
  assert.equal(coverageJson.evidence.rawDataPolicy.runtimeStorage, '.atm/runtime/telemetry/**');
  assert.equal(coverageJson.evidence.rawDataPolicy.rawTelemetryCommitted, false);
  assert.equal(coverageJson.evidence.m2PreflightVerdict, 'inconclusive');

  const families = coverageJson.evidence.requiredNodes.map((node: { nodeFamily: string }) => node.nodeFamily);
  assert.ok(families.includes('claim/reservation/lane presence'));
  assert.ok(families.includes('validator queue/execution/cache/fan-out'));
  assert.ok(families.includes('git governance/pre-commit/pre-push/branch queue'));
  assert.ok(families.includes('telemetry seal/report/self-health'));

  const validator = coverageJson.evidence.requiredNodes.find((node: { nodeFamily: string }) => node.nodeFamily === 'validator queue/execution/cache/fan-out');
  assert.equal(validator.coverageStatus, 'not-yet-covered');
  assert.equal(validator.sourceAvailability, 'partial');
  assert.ok(validator.missingTelemetry.includes('validatorId'));

  const preflight = runAtm(['telemetry', '--cwd', tmp, '--m2-preflight', '--json']);
  assert.equal(preflight.status, 0, preflight.combined);
  const preflightJson = JSON.parse(preflight.stdout);
  assert.equal(preflightJson.evidence.schemaId, 'atm.gateTelemetryRegistryCoverageReport.v1');
  assert.equal(preflightJson.evidence.m2PreflightVerdict, 'inconclusive');

  const taskSummary = runAtm(['telemetry', '--cwd', tmp, '--task-summary', '--task', 'ATM-GOV-0195', '--role', 'm2-preflight', '--json']);
  assert.equal(taskSummary.status, 0, taskSummary.combined);
  const taskSummaryJson = JSON.parse(taskSummary.stdout);
  assert.equal(taskSummaryJson.evidence.schemaId, 'atm.gateTelemetryTaskSummary.v1');
  assert.equal(taskSummaryJson.evidence.taskId, 'ATM-GOV-0195');
  assert.equal(taskSummaryJson.evidence.baselineOrTreatmentRole, 'm2-preflight');
  assert.equal(taskSummaryJson.evidence.sourceAvailability, 'partial');
  assert.ok(taskSummaryJson.evidence.configDigest.startsWith('sha256:'));
  assert.ok(taskSummaryJson.evidence.historyDigest.startsWith('sha256:'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - tests/cli/gate-telemetry-coverage-repair.test.ts');

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

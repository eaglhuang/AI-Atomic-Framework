import assert from 'node:assert/strict';
import { buildGateTelemetryRegistryCoverageReport } from '../packages/core/src/telemetry/index.ts';

const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';
const report = buildGateTelemetryRegistryCoverageReport(process.cwd());

assert.equal(report.schemaId, 'atm.gateTelemetryRegistryCoverageReport.v1');
assert.ok(report.configDigest.startsWith('sha256:'));
assert.ok(report.historyDigest.startsWith('sha256:'));
assert.equal(report.rawDataPolicy.runtimeStorage, '.atm/runtime/telemetry/**');
assert.equal(report.rawDataPolicy.trackedEvidence, 'compact-digest-only');
assert.equal(report.rawDataPolicy.rawTelemetryCommitted, false);

const requiredFamilies = [
  'claim/reservation/lane presence',
  'next/preflight/guard/doctor',
  'validator queue/execution/cache/fan-out',
  'task import/task close/taskflow close/checkpoint',
  'evidence seal/readback/handoff',
  'git governance/pre-commit/pre-push/branch queue',
  'runner-sync/release mirror/generated projection',
  'batch/broker/team/worker lifecycle',
  'telemetry seal/report/self-health'
];

for (const family of requiredFamilies) {
  const node = report.requiredNodes.find((entry) => entry.nodeFamily === family);
  assert.ok(node, `missing required node family: ${family}`);
  assert.ok(['instrumented', 'read-only-summary', 'out-of-scope', 'not-yet-covered'].includes(node.coverageStatus));
  assert.ok(['available', 'unavailable', 'partial'].includes(node.sourceAvailability));
  assert.ok(node.requiredCorrelationKeys.includes('runId'));
  assert.ok(node.requiredCorrelationKeys.includes('taskId'));
}

const incompleteNodes = report.requiredNodes.filter((node) => !node.m2Comparable);
if (incompleteNodes.length > 0) {
  assert.equal(report.m2PreflightVerdict, 'inconclusive');
} else {
  assert.equal(report.m2PreflightVerdict, 'ready');
}

if (mode === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`ok - gate telemetry coverage report (${report.m2PreflightVerdict})`);
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-dashboard-consumption.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32DashboardConsumptionValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.consumedPlanId, '3.2');
// Row counts follow the plan as it progresses. What must hold is the
// arithmetic and the readiness rule the receipt exists to enforce.
for (const key of ['observedRows', 'verified', 'notComplete'] as const) {
  assert.ok(Number.isInteger(receipt[key]) && receipt[key] >= 0, `${key} must be a count`);
}
assert.equal(receipt.verified + receipt.notComplete, receipt.observedRows, 'verified and not-complete must partition the observed rows');
// Readiness follows the verdict, which also weighs findings, so zero
// incomplete rows is necessary but not sufficient.
assert.ok(['ready', 'not-ready'].includes(receipt.dashboardStatus), `unexpected dashboard status ${receipt.dashboardStatus}`);
assert.equal(receipt.wholeDashboardReady, receipt.dashboardStatus === 'ready');
if (receipt.wholeDashboardReady) {
  assert.equal(receipt.notComplete, 0, 'a ready dashboard cannot carry incomplete rows');
  assert.deepEqual(receipt.findings, [], 'a ready dashboard cannot carry findings');
}
assert.match(receipt.sortedRowDigest, /^sha256:[0-9a-f]{64}$/);

console.log('plan32-dashboard-consumption.test.ts: ok');

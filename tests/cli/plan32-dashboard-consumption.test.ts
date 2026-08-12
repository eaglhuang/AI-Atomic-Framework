import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-dashboard-consumption.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32DashboardConsumptionValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.consumedPlanId, '3.2');
assert.equal(receipt.observedRows, 29);
assert.equal(receipt.verified, 9);
assert.equal(receipt.notComplete, 20);
assert.equal(receipt.dashboardStatus, 'not-ready');
assert.equal(receipt.wholeDashboardReady, false);
assert.match(receipt.sortedRowDigest, /^sha256:[0-9a-f]{64}$/);

console.log('plan32-dashboard-consumption.test.ts: ok');

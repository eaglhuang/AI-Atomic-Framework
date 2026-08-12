import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-current-row-proof-map.json', 'utf8'));

assert.equal(report.schemaId, 'atm.plan3xCurrentRowProofMap.v1');
assert.equal(report.status, 'current-row-proof-partially-verified');
assert.equal(report.nonClaim, 'This map classifies every Plan 3.x objective row into its current proof family; verified rows are backed by current receipts, but this map does not certify any plan complete.');
assert.equal(report.totals.plans, 3);
assert.equal(report.totals.objectiveRows, 69);
assert.equal(report.totals.sourceRowsVerified, 15);
assert.equal(report.totals.sourceRowsNotComplete, 54);
assert.equal(report.totals.rowsMappedToProofFamily, 69);
assert.equal(report.totals.rowsCertifiedCompleteByThisMap, 0);
assert.equal(report.totals.proofFamilies, 5);

const families = new Map<string, any>(report.proofFamilies.map((entry: any) => [entry.id, entry]));
assert.equal(families.get('verified-current-receipt')?.rowCount, 15);
assert.equal(families.get('verified-current-receipt')?.status, 'verified');
assert.equal(families.get('fresh-command-replay-needed')?.rowCount, 33);
assert.equal(families.get('governed-state-replay-needed')?.rowCount, 19);
assert.equal(families.get('runner-release-parity-needed')?.rowCount, 2);
assert.equal(families.get('negative-control-only')?.rowCount, 0);
assert.equal(new Set(report.proofFamilies.flatMap((entry: any) => entry.rowRefs)).size, 69);
assert.deepEqual(report.nextExecutionOrder.map((entry: any) => entry.id), [
  'verified-current-receipt',
  'fresh-command-replay-needed',
  'governed-state-replay-needed',
  'runner-release-parity-needed',
  'negative-control-only'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-plan3x-current-row-proof-map.ts'], { stdio: 'pipe' });
console.log('plan3x-current-row-proof-map.test.ts: ok');

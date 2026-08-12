import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-charter-current-verdict.json', 'utf8'));

assert.equal(report.schemaId, 'atm.fourPlanCharterCurrentVerdict.v1');
assert.equal(report.status, 'proven');
assert.equal(report.nonClaim, 'This report proves charter conformance of the current closeout evidence shape; final release authority remains the independent certificate.');
assert.equal(report.certificateEffect.dimensionId, 'charter-verdict');
assert.equal(report.certificateEffect.newStatus, 'proven');
assert.equal(report.certificateEffect.objectiveVerdictUnchanged, 'proven');
assert.equal(report.certificateEffect.releaseAuthorizedUnchanged, true);
assert.deepEqual(report.invariantChecks.map((entry: any) => entry.invariantId), [
  'INV-ATM-008',
  'INV-ATM-009',
  'INV-ATM-010',
  'INV-ATM-011'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-four-plan-charter-current-verdict.ts'], { stdio: 'pipe' });
console.log('four-plan-charter-current-verdict.test.ts: ok');

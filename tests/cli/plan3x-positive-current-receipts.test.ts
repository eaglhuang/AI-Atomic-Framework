import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-positive-current-receipts.json', 'utf8'));

assert.equal(report.schemaId, 'atm.plan3xPositiveCurrentReceipts.v1');
assert.equal(report.status, 'positive-current-receipts-consumed');
assert.equal(report.totals.freshCommandRows, 27);
assert.equal(report.totals.positiveReceiptRowsReadyForSourceRecompute, 0);
assert.equal(report.totals.positiveReceiptRowsConsumedIntoSourceReplay, 23);
assert.equal(report.totals.objectiveAlignedNegativeControlRowsConsumed, 8);
assert.equal(report.totals.blockedByDoctorIntegrationDrift, 2);
assert.equal(report.totals.sourceRowsMutatedByThisReport, 23);
assert.equal(report.positiveRows.length, 23);
assert.equal(new Set(report.positiveRows.map((entry: any) => entry.objectiveId)).size, 23);
assert.deepEqual(report.blockedPositiveRows[0].rowRefs, ['P30-OBJ-10', 'P31-OBJ-08']);
assert.deepEqual(report.nextExecutionOrder.map((entry: any) => entry.id), [
  'preserve-consumed-positive-rows',
  'fix-or-narrow-doctor-dependent-rows',
  'write-positive-receipts-for-uncovered-rows'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-plan3x-positive-current-receipts.ts'], { stdio: 'pipe' });
console.log('plan3x-positive-current-receipts.test.ts: ok');

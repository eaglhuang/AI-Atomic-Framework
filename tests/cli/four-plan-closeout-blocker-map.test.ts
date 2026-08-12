import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-closeout-blocker-map.json', 'utf8'));

assert.equal(report.schemaId, 'atm.fourPlanCloseoutBlockerMap.v1');
assert.equal(report.status, 'actionable-not-complete');
assert.equal(report.nonClaim, 'This map is an execution dashboard, not a completion certificate.');
assert.equal(report.totals.objectiveRows, 86);
assert.equal(report.totals.unresolvedObjectiveRows, 74);
assert.equal(report.totals.plansWithExactDenominator, 4);
assert.equal(report.totals.certificateDimensionsProven, 5);
assert.equal(report.totals.certificateDimensionsNotComplete, 1);
assert.equal(report.totals.plan4SuccessorMappedAnchors, 17);
assert.equal(report.totals.plan3xCurrentRowProofMappedRows, 69);
assert.equal(report.totals.plan3xCurrentRowProofFamilies, 5);
assert.equal(report.totals.plan3xFreshCommandReceiptsGreen, 8);
assert.equal(report.totals.plan3xFreshCommandRowsCertified, 0);
assert.equal(report.totals.plan3xPositiveReceiptRowsReadyForSourceRecompute, 0);
assert.equal(report.totals.plan3xPositiveReceiptRowsConsumedIntoSourceReplay, 12);
assert.equal(report.totals.plan3xObjectiveAlignedNegativeControlRowsConsumed, 2);
assert.equal(report.totals.plan3xPositiveReceiptRowsBlockedByDoctorDrift, 2);
assert.equal(report.totals.backlogReleaseBlockingNow, 0);
assert.equal(report.totals.backlogNeedsTaskCardBeforeFinalRelease, 133);
assert.equal(report.blockerClasses.find((entry: any) => entry.id === 'B1-current-row-proof')?.status, 'partial-source-recomputed');
assert.equal(report.blockerClasses.find((entry: any) => entry.id === 'B4-backlog-disposition')?.status, 'separated');
assert.deepEqual(report.nextExecutionOrder.map((entry: any) => entry.id), [
  'B1-current-row-proof',
  'B4-backlog-disposition',
  'B5-release-certificate'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-four-plan-closeout-blocker-map.ts'], { stdio: 'pipe' });
console.log('four-plan-closeout-blocker-map.test.ts: ok');

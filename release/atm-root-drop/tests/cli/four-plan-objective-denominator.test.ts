import assert from 'node:assert/strict';
import { buildFourPlanObjectiveVerdict, expectedFourPlanDenominators, type FourPlanObjectiveRow } from '../../packages/core/src/evidence/plan-closeout-dashboard.ts';

function rowsFor(planId: FourPlanObjectiveRow['planId'], count: number): FourPlanObjectiveRow[] {
  return Array.from({ length: count }, (_, index) => ({
    planId,
    objectiveId: `OBJ-${String(index + 1).padStart(2, '0')}`,
    status: 'verified',
    evidenceRefs: [`evidence/${planId}/${index + 1}.json`]
  }));
}

const denominators = expectedFourPlanDenominators();
const rows = [
  ...rowsFor('Plan 3.0', denominators['Plan 3.0']),
  ...rowsFor('Plan 3.1', denominators['Plan 3.1']),
  ...rowsFor('Plan 3.2', denominators['Plan 3.2']),
  ...rowsFor('Plan 4.0', denominators['Plan 4.0'])
];

const ready = buildFourPlanObjectiveVerdict({ generatedAt: '2026-01-01T00:00:00.000Z', rows });
assert.equal(ready.status, 'ready');
assert.deepEqual(ready.observedDenominators, denominators);
assert.equal(ready.rows.length, 86);
assert.match(ready.sortedRowDigest, /^sha256:/);

const missing = buildFourPlanObjectiveVerdict({ rows: rows.slice(1) });
assert.equal(missing.status, 'not-ready');
assert.ok(missing.findings.some((finding) => finding.includes('Plan 3.0 denominator expected 17, observed 16')));

const duplicate = buildFourPlanObjectiveVerdict({ rows: [...rows, rows[0]] });
assert.equal(duplicate.status, 'not-ready');
assert.ok(duplicate.findings.some((finding) => finding.includes('duplicate objective row')));

const unsupportedVerified = buildFourPlanObjectiveVerdict({
  rows: rows.map((row, index) => index === 0 ? { ...row, evidenceRefs: [] } : row)
});
assert.equal(unsupportedVerified.status, 'not-ready');
assert.ok(unsupportedVerified.findings.some((finding) => finding.includes('verified row lacks evidence')));

console.log('four-plan-objective-denominator.test.ts: ok');

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluateObjectiveRows } from '../../scripts/review-four-plan-objective-authority.ts';

assert.deepEqual(evaluateObjectiveRows({ rows: [{ objectiveId: 'P30-OBJ-01', status: 'verified', evidenceTuples: [{ kind: 'receipt', receiptId: 'r1' }] }] }, 'P30-OBJ-', 1), []);
assert.deepEqual(evaluateObjectiveRows({ rows: [{ objectiveId: 'P30-OBJ-01', status: 'verified', evidenceTuples: [{ kind: 'receipt', source: 'receipt.json', expectedTaskId: 'TASK-1' }] }] }, 'P30-OBJ-', 1), []);
assert.ok(evaluateObjectiveRows({ rows: [{ objectiveId: 'P30-OBJ-01', status: 'verified', evidenceTuples: [] }] }, 'P30-OBJ-', 1).includes('evidence-missing:P30-OBJ-01'));
assert.ok(evaluateObjectiveRows({ rows: [{ objectiveId: 'P30-OBJ-01', status: 'unknown', evidenceTuples: [{ kind: 'receipt', receiptId: 'r1' }] }] }, 'P30-OBJ-', 1).includes('nonterminal:P30-OBJ-01'));

execFileSync(process.execPath, ['--strip-types', 'scripts/review-four-plan-objective-authority.ts', '--mode', 'write'], { stdio: 'pipe' });
execFileSync(process.execPath, ['--strip-types', 'scripts/review-four-plan-objective-authority.ts', '--mode', 'validate'], { stdio: 'pipe' });
const report = JSON.parse(readFileSync('docs/reports/reviews/plan-3x-4x-objective-authority-review.json', 'utf8'));
assert.equal(report.schemaId, 'atm.fourPlanIndependentReview.v1');
assert.equal(report.reviewerId, 'reviewer-a-objective-authority');
assert.ok(report.nonClaims.includes('does-not-read-independent-certificate'));
assert.match(report.reviewDigest, /^sha256:[0-9a-f]{64}$/);
console.log('four-plan-objective-authority-review.test.ts: ok');

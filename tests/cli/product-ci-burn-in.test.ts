import assert from 'node:assert/strict';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

function run(id: number, createdAt: string, conclusion = 'success', extra: Record<string, unknown> = {}) {
  return {
    databaseId: id,
    status: 'completed',
    conclusion,
    headSha: `${id.toString(16).padStart(7, '0')}${'a'.repeat(57)}`,
    headBranch: 'main',
    event: 'push',
    createdAt,
    displayTitle: 'Product CI burn-in (standard)',
    ...extra,
  };
}

const base = [
  run(3, '2026-02-01T00:00:00Z', 'success', { displayTitle: 'Product CI burn-in (release-candidate)' }),
  run(2, '2026-01-15T00:00:00Z'),
  run(1, '2026-01-01T00:00:00Z'),
];

const short = evaluateBurnIn(base, { minCompletedRuns: 3, minCalendarDays: 30 });
assert.equal(short.claimStatus, 'long-term-green');
assert.equal(short.observed?.releaseCandidateRuns, 1);
assert.equal(short.observed?.currentConsecutiveSuccessStreak, 3);

const failure = evaluateBurnIn([base[0], run(2, '2026-01-15T00:00:00Z', 'failure'), base[2]], { minCompletedRuns: 3, minCalendarDays: 30 });
assert.equal(failure.claimStatus, 'unexplained-failure');
assert.ok(failure.reasons.includes('unexplained-failure-present'));

const insufficient = evaluateBurnIn([base[0], base[1]], { minCompletedRuns: 3, minCalendarDays: 30 });
assert.equal(insufficient.claimStatus, 'insufficient-window');
assert.ok(insufficient.reasons.includes('insufficient-completed-runs'));

const duplicate = evaluateBurnIn([base[0], base[0]], { minCompletedRuns: 2, minCalendarDays: 1 });
assert.equal(duplicate.claimStatus, 'invalid-input');
assert.ok(duplicate.reasons.some((reason) => reason.startsWith('duplicate-databaseId')));

const nonProtected = evaluateBurnIn([run(4, '2026-02-01T00:00:00Z', 'success', { headBranch: 'feature/x' })], { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(nonProtected.claimStatus, 'invalid-input');
assert.ok(nonProtected.reasons.includes('record-4-non-protected-branch'));

const bounded = evaluateBurnIn([
  run(5, '2026-02-03T00:00:00Z', 'success', { headSha: 'bbbbbbb' + 'a'.repeat(57) }),
  run(4, '2026-02-02T00:00:00Z', 'failure'),
  run(3, '2026-02-01T00:00:00Z', 'failure'),
], { minCompletedRuns: 1, minCalendarDays: 0, baselineAt: '2026-02-02T12:00:00Z', baselineSha: 'bbbbbbb' + 'a'.repeat(57) });
assert.equal(bounded.claimStatus, 'long-term-green');
assert.equal(bounded.observed?.historicalRunCount, 2);
assert.equal(bounded.observed?.postBaselineRunCount, 1);

const missingBoundaryBinding = evaluateBurnIn(base, { minCompletedRuns: 1, minCalendarDays: 0, baselineAt: '2026-01-01T00:00:00Z' });
assert.equal(missingBoundaryBinding.claimStatus, 'invalid-input');
assert.ok(missingBoundaryBinding.reasons.includes('baselineSha-required-with-baselineAt'));

const missingBoundaryCommit = evaluateBurnIn(base, { minCompletedRuns: 1, minCalendarDays: 0, baselineAt: '2026-03-01T00:00:00Z', baselineSha: base[0].headSha });
assert.equal(missingBoundaryCommit.claimStatus, 'invalid-input');
assert.ok(missingBoundaryCommit.reasons.includes('baseline-no-post-boundary-runs'));

console.log('product-ci-burn-in tests: 8/8 passed');

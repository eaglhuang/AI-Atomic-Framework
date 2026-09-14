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
    lifecycle: {
      firstFailureAt: conclusion === 'success' ? null : createdAt,
      retryCount: 0,
      lastAttemptAt: createdAt,
      repairAcceptedAt: null,
      failureClass: conclusion === 'success' ? null : 'unknown-failure',
    },
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
assert.equal(short.observed?.retryCount, 0);
assert.equal(short.observed?.averageRepairTimeMs, null);

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

const retried = evaluateBurnIn([
  run(6, '2026-02-03T00:00:00Z', 'success', {
    lifecycle: {
      firstFailureAt: '2026-02-02T23:00:00Z',
      retryCount: 2,
      lastAttemptAt: '2026-02-03T01:00:00Z',
      repairAcceptedAt: '2026-02-03T02:00:00Z',
      failureClass: 'dependency-install',
    },
  }),
  run(5, '2026-02-02T22:00:00Z', 'failure', {
    lifecycle: {
      firstFailureAt: '2026-02-02T22:00:00Z',
      retryCount: 1,
      lastAttemptAt: '2026-02-02T23:00:00Z',
      repairAcceptedAt: null,
      failureClass: 'dependency-install',
    },
  }),
], { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(retried.claimStatus, 'unexplained-failure');
assert.equal(retried.observed?.retriedRuns, 2);
assert.equal(retried.observed?.retryCount, 3);
assert.equal(retried.observed?.unresolvedFailures, 1);
assert.deepEqual(retried.observed?.repairTimeMs, [10800000]);

const missingLifecycle = evaluateBurnIn([run(7, '2026-02-04T00:00:00Z', 'success', { lifecycle: undefined })], { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(missingLifecycle.claimStatus, 'invalid-input');
assert.ok(missingLifecycle.reasons.includes('record-7-missing-lifecycle'));

const excluded = evaluateBurnIn([
  run(9, '2026-02-04T00:00:00Z', 'success'),
  run(8, '2026-02-03T00:00:00Z', 'cancelled', { eligible: false, exclusionReason: 'superseded-by-newer-protected-main-run' }),
], { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(excluded.claimStatus, 'long-term-green');
assert.equal(excluded.observed?.excludedRunCount, 1);
assert.deepEqual(excluded.observed?.excludedRunIds, [8]);

console.log('product-ci-burn-in tests: 12/12 passed');

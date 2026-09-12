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

console.log('product-ci-burn-in tests: 5/5 passed');

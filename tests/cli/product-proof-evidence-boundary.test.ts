import assert from 'node:assert/strict';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

const run = (databaseId: number, event: 'schedule' | 'push' | 'workflow_dispatch' = 'schedule', createdAt = '2026-09-13T00:00:00Z') => ({ databaseId, status: 'completed', conclusion: 'success', headSha: 'a'.repeat(40), headBranch: 'main', event, createdAt });
const scheduled = [run(2), run(1, 'push', '2026-09-12T00:00:00Z')];
assert.equal(evaluateBurnIn(scheduled, { minCompletedRuns: 2, minCalendarDays: 0 }).claimStatus, 'long-term-green');
assert.equal(evaluateBurnIn([{ ...run(2, 'push', '2026-09-13T00:00:00Z'), conclusion: 'failure' }, run(1, 'workflow_dispatch', '2026-09-12T00:00:00Z')], { minCompletedRuns: 2, minCalendarDays: 0 }).claimStatus, 'unexplained-failure');
assert.equal(evaluateBurnIn([run(1, 'push', '2026-09-13T00:00:00Z')], { minCompletedRuns: 90, minCalendarDays: 30 }).claimStatus, 'insufficient-window');
console.log('product-proof-evidence-boundary ok');

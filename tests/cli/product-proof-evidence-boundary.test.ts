import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

const run = (databaseId: number, event: 'schedule' | 'push' | 'workflow_dispatch' = 'schedule', createdAt = '2026-09-13T00:00:00Z', conclusion = 'success') => ({ databaseId, status: 'completed', conclusion, headSha: 'a'.repeat(40), headBranch: 'main', event, createdAt, lifecycle: { firstFailureAt: conclusion === 'success' ? null : createdAt, retryCount: 0, lastAttemptAt: createdAt, repairAcceptedAt: null, failureClass: conclusion === 'success' ? null : 'unknown-failure' } });
const scheduled = [run(2), run(1, 'push', '2026-09-12T00:00:00Z')];
assert.equal(evaluateBurnIn(scheduled, { minCompletedRuns: 2, minCalendarDays: 0 }).claimStatus, 'long-term-green');
assert.equal(evaluateBurnIn([run(2, 'push', '2026-09-13T00:00:00Z', 'failure'), run(1, 'workflow_dispatch', '2026-09-12T00:00:00Z')], { minCompletedRuns: 2, minCalendarDays: 0 }).claimStatus, 'unexplained-failure');
assert.equal(evaluateBurnIn([run(1, 'push', '2026-09-13T00:00:00Z')], { minCompletedRuns: 90, minCalendarDays: 30 }).claimStatus, 'insufficient-window');

const validatorSource = readFileSync(new URL('../../scripts/validate-public-npm-install.ts', import.meta.url), 'utf8');
assert.match(validatorSource, /value\('--version'\) \?\? resolvePublishedLatest\(packageName\)/);
assert.match(validatorSource, /function resolvePublishedLatest\(packageName: string\)/);
assert.doesNotMatch(validatorSource, /value\('--version', ['\"]0\.1\.0-beta/);
assert.match(validatorSource, /atm-chart-render/);
assert.match(validatorSource, /atm-chart-verify/);
assert.match(validatorSource, /requiredSuccessCommandFailures/);
assert.match(validatorSource, /coreWorkflowPassed/);
assert.match(validatorSource, /publicSmokeCommandNames/);
console.log('product-proof-evidence-boundary ok');

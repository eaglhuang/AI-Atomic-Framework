// The GitHub exporter must produce an atm.githubCiAttemptExport.v1 document that
// the burn-in collector accepts, keep every rerun attempt, account for every run
// it drops, and fail closed when job data is missing. Pure function; no network.
import assert from 'node:assert/strict';
import { collectLifecycleEvidence } from '../../scripts/collect-ci-burn-in-evidence.ts';
import { buildAttemptExport, type GhJob, type GhRun } from '../../scripts/export-github-ci-attempts.ts';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

const standard = 'Product CI burn-in (standard)';
const requiredStepNames = [
  'Clean install',
  'Build',
  'Typecheck',
  'Lint',
  'Full test',
  'Package skeleton smoke',
  'Clean-install packed CLI smoke',
  'Workspace package smoke',
  'Clean-install repeat smoke',
];
const run = (id: number, at: string, overrides: Partial<GhRun> = {}): GhRun => ({
  databaseId: id, attempt: 1, status: 'completed', conclusion: 'success', createdAt: at,
  headSha: String(id).padStart(40, 'a'), headBranch: 'main', event: 'push', displayTitle: standard, ...overrides,
});
const job = (id: number, conclusion: string, at: string, name = 'Product CI'): GhJob => ({
  id, name, conclusion, html_url: `https://github.com/o/r/actions/runs/1/job/${id}`, started_at: at, completed_at: at,
  steps: requiredStepNames.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
});

const runs: GhRun[] = [
  run(100, '2026-09-10T00:00:00Z'),
  run(101, '2026-09-11T00:00:00Z', { attempt: 2, conclusion: 'success' }),
  run(102, '2026-09-12T00:00:00Z', { conclusion: 'failure' }),
  run(103, '2026-09-13T00:00:00Z'),
  run(104, '2026-09-13T01:00:00Z', { event: 'pull_request' }),
  run(105, '2026-09-13T02:00:00Z', { status: 'in_progress', conclusion: null }),
];
const jobs = new Map<string, GhJob[]>([
  ['100#1', [job(1000, 'success', '2026-09-10T00:05:00Z'), job(1001, 'success', '2026-09-10T00:06:00Z', 'ATM Dogfood')]],
  ['101#1', [job(1010, 'failure', '2026-09-11T00:05:00Z')]],
  ['101#2', [job(1011, 'success', '2026-09-11T01:05:00Z')]],
  ['102#1', [job(1020, 'failure', '2026-09-12T00:05:00Z')]],
  ['103#1', [job(1030, 'success', '2026-09-13T00:05:00Z')]],
]);
const dispositions = [{ runId: 102, failureClass: 'typecheck-failure', rootCause: 'TS2322', repairRunId: 103 }];

const exported = buildAttemptExport({ repository: 'o/r', protectedBranch: 'main', runs, jobsByRunAttempt: jobs, failureDispositions: dispositions });
assert.equal(exported.schemaId, 'atm.githubCiAttemptExport.v1');
assert.deepEqual(exported.attempts.map((attempt) => `${attempt.runId}#${attempt.runAttempt}`), ['100#1', '101#1', '101#2', '102#1', '103#1'],
  'every attempt of a rerun is exported, not only the latest');
assert.deepEqual(exported.droppedRuns, [
  { runId: 104, reason: 'unsupported-event:pull_request' },
  { runId: 105, reason: 'not-completed' },
], 'dropped runs are listed with a reason instead of disappearing');
assert.deepEqual(exported.failureDispositions, dispositions);
const first = exported.attempts[0];
assert.equal(first.productCi?.job?.jobId, 1000, 'the Product CI job, not another job, is bound');
assert.deepEqual(first.productCi?.job?.steps, requiredStepNames.map((name) => ({ name, status: 'completed', conclusion: 'success' })), 'Product CI steps are preserved for coverage validation');
assert.equal(first.attemptCompletedAt, '2026-09-10T00:05:00Z', 'attempt timing comes from the job, not the run creation time');

const receipt = collectLifecycleEvidence(exported);
const rerun = receipt.runs.find((entry) => entry.databaseId === 101)!;
assert.equal(rerun.lifecycle?.retryCount, 1);
assert.equal(rerun.lifecycle?.repairAcceptedAt, '2026-09-11T01:05:00Z', 'a green rerun is recorded as the repair');
const verdict = evaluateBurnIn(receipt, { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(verdict.semanticVerdict, 'accept', JSON.stringify(verdict.reasons));
assert.equal(verdict.observed?.failedRuns, 1);
assert.equal(verdict.observed?.repairedFailures, 1);

// A run outside the burn-in scope is judged by its workflow conclusion, so a
// failed workflow with a green Product CI job still needs a failure class.
const outOfScope = buildAttemptExport({
  repository: 'o/r', protectedBranch: 'main',
  runs: [run(300, '2026-09-15T00:00:00Z', { conclusion: 'failure', displayTitle: 'feat: some commit title' })],
  jobsByRunAttempt: new Map([['300#1', [job(3000, 'success', '2026-09-15T00:05:00Z')]]]),
});
assert.equal(outOfScope.attempts[0].failureClass, 'unknown-failure');
assert.doesNotThrow(() => collectLifecycleEvidence(outOfScope));

assert.throws(
  () => buildAttemptExport({ repository: 'o/r', protectedBranch: 'main', runs: [run(200, '2026-09-14T00:00:00Z')], jobsByRunAttempt: new Map() }),
  /run 200 attempt 1 has no job data/,
  'a completed run without job data must fail the export, not be skipped'
);

console.log('[export-github-ci-attempts.test] ok');

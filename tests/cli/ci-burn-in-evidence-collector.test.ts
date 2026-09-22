import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectLifecycleEvidence, canonicalDigest, validateScopePolicy } from '../../scripts/collect-ci-burn-in-evidence.ts';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

const fixture = JSON.parse(await readFile(new URL('../fixtures/product-ci-burn-in/lifecycle-attempts.json', import.meta.url), 'utf8'));
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
const job = (jobId: number, jobName = 'Product CI') => ({
  jobId,
  jobName,
  jobUrl: `https://github.com/eaglhuang/AI-Atomic-Framework/actions/runs/${jobId}/job/${jobId}`,
  steps: requiredStepNames.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  stepCoverage: { complete: true, missing: [], ambiguous: [], unsuccessful: [] },
});
const attemptExport: any = {
  schemaId: 'atm.githubCiAttemptExport.v1',
  repository: 'AI-Atomic-Framework',
  protectedBranch: 'main',
  attempts: [
    { runId: 5803, runAttempt: 1, status: 'completed', conclusion: 'failure', headSha: fixture[0].headSha, headBranch: 'main', event: 'push', createdAt: fixture[0].createdAt, attemptStartedAt: '2026-09-14T09:00:00Z', attemptCompletedAt: fixture[0].lifecycle.firstFailureAt, productCi: { conclusion: 'failure', job: job(58031) }, workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)', failureClass: 'test-failure' },
    { runId: 5803, runAttempt: 2, status: 'completed', conclusion: 'failure', headSha: fixture[0].headSha, headBranch: 'main', event: 'push', createdAt: fixture[0].createdAt, attemptStartedAt: '2026-09-14T09:08:00Z', attemptCompletedAt: fixture[0].lifecycle.repairAcceptedAt, productCi: { conclusion: 'success', job: job(58032) }, workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)' },
    { runId: 5802, runAttempt: 1, status: 'completed', conclusion: 'failure', headSha: fixture[1].headSha, headBranch: 'main', event: 'schedule', createdAt: fixture[1].createdAt, attemptStartedAt: '2026-09-13T09:00:00Z', attemptCompletedAt: fixture[1].lifecycle.lastAttemptAt, productCi: { conclusion: 'failure', job: job(58021) }, workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)', failureClass: 'dependency-install' },
  ],
};
const receipt = collectLifecycleEvidence(attemptExport);
assert.equal(receipt.schemaId, 'atm.ciLifecycleEvidence.v1');
assert.equal(receipt.runs.length, 2);
assert.equal(receipt.runs[0].databaseId, 5803);
assert.equal(receipt.runs[0].conclusion, 'success');
assert.equal(receipt.runs[0].workflowConclusion, 'failure');
assert.equal(receipt.runs[0].productJobConclusion, 'success');
assert.deepEqual(receipt.runs[0].productJob, job(58032));
assert.equal(receipt.runs[0].attempts?.length, 2);
assert.deepEqual(receipt.runs[0].attempts?.map((attempt) => attempt.productJob.jobId), [58031, 58032]);
assert.match(receipt.scopePolicyDigest, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(receipt.runs[0].lifecycle, {
  firstFailureAt: '2026-09-14T09:04:00Z',
  retryCount: 1,
  lastAttemptAt: '2026-09-14T09:11:00Z',
  repairAcceptedAt: '2026-09-14T09:11:00Z',
  failureClass: 'test-failure',
});
const replay = evaluateBurnIn(receipt.runs, { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(replay.claimStatus, 'unexplained-failure', JSON.stringify(replay));
assert.equal(receipt.receiptDigest, canonicalDigest(receipt.runs));
const wrapperReplay = evaluateBurnIn(receipt, { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(wrapperReplay.claimStatus, 'unexplained-failure', JSON.stringify(wrapperReplay));
assert.equal(wrapperReplay.semanticVerdict, 'reject');
assert.equal(wrapperReplay.input.receiptDigest, receipt.receiptDigest);
const fixtureReplay = evaluateBurnIn(fixture, { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(fixtureReplay.claimStatus, 'unexplained-failure');

const missingFailureClass = structuredClone(attemptExport);
missingFailureClass.attempts[0].failureClass = null;
assert.throws(() => collectLifecycleEvidence(missingFailureClass), /missing-failureClass/);

const missingJobProvenance = structuredClone(attemptExport);
missingJobProvenance.attempts[0]!.productCi = { conclusion: 'failure' };
const missingJobReceipt = collectLifecycleEvidence(missingJobProvenance);
assert.equal(missingJobReceipt.runs.find((run) => run.databaseId === 5803)?.eligible, false);
assert.equal(missingJobReceipt.runs.find((run) => run.databaseId === 5803)?.exclusionReason, 'missing-product-job-coverage');

const tamperedJobReceipt = structuredClone(receipt);
tamperedJobReceipt.runs[0]!.attempts![0]!.productJob.jobUrl = '';
tamperedJobReceipt.receiptDigest = canonicalDigest(tamperedJobReceipt.runs);
assert.equal(evaluateBurnIn(tamperedJobReceipt, { minCompletedRuns: 1, minCalendarDays: 0 }).claimStatus, 'invalid-input');

const missingExclusionReason = structuredClone(attemptExport);
missingExclusionReason.attempts.push({ ...missingExclusionReason.attempts[0], runId: 5804, runAttempt: 1, eligible: false, exclusionReason: null });
assert.throws(() => collectLifecycleEvidence(missingExclusionReason), /missing-exclusionReason/);

const duplicateAttempt = structuredClone(attemptExport);
duplicateAttempt.attempts.push(duplicateAttempt.attempts[0]);
assert.throws(() => collectLifecycleEvidence(duplicateAttempt), /duplicate-attempt/);

const outOfScope = structuredClone(attemptExport);
outOfScope.attempts[0].workflowName = 'ci';
outOfScope.attempts[1].workflowName = 'ci';
outOfScope.attempts[2].workflowName = 'ci';
const outOfScopeReceipt = collectLifecycleEvidence(outOfScope);
assert.equal(outOfScopeReceipt.runs.every((run) => run.eligible === false), true);
assert.equal(outOfScopeReceipt.runs[0].exclusionReason, 'out-of-scope-workflow');

const missingStepCoverage = structuredClone(attemptExport);
delete missingStepCoverage.attempts[0].productCi.job.steps;
const missingStepReceipt = collectLifecycleEvidence(missingStepCoverage);
const missingStepRun = missingStepReceipt.runs.find((run) => run.databaseId === 5803)!;
assert.equal(missingStepRun.eligible, false);
assert.equal(missingStepRun.exclusionReason, 'missing-required-step-coverage');
assert.equal(missingStepRun.attempts, undefined);

const ambiguousStepCoverage = structuredClone(attemptExport);
ambiguousStepCoverage.attempts[1].productCi.job.steps.push({ name: 'Build', status: 'completed', conclusion: 'success' });
const ambiguousStepReceipt = collectLifecycleEvidence(ambiguousStepCoverage);
assert.equal(ambiguousStepReceipt.runs.find((run) => run.databaseId === 5803)?.exclusionReason, 'ambiguous-required-step-coverage');

const failedStepCoverage = structuredClone(attemptExport);
failedStepCoverage.attempts[1].productCi.job.steps.find((step: any) => step.name === 'Build').conclusion = 'failure';
const failedStepReceipt = collectLifecycleEvidence(failedStepCoverage);
assert.equal(failedStepReceipt.runs.find((run) => run.databaseId === 5803)?.exclusionReason, 'unsuccessful-required-step-coverage');

// A failed product job with all required step names present remains eligible
// so the failure can be classified and paired with a later repair run.
const failedProductJob = structuredClone(attemptExport);
failedProductJob.attempts[0].productCi.job.steps.find((step: any) => step.name === 'Build').conclusion = 'failure';
const failedProductReceipt = collectLifecycleEvidence(failedProductJob);
const failedProductRun = failedProductReceipt.runs.find((run) => run.databaseId === 5803)!;
assert.equal(failedProductRun.eligible, true);
assert.equal(failedProductRun.productJob?.stepCoverage?.complete, true);
assert.equal(failedProductRun.attempts?.[0]?.productJob.stepCoverage?.complete, true);
assert.deepEqual(failedProductRun.attempts?.[0]?.productJob.stepCoverage?.unsuccessful, ['Build']);

const tamperedStepCoverage = structuredClone(receipt);
tamperedStepCoverage.runs[0]!.productJob!.stepCoverage!.complete = false;
tamperedStepCoverage.receiptDigest = canonicalDigest(tamperedStepCoverage.runs);
assert.equal(evaluateBurnIn(tamperedStepCoverage, { minCompletedRuns: 1, minCalendarDays: 0 }).claimStatus, 'invalid-input');

// A real export can contain eligible and scope-excluded runs together.  The
// collector omits attempts for excluded runs, so replay must validate only the
// eligible records rather than rejecting the whole receipt as malformed.
const mixedScope = structuredClone(attemptExport);
mixedScope.attempts[0].workflowName = 'ci';
mixedScope.attempts[1].workflowName = 'ci';
const mixedScopeReceipt = collectLifecycleEvidence(mixedScope);
assert.equal(mixedScopeReceipt.runs.some((run) => run.eligible === false), true);
assert.equal(mixedScopeReceipt.runs.some((run) => run.eligible !== false), true);
assert.equal(mixedScopeReceipt.runs.find((run) => run.eligible === false)?.attempts, undefined);
const mixedScopeReplay = evaluateBurnIn(mixedScopeReceipt, { minCompletedRuns: 1, minCalendarDays: 0 });
assert.notEqual(mixedScopeReplay.claimStatus, 'invalid-input', JSON.stringify(mixedScopeReplay));

const missingIdentity = structuredClone(attemptExport);
delete missingIdentity.attempts[0].workflowName;
delete missingIdentity.attempts[1].workflowName;
delete missingIdentity.attempts[2].workflowName;
const missingIdentityReceipt = collectLifecycleEvidence(missingIdentity);
assert.equal(missingIdentityReceipt.runs[0].exclusionReason, 'missing-workflow-identity');

const ambiguousIdentity = structuredClone(attemptExport);
ambiguousIdentity.attempts[0].displayTitle = 'Product CI burn-in (release-candidate)';
ambiguousIdentity.attempts[1].displayTitle = 'Product CI burn-in (release-candidate)';
const ambiguousReceipt = collectLifecycleEvidence(ambiguousIdentity);
assert.equal(ambiguousReceipt.runs[0].exclusionReason, 'out-of-scope-workflow');

const tamperedPolicy = JSON.parse(await readFile(new URL('../../scripts/product-ci-burn-in-workflow-scope.json', import.meta.url), 'utf8'));
tamperedPolicy.releaseCandidateTreatment = 'exclude';
assert.throws(() => validateScopePolicy(tamperedPolicy), /scope-policy-digest-mismatch/);

const tamperedReceipt = structuredClone(receipt);
tamperedReceipt.runs[0].headSha = 'b'.repeat(40);
assert.equal(evaluateBurnIn(tamperedReceipt, { minCompletedRuns: 1, minCalendarDays: 0 }).claimStatus, 'invalid-input');

// Fix-forward repair: run 7001 failed, a later commit fixed it and run 7002 passed.
const standard = { workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)' };
const fixForward = (outcome: 'failure' | 'success', runId: number, at: string, jobId: number) => ({
  runId, runAttempt: 1, status: 'completed', conclusion: outcome, headSha: String(runId).padStart(40, 'c'), headBranch: 'main', event: 'push',
  createdAt: at, attemptStartedAt: at, attemptCompletedAt: at, productCi: { conclusion: outcome, job: job(jobId) }, ...standard,
  ...(outcome === 'failure' ? { failureClass: 'unknown-failure' } : {}),
});
const fixForwardExport = (failureDispositions?: unknown) => ({
  schemaId: 'atm.githubCiAttemptExport.v1', repository: 'AI-Atomic-Framework', protectedBranch: 'main',
  attempts: [
    fixForward('success', 7000, '2026-09-10T00:00:00Z', 70001),
    fixForward('failure', 7001, '2026-09-11T00:00:00Z', 70011),
    fixForward('success', 7002, '2026-09-12T00:00:00Z', 70021),
  ],
  ...(failureDispositions === undefined ? {} : { failureDispositions }),
});
const disposition = { runId: 7001, failureClass: 'typecheck-failure', rootCause: 'TS2322 in metrics.ts', repairRunId: 7002 };

const undisposed = collectLifecycleEvidence(fixForwardExport());
assert.equal(evaluateBurnIn(undisposed, { minCompletedRuns: 1, minCalendarDays: 0 }).semanticVerdict, 'reject',
  'a fix-forward failure without a disposition must stay unexplained');

const disposed = collectLifecycleEvidence(fixForwardExport([disposition]));
const disposedRun = disposed.runs.find((run) => run.databaseId === 7001)!;
assert.equal(disposedRun.lifecycle?.repairRunId, 7002);
assert.equal(disposedRun.lifecycle?.repairAcceptedAt, '2026-09-12T00:00:00Z');
assert.equal(disposedRun.lifecycle?.failureClass, 'typecheck-failure');
assert.equal(disposedRun.lifecycle?.rootCause, 'TS2322 in metrics.ts');
assert.notEqual(disposed.sourceDigest, undisposed.sourceDigest, 'the disposition must be bound into sourceDigest');
const disposedVerdict = evaluateBurnIn(disposed, { minCompletedRuns: 1, minCalendarDays: 0 });
assert.equal(disposedVerdict.semanticVerdict, 'accept', JSON.stringify(disposedVerdict));
assert.equal(disposedVerdict.observed?.failedRuns, 1);
assert.equal(disposedVerdict.observed?.repairedFailures, 1);
assert.equal(evaluateBurnIn(disposed, { minCompletedRuns: 1, minCalendarDays: 0, failurePolicy: 'zero-tolerance' }).semanticVerdict, 'reject');

for (const [override, expected] of [
  [{ failureClass: 'unknown-failure' }, /failureDisposition-7001-requires-specific-failureClass/],
  [{ rootCause: ' ' }, /failureDisposition-7001-missing-rootCause/],
  [{ repairRunId: 7000 }, /failureDisposition-7001-repair-run-not-later/],
  [{ repairRunId: 9999 }, /failureDisposition-7001-repair-run-not-eligible/],
  [{ runId: 7002, repairRunId: 7002 }, /failureDisposition-7002-run-did-not-fail/],
] as const) {
  assert.throws(() => collectLifecycleEvidence(fixForwardExport([{ ...disposition, ...override }])), expected);
}
assert.throws(() => collectLifecycleEvidence(fixForwardExport([disposition, disposition])), /failureDisposition-7001-duplicate/);

console.log('ci-burn-in-evidence-collector: ok');

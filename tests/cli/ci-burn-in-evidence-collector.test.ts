import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectLifecycleEvidence, canonicalDigest, validateScopePolicy } from '../../scripts/collect-ci-burn-in-evidence.ts';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

const fixture = JSON.parse(await readFile(new URL('../fixtures/product-ci-burn-in/lifecycle-attempts.json', import.meta.url), 'utf8'));
const attemptExport: any = {
  schemaId: 'atm.githubCiAttemptExport.v1',
  repository: 'AI-Atomic-Framework',
  protectedBranch: 'main',
  attempts: [
    { runId: 5803, runAttempt: 1, status: 'completed', conclusion: 'failure', headSha: fixture[0].headSha, headBranch: 'main', event: 'push', createdAt: fixture[0].createdAt, attemptStartedAt: '2026-09-14T09:00:00Z', attemptCompletedAt: fixture[0].lifecycle.firstFailureAt, productCi: { conclusion: 'failure' }, workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)', failureClass: 'test-failure' },
    { runId: 5803, runAttempt: 2, status: 'completed', conclusion: 'failure', headSha: fixture[0].headSha, headBranch: 'main', event: 'push', createdAt: fixture[0].createdAt, attemptStartedAt: '2026-09-14T09:08:00Z', attemptCompletedAt: fixture[0].lifecycle.repairAcceptedAt, productCi: { conclusion: 'success' }, workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)' },
    { runId: 5802, runAttempt: 1, status: 'completed', conclusion: 'failure', headSha: fixture[1].headSha, headBranch: 'main', event: 'schedule', createdAt: fixture[1].createdAt, attemptStartedAt: '2026-09-13T09:00:00Z', attemptCompletedAt: fixture[1].lifecycle.lastAttemptAt, productCi: { conclusion: 'failure' }, workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)', failureClass: 'dependency-install' },
  ],
};
const receipt = collectLifecycleEvidence(attemptExport);
assert.equal(receipt.schemaId, 'atm.ciLifecycleEvidence.v1');
assert.equal(receipt.runs.length, 2);
assert.equal(receipt.runs[0].databaseId, 5803);
assert.equal(receipt.runs[0].conclusion, 'success');
assert.equal(receipt.runs[0].workflowConclusion, 'failure');
assert.equal(receipt.runs[0].productJobConclusion, 'success');
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

console.log('ci-burn-in-evidence-collector: ok');

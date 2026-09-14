import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectLifecycleEvidence, canonicalDigest } from '../../scripts/collect-ci-burn-in-evidence.ts';
import { evaluateBurnIn } from '../../scripts/measure-product-ci-burn-in.ts';

const fixture = JSON.parse(await readFile(new URL('../fixtures/product-ci-burn-in/lifecycle-attempts.json', import.meta.url), 'utf8'));
const attemptExport: any = {
  schemaId: 'atm.githubCiAttemptExport.v1',
  repository: 'AI-Atomic-Framework',
  protectedBranch: 'main',
  attempts: [
    { runId: 5803, runAttempt: 1, status: 'completed', conclusion: 'failure', headSha: fixture[0].headSha, headBranch: 'main', event: 'push', createdAt: fixture[0].createdAt, attemptStartedAt: '2026-09-14T09:00:00Z', attemptCompletedAt: fixture[0].lifecycle.firstFailureAt, productCi: { conclusion: 'failure' }, failureClass: 'test-failure' },
    { runId: 5803, runAttempt: 2, status: 'completed', conclusion: 'success', headSha: fixture[0].headSha, headBranch: 'main', event: 'push', createdAt: fixture[0].createdAt, attemptStartedAt: '2026-09-14T09:08:00Z', attemptCompletedAt: fixture[0].lifecycle.repairAcceptedAt, productCi: { conclusion: 'success' } },
    { runId: 5802, runAttempt: 1, status: 'completed', conclusion: 'failure', headSha: fixture[1].headSha, headBranch: 'main', event: 'schedule', createdAt: fixture[1].createdAt, attemptStartedAt: '2026-09-13T09:00:00Z', attemptCompletedAt: fixture[1].lifecycle.lastAttemptAt, productCi: { conclusion: 'failure' }, failureClass: 'dependency-install' },
  ],
};
const receipt = collectLifecycleEvidence(attemptExport);
assert.equal(receipt.schemaId, 'atm.ciLifecycleEvidence.v1');
assert.equal(receipt.runs.length, 2);
assert.equal(receipt.runs[0].databaseId, 5803);
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

const tamperedReceipt = structuredClone(receipt);
tamperedReceipt.runs[0].headSha = 'b'.repeat(40);
assert.equal(evaluateBurnIn(tamperedReceipt, { minCompletedRuns: 1, minCalendarDays: 0 }).claimStatus, 'invalid-input');

console.log('ci-burn-in-evidence-collector: ok');

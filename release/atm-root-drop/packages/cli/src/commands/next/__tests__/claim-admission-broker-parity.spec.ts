/**
 * TASK-RFT-0011 spec — next.claim.admission.
 *
 * Covers parallel-safe + block matrix from both the broker verdict side and
 * the CID diagnostic side, plus the ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE
 * diagnostic (which should never fire in practice once next --claim consults
 * the same conflict-matrix as broker register, but is shipped for future
 * regression detection).
 */
import assert from 'node:assert/strict';
import {
  detectBrokerCidDivergence,
  evaluateClaimAdmission,
  isBrokerVerdictAdmissible
} from '../claim-admission.ts';

// --- broker verdict admissibility ---
assert.equal(isBrokerVerdictAdmissible('allow'), true);
assert.equal(isBrokerVerdictAdmissible('watch'), true);
assert.equal(isBrokerVerdictAdmissible('takeover'), true);
assert.equal(isBrokerVerdictAdmissible('freeze'), false);

// --- both admit → admitted, no divergence ---
const bothAdmit = evaluateClaimAdmission({
  brokerVerdict: 'allow',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-X-0001'
});
assert.equal(bothAdmit.admitted, true);
assert.equal(bothAdmit.divergence, null);
assert.equal(bothAdmit.blockCode, null);

// --- both block → blocked, no divergence ---
const bothBlock = evaluateClaimAdmission({
  brokerVerdict: 'freeze',
  cidVerdict: 'blocked-cid-conflict',
  candidateTaskId: 'TASK-X-0002',
  conflictingTaskId: 'TASK-Y-0002'
});
assert.equal(bothBlock.admitted, false);
assert.equal(bothBlock.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
assert.equal(bothBlock.divergence, null);
assert.match(bothBlock.blockReason ?? '', /TASK-Y-0002/);

// --- broker admits but CID blocks → divergence + broker wins (admitted) ---
const brokerAdmitsCidBlocks = evaluateClaimAdmission({
  brokerVerdict: 'allow',
  cidVerdict: 'blocked-cid-conflict',
  candidateTaskId: 'TASK-X-0003',
  conflictingTaskId: 'TASK-Y-0003'
});
assert.equal(brokerAdmitsCidBlocks.admitted, true, 'broker verdict wins the final decision');
assert.notEqual(brokerAdmitsCidBlocks.divergence, null);
assert.equal(brokerAdmitsCidBlocks.divergence?.code, 'ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE');
assert.equal(brokerAdmitsCidBlocks.divergence?.brokerVerdict, 'allow');
assert.equal(brokerAdmitsCidBlocks.divergence?.cidVerdict, 'blocked-cid-conflict');

// --- broker blocks but CID admits → divergence + broker wins (blocked) ---
const brokerBlocksCidAdmits = evaluateClaimAdmission({
  brokerVerdict: 'freeze',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-X-0004'
});
assert.equal(brokerBlocksCidAdmits.admitted, false);
assert.notEqual(brokerBlocksCidAdmits.divergence, null);
assert.equal(brokerBlocksCidAdmits.divergence?.code, 'ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE');

// --- overlap advisory ---
const overlapAdvisory = evaluateClaimAdmission({
  brokerVerdict: 'allow',
  cidVerdict: 'parallel-safe-with-cid-overlap-advisory',
  candidateTaskId: 'TASK-X-0005',
  conflictingTaskId: 'TASK-Y-0005',
  overlappingAtomIds: ['atom-A', 'atom-B']
});
assert.equal(overlapAdvisory.admitted, true);
assert.equal(overlapAdvisory.advisory?.kind, 'cid-overlap-advisory');
assert.equal(overlapAdvisory.divergence, null);

// --- takeover advisory ---
const takeover = evaluateClaimAdmission({
  brokerVerdict: 'takeover',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-X-0006'
});
assert.equal(takeover.admitted, true);
assert.equal(takeover.advisory?.kind, 'takeover-required');

// --- direct divergence detector ---
assert.equal(detectBrokerCidDivergence('allow', 'parallel-safe'), false);
assert.equal(detectBrokerCidDivergence('freeze', 'blocked-cid-conflict'), false);
assert.equal(detectBrokerCidDivergence('allow', 'blocked-cid-conflict'), true);
assert.equal(detectBrokerCidDivergence('freeze', 'parallel-safe'), true);
assert.equal(detectBrokerCidDivergence('freeze', 'parallel-safe-with-cid-overlap-advisory'), true);

console.log('[claim-admission-broker-parity.spec] ok');

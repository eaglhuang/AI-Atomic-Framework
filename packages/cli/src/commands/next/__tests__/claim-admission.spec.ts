import assert from 'node:assert/strict';
import {
  evaluateClaimAdmission,
  isBrokerVerdictAdmissible
} from '../claim-admission.ts';

assert.equal(isBrokerVerdictAdmissible('allow'), true);

const cleanImport = evaluateClaimAdmission({
  brokerVerdict: 'allow',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-RFT-0001'
});
assert.equal(cleanImport.admitted, true);
assert.equal(cleanImport.blockCode, null);

const blockedCid = evaluateClaimAdmission({
  brokerVerdict: 'freeze',
  cidVerdict: 'blocked-cid-conflict',
  candidateTaskId: 'TASK-RFT-0002',
  conflictingTaskId: 'TASK-RFT-0001',
  overlappingAtomIds: ['atm.next-command-atomic-map']
});
assert.equal(blockedCid.admitted, false);
assert.equal(blockedCid.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
assert.match(blockedCid.blockReason ?? '', /TASK-RFT-0001/);

const closeoutOnlyOk = evaluateClaimAdmission({
  brokerVerdict: 'watch',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-RFT-0003'
});
assert.equal(closeoutOnlyOk.admitted, true);

const before = JSON.stringify({
  brokerVerdict: 'allow',
  cidVerdict: 'parallel-safe',
  candidateTaskId: 'TASK-RFT-0004'
} as const);
const input = {
  brokerVerdict: 'allow' as const,
  cidVerdict: 'parallel-safe' as const,
  candidateTaskId: 'TASK-RFT-0004'
};
evaluateClaimAdmission(input);
assert.equal(JSON.stringify(input), before, 'admission policy must not mutate its input');

console.log('[claim-admission.spec] ok');

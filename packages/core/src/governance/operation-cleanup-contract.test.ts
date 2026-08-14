import assert from 'node:assert/strict';
import { createOperationCleanupReceipt, validateOperationCleanupReceipt } from './operation-cleanup-contract.ts';

const retained = createOperationCleanupReceipt({
  operationId: 'sealed-runner-publication',
  owner: { taskId: 'TASK-ONE', actorId: 'actor-one', laneSessionId: 'lane-one' },
  outcome: 'failed',
  disposition: 'recovery-retained',
  paths: [{ path: 'release/atm-onefile/atm.mjs', beforeDigest: 'sha256:before', afterDigest: 'sha256:after' }]
});
assert.equal(validateOperationCleanupReceipt(retained).ok, true);
assert.equal(retained.terminal, false);
assert.ok(retained.retryToken);

const restored = createOperationCleanupReceipt({
  owner: { taskId: 'TASK-ONE', actorId: 'actor-one', laneSessionId: null },
  outcome: 'succeeded',
  disposition: 'restored',
  paths: [{ path: 'packages/cli/dist/atm.js', beforeDigest: null, afterDigest: 'sha256:after' }]
});
assert.equal(validateOperationCleanupReceipt(restored).ok, true);
assert.equal(restored.retryToken, null);
assert.equal(validateOperationCleanupReceipt({ ...retained, digest: 'sha256:wrong' }).ok, false);
console.log('[operation-cleanup-contract] ok');

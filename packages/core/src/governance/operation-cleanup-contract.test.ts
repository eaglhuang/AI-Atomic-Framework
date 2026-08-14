import assert from 'node:assert/strict';
import { createOperationCleanupReceipt, validateOperationCleanupReceipt } from './operation-cleanup-contract.ts';

const scenarios = [
  { name: 'success', outcome: 'succeeded', disposition: 'restored' },
  { name: 'assertion-failure', outcome: 'failed', disposition: 'recovery-retained' },
  { name: 'process-exception', outcome: 'failed', disposition: 'recovery-retained' },
  { name: 'timeout', outcome: 'timed-out', disposition: 'recovery-retained' },
  { name: 'cancellation', outcome: 'cancelled', disposition: 'recovery-retained' },
  { name: 'stale-cas', outcome: 'failed', disposition: 'recovery-retained' },
  { name: 'interrupted-publication', outcome: 'failed', disposition: 'recovery-retained' }
] as const;

let retained: ReturnType<typeof createOperationCleanupReceipt> | null = null;
for (const scenario of scenarios) {
  const receipt = createOperationCleanupReceipt({
    operationId: `operation-${scenario.name}`,
    owner: { taskId: 'TASK-ONE', actorId: 'actor-one', laneSessionId: scenario.name === 'success' ? null : 'lane-one' },
    outcome: scenario.outcome,
    disposition: scenario.disposition,
    paths: [{ path: `release/${scenario.name}.json`, beforeDigest: 'sha256:before', afterDigest: 'sha256:after' }]
  });
  assert.equal(validateOperationCleanupReceipt(receipt).ok, true, `${scenario.name} receipt must be digest-valid`);
  assert.equal(receipt.terminal, scenario.disposition === 'restored', `${scenario.name} terminal state must match disposition`);
  assert.equal(receipt.retryToken === null, scenario.disposition === 'restored', `${scenario.name} retry token must match resumability`);
  if (scenario.disposition === 'recovery-retained') retained = receipt;
}

assert.ok(retained);
assert.equal(validateOperationCleanupReceipt({ ...retained, digest: 'sha256:wrong' }).ok, false);
console.log('[operation-cleanup-contract] ok');

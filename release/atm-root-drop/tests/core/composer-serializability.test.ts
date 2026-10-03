import assert from 'node:assert/strict';
import { composeTransactionalMutations } from '../../packages/core/src/broker/transactional-composer.ts';
import { jsonRecordAdapter } from '../../packages/core/src/broker/adapters/json-record.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

function mutation(requestId: string, target: string, value: unknown): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    requestId,
    actorId: requestId,
    taskId: 'ATM-GOV-0212',
    transactionId: `tx-${requestId}`,
    filePath: 'registry.json',
    op: 'upsert',
    target,
    value
  };
}

const first = composeTransactionalMutations({
  files: [{ filePath: 'registry.json', content: '{\n  "records": {}\n}\n' }],
  requests: [
    mutation('r-c', '/records/c', 3),
    mutation('r-a', '/records/a', 1),
    mutation('r-b', '/records/b', 2)
  ]
});

const second = composeTransactionalMutations({
  files: [{ filePath: 'registry.json', content: '{\n  "records": {}\n}\n' }],
  requests: [
    mutation('r-b', '/records/b', 2),
    mutation('r-c', '/records/c', 3),
    mutation('r-a', '/records/a', 1)
  ]
});

assert.equal(first.plan.serializabilityProof.permutationStable, true);
assert.equal(first.plan.serializabilityProof.equivalentOutputHash, second.plan.serializabilityProof.equivalentOutputHash);
assert.deepEqual(first.plan.selectedRequestIds, ['r-a', 'r-b', 'r-c']);
assert.deepEqual(first.plan.memberAttribution.map((entry) => entry.transactionIds[0]), ['tx-r-a', 'tx-r-b', 'tx-r-c']);
assert.equal(first.plan.rollback.strategy, 'discard-temp-tree');

// An adapter can claim mergeability incorrectly. The proof must independently
// observe real operation orders rather than sorting each permutation again.
const orderSensitive = composeTransactionalMutations({
  files: [{ filePath: 'registry.json', content: '{}' }],
  requests: [mutation('r-a', '/a', 'first'), mutation('r-b', '/b', 'second')],
  adapters: [{
    ...jsonRecordAdapter,
    id: 'order-sensitive-fixture',
    merge(mutations, parsed) {
      return { ...parsed, value: { applied: mutations.map(entry => entry.requestId) } };
    }
  }]
});
assert.equal(orderSensitive.plan.serializabilityProof.permutationStable, false,
  'different execution order must invalidate the permutation proof');
assert.ok(orderSensitive.plan.serializabilityProof.checkedPermutationCount >= 2);

console.log('[composer-serializability] ok');

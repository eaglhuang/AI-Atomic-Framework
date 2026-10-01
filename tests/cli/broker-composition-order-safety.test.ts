import assert from 'node:assert/strict';
import { composeTransactionalMutations } from '../../packages/core/src/broker/transactional-composer.ts';
import { jsonRecordAdapter } from '../../packages/core/src/broker/adapters/json-record.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

const file = { filePath: 'data.json', content: '{"a":{}}' };
const request = (id: string, target: string, value: unknown): MutationRequest => ({
  schemaId: 'atm.mutationRequest.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(),
  requestId: id, actorId: id, filePath: file.filePath, op: 'upsert', target, value
});
for (const pair of [
  [request('parent', '/a', { c: 1 }), request('child', '/a/b', 2)],
  [request('root', '', {}), request('child', '/a/b', 2)],
  [request('escaped-parent', '/a~1b', {}), request('escaped-child', '/a~1b/c', 2)]
]) {
  for (const ordered of [pair, [...pair].reverse()]) {
    const parsed = jsonRecordAdapter.parse(file);
    assert.equal(jsonRecordAdapter.canMerge(ordered.map(r => jsonRecordAdapter.normalize(r)), parsed).verdict, 'conflict');
    const result = composeTransactionalMutations({ files: [file], requests: ordered });
    assert.equal(result.plan.selectedRequestIds.length, 1);
    assert.equal(result.plan.skippedRequestIds.length, 1);
  }
}
const independent = [request('one', '/a/b', 1), request('two', '/a/c', 2)];
const composed = composeTransactionalMutations({ files: [file], requests: independent });
assert.equal(composed.plan.selectedRequestIds.length, 2);
assert.equal(composed.plan.serializabilityProof.permutationStable, true);
assert.deepEqual(JSON.parse(composed.outputFiles[0].content), { a: { b: 1, c: 2 } });

// An order-sensitive adapter must not be "proved" commutative by resorting inputs.
const orderSensitive = {
  ...jsonRecordAdapter,
  canMerge: () => ({ schemaId: 'atm.mergeDecision.v1' as const, specVersion: '0.1.0' as const,
    migration: { strategy: 'none' as const, fromVersion: null, notes: '' },
    verdict: 'mergeable' as const, reason: 'negative control', conflictKeys: [] }),
  merge: (mutations: any[], parsed: any) => ({ ...parsed, value: mutations.map(r => r.requestId) })
};
const negative = composeTransactionalMutations({ files: [file], requests: independent, adapters: [orderSensitive] });
assert.equal(negative.plan.serializabilityProof.checkedPermutationCount, 2);
assert.equal(negative.plan.serializabilityProof.permutationStable, false);
console.log('ok: real permutation negative, parent/root/escaped collisions, independent edits preserved');

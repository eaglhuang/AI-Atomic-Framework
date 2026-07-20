import assert from 'node:assert/strict';
import { composeTransactionalMutations } from '../../packages/core/src/broker/transactional-composer.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

function request(overrides: Partial<MutationRequest> & Pick<MutationRequest, 'requestId' | 'filePath' | 'op' | 'target'>): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    actorId: 'actor-a',
    taskId: 'ATM-GOV-0212',
    value: 'fallback',
    ...overrides
  };
}

const result = composeTransactionalMutations({
  files: [
    { filePath: 'docs/a.md', content: '# A\nalpha\n# B\nbeta\n' },
    { filePath: 'data/a.json', content: '{\n  "items": {}\n}\n' }
  ],
  requests: [
    request({ requestId: 'r-json-a', filePath: 'data/a.json', op: 'upsert', target: '/items/a', value: { ready: true } }),
    request({ requestId: 'r-json-b', filePath: 'data/a.json', op: 'upsert', target: '/items/b', value: { ready: true } }),
    request({ requestId: 'r-text-a', filePath: 'docs/a.md', op: 'insertAfterHeading', target: '# A', value: 'inserted-a' }),
    request({ requestId: 'r-text-b', filePath: 'docs/a.md', op: 'insertAfterHeading', target: '# B', value: 'inserted-b' })
  ],
  validators: ['npm run typecheck']
});

assert.equal(result.ok, true);
assert.deepEqual(result.plan.selectedRequestIds, ['r-json-a', 'r-json-b', 'r-text-a', 'r-text-b']);
assert.deepEqual(result.plan.skippedRequestIds, []);
assert.equal(result.plan.rollback.liveWorktreeMutation, false);
assert.equal(result.plan.rollback.tempTreeMutation, false);
assert.equal(result.plan.serializabilityProof.permutationStable, true);
assert.ok(result.plan.serializabilityProof.checkedPermutationCount > 1);
assert.equal(result.outputFiles.find((file) => file.filePath === 'docs/a.md')?.content, '# A\ninserted-a\nalpha\n# B\ninserted-b\nbeta\n');
assert.match(result.outputFiles.find((file) => file.filePath === 'data/a.json')?.content ?? '', /"a"/);
assert.equal(result.plan.fileSlices.length, 2);
assert.equal(result.plan.memberAttribution.every((entry) => entry.verdict === 'selected'), true);

const conflict = composeTransactionalMutations({
  files: [{ filePath: 'docs/a.md', content: '# A\nalpha\n' }],
  requests: [
    request({ requestId: 'r-first', filePath: 'docs/a.md', op: 'replaceRange', target: '2:2', value: 'first' }),
    request({ requestId: 'r-second', filePath: 'docs/a.md', op: 'replaceRange', target: '2:2', value: 'second' })
  ]
});

assert.equal(conflict.ok, true);
assert.deepEqual(conflict.plan.selectedRequestIds, ['r-first']);
assert.deepEqual(conflict.plan.skippedRequestIds, ['r-second']);
assert.deepEqual(conflict.plan.rollback.returnedQueueRequestIds, ['r-second']);
assert.equal(conflict.outputFiles.find((file) => file.filePath === 'docs/a.md')?.content, '# A\nfirst\n');

console.log('[transactional-bounded-composer] ok');

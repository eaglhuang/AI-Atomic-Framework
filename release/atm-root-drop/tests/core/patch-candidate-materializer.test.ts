import assert from 'node:assert/strict';
import {
  materializePatchCandidate,
  sealValidatorSelection
} from '../../packages/core/src/broker/patch-candidate-materializer.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

function mutation(
  overrides: Partial<MutationRequest> & Pick<MutationRequest, 'requestId' | 'target' | 'value'>
): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    actorId: overrides.actorId ?? 'worker-a',
    taskId: overrides.taskId ?? 'TASK-DEMO',
    filePath: 'registry.json',
    op: 'upsert',
    ...overrides
  };
}

const baseContent = '{\n  "records": {}\n}\n';

const sealed = sealValidatorSelection({
  cardValidators: ['card.check'],
  adapterStaticChecks: ['adapter.static'],
  catalogTargetedTests: ['catalog.targeted']
});
assert.deepEqual(sealed.requiredValidatorIds, ['adapter.static', 'card.check', 'catalog.targeted']);
const drifted = sealValidatorSelection({
  cardValidators: ['card.check', 'card.extra'],
  adapterStaticChecks: ['adapter.static'],
  catalogTargetedTests: ['catalog.targeted']
});
assert.notEqual(drifted.sealedSelectionSourceDigest, sealed.sealedSelectionSourceDigest);

const positive = materializePatchCandidate({
  baseHeadSha: 'abc123',
  baseFiles: [{ filePath: 'registry.json', content: baseContent }],
  requests: [
    mutation({ requestId: 'req-a', actorId: 'worker-a', target: '/records/a', value: { ok: true } }),
    mutation({ requestId: 'req-b', actorId: 'worker-b', target: '/records/b', value: { ok: true } })
  ],
  cardValidators: ['semantic.safe'],
  adapterStaticChecks: [],
  catalogTargetedTests: []
});
assert.equal(positive.ok, true);
assert.equal(positive.liveWorktreeMutation, false);
assert.match(positive.candidateDigest, /^sha256:[a-f0-9]{64}$/i);
assert.equal(positive.serializabilityProofPresent, true);
assert.deepEqual(positive.sealedSelection.requiredValidatorIds, ['semantic.safe']);
assert.equal(positive.memberAttribution.length, 2);

// Disjoint keys remain serializable; materialization still binds an exact digest
// that semantic validation must check before steward apply.
const semanticBreakBase = {
  baseHeadSha: 'def456',
  baseFiles: [{ filePath: 'registry.json', content: baseContent }],
  requests: [
    mutation({ requestId: 'req-left', actorId: 'worker-a', target: '/records/left', value: { ok: true } }),
    mutation({ requestId: 'req-right', actorId: 'worker-b', target: '/records/right', value: { ok: true } })
  ],
  cardValidators: ['semantic.break'],
  adapterStaticChecks: [],
  catalogTargetedTests: []
};
const negativeMaterialized = materializePatchCandidate(semanticBreakBase);
assert.equal(negativeMaterialized.ok, true);
assert.equal(negativeMaterialized.serializabilityProofPresent, true);
assert.notEqual(negativeMaterialized.candidateDigest, positive.candidateDigest);

const missingBase = materializePatchCandidate({
  baseHeadSha: '',
  baseFiles: [{ filePath: 'registry.json', content: baseContent }],
  requests: [mutation({ requestId: 'req-a', target: '/records/a', value: { ok: true } })]
});
assert.equal(missingBase.ok, false);
assert.ok(missingBase.reasons.includes('missing-base-head-sha'));

console.log('patch-candidate-materializer.test passed');

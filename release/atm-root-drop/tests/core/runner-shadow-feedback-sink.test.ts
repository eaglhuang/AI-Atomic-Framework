import assert from 'node:assert/strict';
import { InMemoryRunnerShadowFeedbackSink } from '../../packages/core/src/broker/runner-shadow-feedback-sink.ts';
import { selectRunnerVersionWithReceipt, createRunnerVersionRegistry, type PublishedRunnerVersion } from '../../packages/core/src/broker/runner-version-registry.ts';

const version: PublishedRunnerVersion = {
  sealedSourceSha: 'a'.repeat(40),
  aggregateInputTreeHash: 'sha256:' + '1'.repeat(64),
  publishedSurfaces: ['release/atm-onefile/atm.mjs'],
  publishedAt: '2026-07-29T00:00:00.000Z',
  lifecycleState: 'published',
  compatibilityKey: 'runner-abi-1',
  capabilityProof: { validators: ['typecheck'], schemas: ['atm.runnerVersionSelectionReceipt.v1'] }
};

const registry = createRunnerVersionRegistry([version]);
const requirement = { sealedSourceSha: version.sealedSourceSha, requiredSurfaces: ['release/atm-onefile/atm.mjs'] };
const issuedAt = '2026-07-29T01:00:00.000Z';
const sink = new InMemoryRunnerShadowFeedbackSink();

const withoutSink = selectRunnerVersionWithReceipt(registry, requirement, issuedAt);
const withSink = selectRunnerVersionWithReceipt(registry, requirement, issuedAt, { shadowFeedbackSink: sink });

assert.equal(withSink.selectionDigest, withoutSink.selectionDigest);
assert.deepEqual(withSink, withoutSink);
assert.equal(sink.readAll().length, 1);
assert.equal(sink.readAll()[0]?.runnerReceiptDigest, withSink.selectionDigest);

const observations = sink.readAll();
(observations as unknown as Array<{ kind: string }>)[0].kind = 'mutated-copy';
assert.equal(sink.readAll()[0]?.kind, 'runner-version-selection');

console.log('runner-shadow-feedback-sink.test.ts: 5 cases passed');

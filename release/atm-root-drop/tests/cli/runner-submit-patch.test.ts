// TASK-MAO-0016: tests for the runner submit-patch pipeline.
import assert from 'node:assert/strict';
import { createPatchEnvelope } from '../../packages/core/src/broker/patch-envelope.ts';
import { annotateForAtmCore } from '../../packages/core/src/broker/patch-envelope-atm-core.ts';
import { createEmptyRunnerRefStore, publishRunnerRef } from '../../packages/core/src/broker/runner-ref-store.ts';
import { submitRunnerPatch } from '../../packages/core/src/broker/runner-submit-pipeline.ts';

function inDevHeadStore(headCommit: string) {
  return publishRunnerRef(createEmptyRunnerRefStore(), {
    refName: 'in-dev/HEAD',
    kind: 'control',
    sourceCommit: headCommit,
    artifactSha256: 'sha256:dummy',
    publisherActorId: 'runner-steward'
  }).store;
}

function envelopeAt(declared: string | null) {
  return annotateForAtmCore(
    createPatchEnvelope({
      taskId: 'TASK-X',
      actorId: 'actor',
      freezeId: 'freeze',
      patchText: 'diff',
      targetFiles: ['x.ts'],
      wipState: 'complete',
      confidence: 'high'
    }),
    {
      scopeClass: 'atm-core',
      publishIntent: 'in-dev-bump',
      targetRunnerRef: 'in-dev/HEAD',
      declaredSourceCommit: declared
    }
  );
}

function testAcceptOnMatchingBase() {
  const store = inDevHeadStore('commit-a');
  const decision = submitRunnerPatch({ envelope: envelopeAt('commit-a'), refStore: store });
  assert.equal(decision.verdict, 'accept');
  assert.equal(decision.resolvedTargetRefHead, 'commit-a');
}

function testRejectStaleBase() {
  const store = inDevHeadStore('commit-b');
  const decision = submitRunnerPatch({ envelope: envelopeAt('commit-a'), refStore: store });
  assert.equal(decision.verdict, 'reject-stale-base');
}

function testFreezeAwaitsWhenTargetFrozen() {
  const store = inDevHeadStore('commit-a');
  const decision = submitRunnerPatch({
    envelope: envelopeAt('commit-a'),
    refStore: store,
    frozenRefs: ['in-dev/HEAD']
  });
  assert.equal(decision.verdict, 'freeze-await-rebase');
}

function testRejectMalformedAnnotation() {
  // version-publish without targetRunnerRef → malformed
  const malformed = annotateForAtmCore(
    createPatchEnvelope({
      taskId: 'T',
      actorId: 'a',
      freezeId: 'f',
      patchText: 'd',
      targetFiles: ['x'],
      wipState: 'complete',
      confidence: 'high'
    }),
    { scopeClass: 'atm-core', publishIntent: 'version-publish' }
  );
  const decision = submitRunnerPatch({
    envelope: malformed,
    refStore: createEmptyRunnerRefStore()
  });
  assert.equal(decision.verdict, 'reject-malformed');
}

testAcceptOnMatchingBase();
testRejectStaleBase();
testFreezeAwaitsWhenTargetFrozen();
testRejectMalformedAnnotation();

console.log('runner submit patch tests: ok');

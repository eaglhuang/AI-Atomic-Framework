// TASK-MAO-0021: complement to the fixture-driven validator. Asserts the
// canonical failure-mode set the runner broker primitives must handle, so a
// regression in any primitive shows up here even if no fixture matches it yet.
import assert from 'node:assert/strict';
import { createPatchEnvelope } from '../patch-envelope.js';
import { annotateForAtmCore } from '../patch-envelope-atm-core.js';
import { createEmptyRunnerRefStore, publishRunnerRef } from '../runner-ref-store.js';
import { submitRunnerPatch } from '../runner-submit-pipeline.js';
import { analyzeBootstrap } from '../runner-bootstrap.js';
import { createRunnerVersionStream } from '../runner-version-state.js';
function baseEnvelope() {
    return createPatchEnvelope({
        taskId: 'T',
        actorId: 'a',
        freezeId: 'f',
        patchText: 'd',
        targetFiles: ['x'],
        wipState: 'complete',
        confidence: 'high'
    });
}
function testRejectMalformedFamily() {
    // malformed annotation: in-dev-bump without targetRunnerRef
    const env = annotateForAtmCore(baseEnvelope(), {
        scopeClass: 'atm-core',
        publishIntent: 'in-dev-bump'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: createEmptyRunnerRefStore() });
    assert.equal(d.verdict, 'reject-malformed');
}
function testStaleBaseFamily() {
    const store = publishRunnerRef(createEmptyRunnerRefStore(), {
        refName: 'in-dev/HEAD',
        kind: 'control',
        sourceCommit: 'new',
        artifactSha256: 'sha256:x',
        publisherActorId: 's'
    }).store;
    const env = annotateForAtmCore(baseEnvelope(), {
        scopeClass: 'atm-core',
        publishIntent: 'in-dev-bump',
        targetRunnerRef: 'in-dev/HEAD',
        declaredSourceCommit: 'old'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: store });
    assert.equal(d.verdict, 'reject-stale-base');
}
function testFreezeFamily() {
    const store = publishRunnerRef(createEmptyRunnerRefStore(), {
        refName: 'in-dev/HEAD',
        kind: 'control',
        sourceCommit: 'a',
        artifactSha256: 'sha256:x',
        publisherActorId: 's'
    }).store;
    const env = annotateForAtmCore(baseEnvelope(), {
        scopeClass: 'atm-core',
        publishIntent: 'in-dev-bump',
        targetRunnerRef: 'in-dev/HEAD',
        declaredSourceCommit: 'a'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: store, frozenRefs: ['in-dev/HEAD'] });
    assert.equal(d.verdict, 'freeze-await-rebase');
}
function testBootstrapEmptyStoreSuggestsReseed() {
    const plan = analyzeBootstrap({
        refStore: createEmptyRunnerRefStore(),
        stream: createRunnerVersionStream('runner'),
        reachableSourceCommits: new Set()
    });
    assert.equal(plan.decision, 'reseed-from-version');
}
testRejectMalformedFamily();
testStaleBaseFamily();
testFreezeFamily();
testBootstrapEmptyStoreSuggestsReseed();
console.log('runner failure modes tests: ok');

// TASK-MAO-0021: complement to the fixture-driven validator. Asserts the
// canonical failure-mode set the runner broker primitives must handle, so a
// regression in any primitive shows up here even if no fixture matches it yet.
import assert from 'node:assert/strict';
import { createPatchEnvelope } from '../patch-envelope.js';
import { annotateForAtmCore } from '../patch-envelope-atm-core.js';
import { createEmptyRunnerRefStore, publishRunnerRef } from '../runner-ref-store.js';
import { submitRunnerPatch } from '../runner-submit-pipeline.js';
import { analyzeBootstrap } from '../runner-bootstrap.js';
import { createRunnerVersionStream, transitionRunnerVersion } from '../runner-version-state.js';
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
function testReleaseOnlyDiffRejected() {
    const env = annotateForAtmCore(createPatchEnvelope({
        taskId: 'T',
        actorId: 'a',
        freezeId: 'f',
        targetFiles: ['release/atm-onefile/atm.mjs'],
        patchText: 'diff --git a/release/atm-onefile/atm.mjs b/release/atm-onefile/atm.mjs',
        wipState: 'complete',
        confidence: 'high'
    }), {
        scopeClass: 'release-only',
        publishIntent: 'patch-only'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: createEmptyRunnerRefStore() });
    assert.equal(d.verdict, 'reject-malformed');
    assert.match(d.reason, /release-only scope/);
}
function testInDevBumpRejectsVersionRefTarget() {
    const env = annotateForAtmCore(baseEnvelope(), {
        scopeClass: 'atm-core',
        publishIntent: 'in-dev-bump',
        targetRunnerRef: 'v0.1.0'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: createEmptyRunnerRefStore() });
    assert.equal(d.verdict, 'reject-malformed');
}
function testVersionPublishRequiresTarget() {
    const env = annotateForAtmCore(baseEnvelope(), {
        scopeClass: 'atm-core',
        publishIntent: 'version-publish'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: createEmptyRunnerRefStore() });
    assert.equal(d.verdict, 'reject-malformed');
}
function testPatchOnlyAcceptsIntoStewardLane() {
    const env = annotateForAtmCore(baseEnvelope(), {
        scopeClass: 'atm-core',
        publishIntent: 'patch-only'
    });
    const d = submitRunnerPatch({ envelope: env, refStore: createEmptyRunnerRefStore() });
    assert.equal(d.verdict, 'accept');
    assert.match(d.suggestedNextAction, /steward rebuild lane/);
}
function testPublishedStreamWithStaleLeaseQuarantines() {
    const published = transitionRunnerVersion(transitionRunnerVersion(transitionRunnerVersion(createRunnerVersionStream('runner'), 'cut-rc', 'steward').record, 'freeze-rc', 'steward').record, 'publish', 'steward').record;
    const store = publishRunnerRef(createEmptyRunnerRefStore(), {
        refName: 'v0.1.0',
        kind: 'version',
        sourceCommit: 'published',
        artifactSha256: 'sha256:p',
        publisherActorId: 'steward'
    }).store;
    const plan = analyzeBootstrap({
        refStore: store,
        stream: {
            ...published,
            lease: { heldBy: 'stale-steward', heldUntil: '2099-01-01T00:00:00.000Z' }
        },
        reachableSourceCommits: new Set(['published'])
    });
    assert.equal(plan.decision, 'quarantine');
    assert.ok(plan.findings.some((finding) => finding.code === 'lease-held-but-state-published'));
}
testRejectMalformedFamily();
testStaleBaseFamily();
testFreezeFamily();
testBootstrapEmptyStoreSuggestsReseed();
testReleaseOnlyDiffRejected();
testInDevBumpRejectsVersionRefTarget();
testVersionPublishRequiresTarget();
testPatchOnlyAcceptsIntoStewardLane();
testPublishedStreamWithStaleLeaseQuarantines();
console.log('runner failure modes tests: ok');

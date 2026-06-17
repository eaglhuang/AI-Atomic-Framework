// TASK-MAO-0015: tests for the ATM core specialization of the patch envelope.
import assert from 'node:assert/strict';
import { createPatchEnvelope } from '../patch-envelope.js';
import { annotateForAtmCore, validateAtmCorePatchEnvelope } from '../patch-envelope-atm-core.js';
function base(over = {}) {
    return createPatchEnvelope({
        taskId: 'TASK-X',
        actorId: 'actor-x',
        freezeId: 'freeze-x',
        targetFiles: ['packages/core/src/foo.ts'],
        patchText: 'diff --git a/foo b/foo',
        wipState: 'complete',
        confidence: 'high',
        ...over
    });
}
function testValidVersionPublishAnnotationPasses() {
    const env = annotateForAtmCore(base(), {
        scopeClass: 'atm-core',
        publishIntent: 'version-publish',
        targetRunnerRef: 'v0.2.0',
        declaredSourceCommit: 'abc123'
    });
    assert.equal(validateAtmCorePatchEnvelope(env).ok, true);
}
function testVersionPublishWithoutTargetFails() {
    const env = annotateForAtmCore(base(), {
        scopeClass: 'atm-core',
        publishIntent: 'version-publish'
    });
    const r = validateAtmCorePatchEnvelope(env);
    assert.equal(r.ok, false);
    assert.match(r.reason, /targetRunnerRef/);
}
function testInDevBumpRequiresInDevPrefix() {
    const wrong = annotateForAtmCore(base(), {
        scopeClass: 'atm-core',
        publishIntent: 'in-dev-bump',
        targetRunnerRef: 'v0.2.0'
    });
    assert.equal(validateAtmCorePatchEnvelope(wrong).ok, false);
    const ok = annotateForAtmCore(base(), {
        scopeClass: 'atm-core',
        publishIntent: 'in-dev-bump',
        targetRunnerRef: 'in-dev/HEAD'
    });
    assert.equal(validateAtmCorePatchEnvelope(ok).ok, true);
}
function testReleaseOnlyScopeRejectsTextualDiff() {
    const env = annotateForAtmCore(base({ patchText: 'diff --git a/foo b/foo' }), {
        scopeClass: 'release-only',
        publishIntent: 'patch-only'
    });
    const r = validateAtmCorePatchEnvelope(env);
    assert.equal(r.ok, false);
    assert.match(r.reason, /release-only/);
}
testValidVersionPublishAnnotationPasses();
testVersionPublishWithoutTargetFails();
testInDevBumpRequiresInDevPrefix();
testReleaseOnlyScopeRejectsTextualDiff();
console.log('patch envelope atm core tests: ok');

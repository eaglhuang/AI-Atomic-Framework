import assert from 'node:assert/strict';
import { createFreezeSignal, acknowledgeFreeze, resolveFreezeDecision, resolveFreezeSnapshotDefaults, resumeFreeze, markBlockedFallback } from '../freeze.js';
import { createPatchEnvelope, isMetadataOnlyEnvelope, validatePatchEnvelope } from '../patch-envelope.js';
function testFreezeAckBeforeTimeout() {
    const signal = createFreezeSignal({
        taskId: 'TASK-FREEZE',
        actorId: 'agent-a',
        now: Date.parse('2026-06-12T08:00:00.000Z')
    });
    const ack = acknowledgeFreeze(signal, { now: Date.parse('2026-06-12T08:00:10.000Z') });
    const decision = resolveFreezeDecision({ signal, acknowledgedAt: ack.acknowledgedAt, now: Date.parse('2026-06-12T08:00:10.000Z') });
    assert.equal(decision.decision.state, 'acknowledged');
    assert.equal(decision.forceRelease, false);
}
function testFreezeTimeoutForcesRelease() {
    const signal = createFreezeSignal({
        taskId: 'TASK-FREEZE-TIMEOUT',
        actorId: 'agent-a',
        now: Date.parse('2026-06-12T08:00:00.000Z'),
        ackTimeoutMs: 1_000
    });
    const decision = resolveFreezeDecision({
        signal,
        acknowledgedAt: null,
        now: Date.parse('2026-06-12T08:00:02.000Z')
    });
    assert.equal(decision.decision.state, 'timed-out');
    assert.equal(decision.forceRelease, true);
}
function testMetadataOnlyPatchEnvelopeIsAllowedForPartialWip() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-PATCH',
        actorId: 'agent-a',
        freezeId: 'freeze-1',
        patchText: null,
        wipState: 'partial',
        confidence: 'low',
        partialReason: 'filesystem snapshot only'
    });
    assert.equal(envelope.mode, 'metadata-only');
    assert.equal(isMetadataOnlyEnvelope(envelope), true);
    assert.equal(validatePatchEnvelope(envelope).ok, true);
}
function testTextualDiffEnvelopeCarriesPatchText() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-PATCH-DIFF',
        actorId: 'agent-a',
        freezeId: 'freeze-2',
        patchText: 'diff --git a/foo b/foo',
        wipState: 'complete',
        confidence: 'high'
    });
    assert.equal(envelope.mode, 'textual-diff');
    assert.equal(validatePatchEnvelope(envelope).ok, true);
}
function testSnapshotDefaultsAreStable() {
    const defaults = resolveFreezeSnapshotDefaults();
    assert.equal(defaults.ackTimeoutMs, 30_000);
    assert.equal(defaults.snapshotDir, '.atm/runtime/wip-snapshot');
}
function testResumeRequiresAdmissionRecheck() {
    const signal = createFreezeSignal({
        taskId: 'TASK-RESUME',
        actorId: 'agent-a',
        now: Date.parse('2026-06-12T08:00:00.000Z')
    });
    const resumed = resumeFreeze(signal, { now: Date.parse('2026-06-12T08:00:05.000Z') });
    assert.equal(resumed.decision.state, 'resumed');
    assert.equal(resumed.forceRelease, false);
    assert.equal(resumed.requireAdmissionRecheck, true);
    assert.ok(resumed.decision.reason.includes('admission must be re-checked'));
    const reentered = resumeFreeze(signal, { now: Date.parse('2026-06-12T08:00:06.000Z'), admissionRechecked: true });
    assert.equal(reentered.decision.state, 'resumed');
    assert.equal(reentered.requireAdmissionRecheck, false);
    assert.ok(reentered.decision.reason.includes('admission recheck'));
}
function testBlockedFallbackOnRepeatedConflict() {
    const signal = createFreezeSignal({
        taskId: 'TASK-BLOCKED',
        actorId: 'agent-a',
        now: Date.parse('2026-06-12T08:00:00.000Z')
    });
    const blocked = markBlockedFallback(signal, {
        now: Date.parse('2026-06-12T08:00:30.000Z'),
        repeatedConflict: { blockingTask: 'TASK-B', blockingRoute: 'route-main', conflictingResource: 'src/one.ts' }
    });
    assert.equal(blocked.decision.state, 'blocked-fallback');
    assert.equal(blocked.forceRelease, false);
    assert.ok(blocked.decision.reason.includes('TASK-B'));
    assert.ok(blocked.decision.reason.includes('route-main'));
    assert.ok(blocked.decision.reason.includes('src/one.ts'));
    assert.ok(blocked.decision.reason.includes('does not delete worktree changes'));
}
function testFreezeDiagnosticsNameConflict() {
    const signal = createFreezeSignal({
        taskId: 'TASK-DIAG',
        actorId: 'agent-a',
        now: Date.parse('2026-06-12T08:00:00.000Z'),
        blockingTask: 'TASK-OWNER',
        blockingRoute: 'route-alpha',
        conflictingResource: 'packages/core/src/broker/freeze.ts'
    });
    assert.equal(signal.blockingTask, 'TASK-OWNER');
    assert.equal(signal.blockingRoute, 'route-alpha');
    assert.equal(signal.conflictingResource, 'packages/core/src/broker/freeze.ts');
    const decision = resolveFreezeDecision({ signal, acknowledgedAt: null, now: Date.parse('2026-06-12T08:00:05.000Z') });
    const reason = decision.decision.reason;
    assert.ok(reason.includes('blockingTask=TASK-OWNER'));
    assert.ok(reason.includes('blockingRoute=route-alpha'));
    assert.ok(reason.includes('conflictingResource=packages/core/src/broker/freeze.ts'));
}
testFreezeAckBeforeTimeout();
testFreezeTimeoutForcesRelease();
testMetadataOnlyPatchEnvelopeIsAllowedForPartialWip();
testTextualDiffEnvelopeCarriesPatchText();
testSnapshotDefaultsAreStable();
testResumeRequiresAdmissionRecheck();
testBlockedFallbackOnRepeatedConflict();
testFreezeDiagnosticsNameConflict();
console.log('freeze protocol tests: ok');

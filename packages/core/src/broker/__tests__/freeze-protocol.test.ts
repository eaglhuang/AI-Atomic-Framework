import assert from 'node:assert/strict';
import { createFreezeSignal, acknowledgeFreeze, resolveFreezeDecision, resolveFreezeSnapshotDefaults } from '../freeze.ts';
import { createPatchEnvelope, isMetadataOnlyEnvelope, validatePatchEnvelope } from '../patch-envelope.ts';

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

testFreezeAckBeforeTimeout();
testFreezeTimeoutForcesRelease();
testMetadataOnlyPatchEnvelopeIsAllowedForPartialWip();
testTextualDiffEnvelopeCarriesPatchText();
testSnapshotDefaultsAreStable();

console.log('freeze protocol tests: ok');

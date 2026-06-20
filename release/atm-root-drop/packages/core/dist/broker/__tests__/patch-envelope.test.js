import assert from 'node:assert/strict';
import { createPatchEnvelope, createHandoffPatchEnvelope, isMetadataOnlyEnvelope, validatePatchEnvelope, summarizePatchEnvelope, comparePatchEnvelopes } from '../index.js';
function testValidTextualDiffEnvelopePasses() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-A',
        actorId: 'agent-a',
        freezeId: 'freeze-1',
        patchText: 'diff --git a/foo b/foo',
        wipState: 'complete',
        confidence: 'high',
        targetFiles: ['foo']
    });
    assert.equal(envelope.mode, 'textual-diff');
    assert.equal(envelope.wipState, 'complete');
    assert.equal(validatePatchEnvelope(envelope).ok, true);
}
function testPartialWipMetadataOnlyEnvelopePasses() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-B',
        actorId: 'agent-b',
        freezeId: 'freeze-2',
        patchText: null,
        wipState: 'partial',
        confidence: 'low',
        partialReason: 'filesystem snapshot only'
    });
    assert.equal(envelope.mode, 'metadata-only');
    assert.equal(isMetadataOnlyEnvelope(envelope), true);
    const result = validatePatchEnvelope(envelope);
    assert.equal(result.ok, true);
    assert.ok(result.reason.includes('partial WIP'));
}
function testMissingTaskIdFails() {
    const envelope = createPatchEnvelope({
        taskId: '',
        actorId: 'agent-a',
        freezeId: 'freeze-3',
        patchText: 'diff'
    });
    const result = validatePatchEnvelope(envelope);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('taskId'));
}
function testMissingActorIdFails() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-C',
        actorId: '   ',
        freezeId: 'freeze-4',
        patchText: 'diff'
    });
    const result = validatePatchEnvelope(envelope);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('actorId'));
}
function testMissingFreezeIdFails() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-D',
        actorId: 'agent-d',
        freezeId: '',
        patchText: 'diff'
    });
    const result = validatePatchEnvelope(envelope);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('freezeId'));
}
function testTextualDiffEnvelopeRequiresPatchText() {
    const malformed = {
        schemaId: 'atm.patchEnvelope.v1',
        specVersion: '0.1.0',
        envelopeId: 'envelope-malformed',
        taskId: 'TASK-E',
        actorId: 'agent-e',
        mode: 'textual-diff',
        wipState: 'complete',
        snapshotDir: '.atm/runtime/wip-snapshot',
        targetFiles: [],
        patchText: null,
        metadata: {
            freezeId: 'freeze-5',
            capturedAt: '2026-06-16T00:00:00.000Z',
            confidence: 'high',
            partialReason: null
        }
    };
    const result = validatePatchEnvelope(malformed);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('textual-diff'));
}
function testSummarizeProducesStableDigest() {
    const envelope = createPatchEnvelope({
        taskId: 'TASK-SUM',
        actorId: 'agent-sum',
        freezeId: 'freeze-sum',
        patchText: 'diff --git a/x b/x',
        wipState: 'complete',
        confidence: 'medium',
        targetFiles: ['x', 'y'],
        capturedAt: '2026-06-16T01:23:45.000Z'
    });
    const summary = summarizePatchEnvelope(envelope);
    assert.equal(summary.taskId, 'TASK-SUM');
    assert.equal(summary.actorId, 'agent-sum');
    assert.equal(summary.freezeId, 'freeze-sum');
    assert.equal(summary.mode, 'textual-diff');
    assert.equal(summary.wipState, 'complete');
    assert.equal(summary.confidence, 'medium');
    assert.equal(summary.fileCount, 2);
    assert.equal(summary.hasPatchText, true);
    assert.equal(summary.capturedAt, '2026-06-16T01:23:45.000Z');
    const empty = createPatchEnvelope({
        taskId: 'TASK-SUM-2',
        actorId: 'agent-sum-2',
        freezeId: 'freeze-sum-2'
    });
    const emptySummary = summarizePatchEnvelope(empty);
    assert.equal(emptySummary.mode, 'metadata-only');
    assert.equal(emptySummary.fileCount, 0);
    assert.equal(emptySummary.hasPatchText, false);
}
function testHandoffEnvelopeUsesBrokerDefaults() {
    const envelope = createHandoffPatchEnvelope({
        taskId: 'TASK-HANDOFF',
        actorId: 'agent-handoff',
        freezeId: 'freeze-handoff',
        targetFiles: ['packages/cli/src/commands/route.ts']
    });
    assert.equal(envelope.mode, 'metadata-only');
    assert.equal(isMetadataOnlyEnvelope(envelope), true);
    assert.equal(validatePatchEnvelope(envelope).ok, true);
    assert.ok(envelope.metadata.partialReason?.includes('worktree apply'));
    assert.equal(envelope.snapshotDir, '.atm/runtime/wip-snapshot');
}
function testCompareIdentifiesDivergences() {
    const base = createPatchEnvelope({
        taskId: 'TASK-CMP',
        actorId: 'agent-cmp',
        freezeId: 'freeze-cmp',
        patchText: 'diff --git a/a b/a',
        wipState: 'complete',
        confidence: 'high',
        targetFiles: ['a'],
        capturedAt: '2026-06-16T02:00:00.000Z'
    });
    const identical = createPatchEnvelope({
        taskId: 'TASK-CMP',
        actorId: 'agent-cmp',
        freezeId: 'freeze-cmp',
        patchText: 'diff --git a/a b/a',
        wipState: 'complete',
        confidence: 'high',
        targetFiles: ['a'],
        capturedAt: '2026-06-16T02:00:00.000Z'
    });
    const equalResult = comparePatchEnvelopes(base, identical);
    assert.equal(equalResult.equal, true);
    assert.equal(equalResult.divergences.length, 0);
    const drifted = createPatchEnvelope({
        taskId: 'TASK-CMP',
        actorId: 'agent-cmp',
        freezeId: 'freeze-cmp-2',
        patchText: 'diff --git a/a b/a CHANGED',
        wipState: 'partial',
        confidence: 'low',
        targetFiles: ['a', 'b'],
        capturedAt: '2026-06-16T02:00:00.000Z'
    });
    const diffResult = comparePatchEnvelopes(base, drifted);
    assert.equal(diffResult.equal, false);
    const fields = diffResult.divergences.map((d) => d.field);
    assert.ok(fields.includes('wipState'));
    assert.ok(fields.includes('patchText'));
    assert.ok(fields.includes('targetFiles'));
    assert.ok(fields.includes('metadata.freezeId'));
    assert.ok(fields.includes('metadata.confidence'));
}
testValidTextualDiffEnvelopePasses();
testPartialWipMetadataOnlyEnvelopePasses();
testMissingTaskIdFails();
testMissingActorIdFails();
testMissingFreezeIdFails();
testTextualDiffEnvelopeRequiresPatchText();
testSummarizeProducesStableDigest();
testHandoffEnvelopeUsesBrokerDefaults();
testCompareIdentifiesDivergences();
console.log('patch envelope tests: ok');

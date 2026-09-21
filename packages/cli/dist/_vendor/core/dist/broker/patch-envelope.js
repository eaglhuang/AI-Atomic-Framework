import { resolveFreezeSnapshotDefaults } from './freeze.js';
export function createPatchEnvelope(input) {
    const patchText = input.patchText ?? null;
    const mode = patchText ? 'textual-diff' : 'metadata-only';
    return {
        schemaId: 'atm.patchEnvelope.v1',
        specVersion: '0.1.0',
        envelopeId: `patch-envelope-${Date.now()}`,
        taskId: input.taskId,
        actorId: input.actorId,
        mode,
        wipState: input.wipState ?? 'partial',
        snapshotDir: input.snapshotDir ?? '.atm/runtime/wip-snapshot',
        targetFiles: input.targetFiles ?? [],
        patchText,
        metadata: {
            freezeId: input.freezeId,
            capturedAt: input.capturedAt ?? new Date().toISOString(),
            confidence: input.confidence ?? 'medium',
            partialReason: input.partialReason ?? null
        }
    };
}
export function isMetadataOnlyEnvelope(envelope) {
    return envelope.mode === 'metadata-only' && envelope.patchText === null;
}
export function summarizePatchEnvelope(envelope) {
    return {
        envelopeId: envelope.envelopeId,
        taskId: envelope.taskId,
        actorId: envelope.actorId,
        freezeId: envelope.metadata.freezeId,
        mode: envelope.mode,
        wipState: envelope.wipState,
        confidence: envelope.metadata.confidence,
        fileCount: envelope.targetFiles.length,
        hasPatchText: envelope.patchText !== null && envelope.patchText.length > 0,
        capturedAt: envelope.metadata.capturedAt
    };
}
export function comparePatchEnvelopes(left, right) {
    const divergences = [];
    const scalarFields = [
        'taskId', 'actorId', 'mode', 'wipState', 'snapshotDir', 'patchText'
    ];
    for (const field of scalarFields) {
        if (left[field] !== right[field]) {
            divergences.push({ field: String(field), left: left[field], right: right[field] });
        }
    }
    if (left.targetFiles.length !== right.targetFiles.length ||
        left.targetFiles.some((file, idx) => file !== right.targetFiles[idx])) {
        divergences.push({ field: 'targetFiles', left: left.targetFiles, right: right.targetFiles });
    }
    const metadataFields = [
        'freezeId', 'confidence', 'partialReason'
    ];
    for (const field of metadataFields) {
        if (left.metadata[field] !== right.metadata[field]) {
            divergences.push({ field: `metadata.${String(field)}`, left: left.metadata[field], right: right.metadata[field] });
        }
    }
    return { equal: divergences.length === 0, divergences };
}
export function validatePatchEnvelope(envelope) {
    if (!envelope.taskId.trim()) {
        return { ok: false, reason: 'taskId is required' };
    }
    if (!envelope.actorId.trim()) {
        return { ok: false, reason: 'actorId is required' };
    }
    if (!envelope.metadata.freezeId.trim()) {
        return { ok: false, reason: 'freezeId is required' };
    }
    if (envelope.wipState === 'partial' && !envelope.patchText && envelope.metadata.confidence === 'low') {
        return { ok: true, reason: 'metadata-only partial WIP envelope accepted' };
    }
    if (envelope.mode === 'textual-diff' && !envelope.patchText) {
        return { ok: false, reason: 'textual-diff envelope must carry patchText' };
    }
    return { ok: true, reason: 'patch envelope accepted' };
}
export function createHandoffPatchEnvelope(input) {
    const defaults = resolveFreezeSnapshotDefaults();
    return createPatchEnvelope({
        taskId: input.taskId,
        actorId: input.actorId,
        freezeId: input.freezeId,
        targetFiles: input.targetFiles ?? [],
        snapshotDir: input.snapshotDir ?? defaults.snapshotDir,
        patchText: null,
        wipState: 'partial',
        confidence: 'medium',
        partialReason: input.partialReason ?? 'route handoff metadata-only envelope; worktree apply remains out of scope',
        capturedAt: input.capturedAt
    });
}

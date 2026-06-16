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

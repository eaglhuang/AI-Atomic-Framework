export const DEFAULT_POLYMORPH_VARIANT_THRESHOLD = 12;
export function buildPolymorphSuppressionKey(input) {
    return [
        'polymorph',
        input.templateId,
        input.signalKind,
        input.instanceId ?? '*',
        input.templateVersion ?? 'no-base'
    ].join('::');
}
export function buildRollbackSuppressionKey(input) {
    return ['rollback', input.proposalId, input.signalKind, input.baseVersion ?? 'no-base'].join('::');
}
export function buildEvolutionSuppressionKey(entry) {
    const tags = (entry.patternTags ?? []).slice().sort().join('|');
    const targetId = entry.atomId ?? entry.atomMapId ?? 'unknown';
    const baseVersion = entry.baseAtomVersion ?? entry.baseMapVersion ?? 'no-base';
    return [entry.targetSurface, targetId, entry.signalKind, tags, baseVersion, 'evolution'].join('::');
}
export function buildDecompositionSuppressionKey(entry) {
    return ['source-surface', entry.legacyUri ?? entry.filePath, 'oversized-source-surface', 'decomposition'].join('::');
}

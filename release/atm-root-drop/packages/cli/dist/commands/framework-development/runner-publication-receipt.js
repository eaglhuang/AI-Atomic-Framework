import { createHash } from 'node:crypto';
/**
 * The sole receipt constructor for sealed runner publication. It hides lane
 * identifiers, canonicalizes surfaces, and binds the full publication tuple.
 */
export function buildRunnerPublicationReceipt(input) {
    const core = {
        schemaId: 'atm.sealedRunnerPublicationReceipt.v1',
        taskId: input.taskId,
        laneFingerprint: fingerprint(input.laneSessionId, 'lane'),
        stewardActorId: input.stewardActorId,
        sealedSourceSha: input.sealedSourceSha,
        generation: input.generation,
        runnerBuildDigest: input.runnerBuildDigest,
        manifestDigest: input.manifestDigest,
        surfaces: [...new Set(input.surfaces.map((surface) => surface.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
        publicationCommitSha: input.publicationCommitSha,
        remoteVisibility: input.remoteVisibility,
        receiptDisposition: input.receiptDisposition,
        issuedAt: input.issuedAt
    };
    const receiptDigest = `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`;
    return { ...core, receiptDigest };
}
function fingerprint(value, kind) {
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    return `${kind}fp:${createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16)}`;
}

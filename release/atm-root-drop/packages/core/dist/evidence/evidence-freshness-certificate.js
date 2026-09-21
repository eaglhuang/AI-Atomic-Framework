import { createHash } from 'node:crypto';
export const EVIDENCE_FRESHNESS_CERTIFICATE_SCHEMA_ID = 'atm.evidenceFreshnessCertificate.v1';
export function compileEvidenceFreshnessCertificate(input) {
    const n = normalize(input);
    const diagnostics = [];
    if (!n.certificateId || !n.authorityDigest)
        diagnostics.push('incomplete-certificate-identity');
    if (n.observedWatermark !== n.expectedWatermark)
        diagnostics.push('watermark-mismatch');
    if (n.observedCacheDigest !== n.expectedCacheDigest)
        diagnostics.push('cache-digest-mismatch');
    if (n.observedResumeCursor !== n.expectedResumeCursor)
        diagnostics.push('resume-cursor-mismatch');
    const seen = new Set();
    const accepted = [];
    const duplicates = [];
    for (const observation of n.observations) {
        if (!observation.observationId || !observation.digest || !observation.sealed)
            diagnostics.push(`unsealed-observation:${observation.observationId}`);
        if (seen.has(observation.observationId)) {
            duplicates.push(observation.observationId);
            continue;
        }
        seen.add(observation.observationId);
        if (n.knownObservationIds.length && !n.knownObservationIds.includes(observation.observationId))
            diagnostics.push(`unknown-observation:${observation.observationId}`);
        else
            accepted.push(observation.observationId);
    }
    const status = diagnostics.some((d) => d.startsWith('unknown-') || d.startsWith('unsealed-') || d === 'incomplete-certificate-identity') ? 'contradictory' : diagnostics.length ? 'stale' : 'proven';
    const invalidation = status === 'proven' ? null : { code: diagnostics.some((d) => d.includes('resume')) ? 'ATM_EVIDENCE_RESUME_BINDING_MISMATCH' : 'ATM_EVIDENCE_FRESHNESS_MISMATCH', repairCommand: 'seal fresh observations and rerun the certificate binding compiler' };
    const result = { schemaId: EVIDENCE_FRESHNESS_CERTIFICATE_SCHEMA_ID, specVersion: '0.1.0', certificateId: n.certificateId, authorityDigest: n.authorityDigest, freshness: { watermark: n.observedWatermark, cacheDigest: n.observedCacheDigest, resumeCursor: n.observedResumeCursor }, acceptedObservationIds: accepted, duplicateObservationIds: duplicates, status, diagnostics, invalidation, certificateDigest: '' };
    return { ...result, certificateDigest: digest({ ...result, certificateDigest: undefined }) };
}
export const createEvidenceFreshnessCertificate = compileEvidenceFreshnessCertificate;
export function replayEvidenceFreshnessCertificate(result, input) { return compileEvidenceFreshnessCertificate(input); }
export function validateEvidenceFreshnessCertificate(result) { return { ok: result.status === 'proven' && result.invalidation === null && result.certificateDigest.startsWith('sha256:'), diagnostics: [...result.diagnostics] }; }
function normalize(i) { return { certificateId: String(i.certificateId ?? '').trim(), authorityDigest: String(i.authorityDigest ?? '').trim(), expectedWatermark: String(i.expectedWatermark ?? '').trim(), expectedCacheDigest: String(i.expectedCacheDigest ?? '').trim(), expectedResumeCursor: String(i.expectedResumeCursor ?? '').trim(), observedWatermark: String(i.observedWatermark ?? '').trim(), observedCacheDigest: String(i.observedCacheDigest ?? '').trim(), observedResumeCursor: String(i.observedResumeCursor ?? '').trim(), observations: [...(i.observations ?? [])].map((o) => ({ observationId: String(o?.observationId ?? '').trim(), digest: String(o?.digest ?? '').trim(), sealed: o?.sealed === true })).sort((a, b) => a.observationId.localeCompare(b.observationId)), knownObservationIds: [...(i.knownObservationIds ?? [])].map(String).sort() }; }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }

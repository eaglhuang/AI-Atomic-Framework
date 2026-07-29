import { createHash } from 'node:crypto';
const fingerprintLength = 16;
/** Field names that carry replayable capability material and must be redacted. */
export const replayableCapabilityFields = Object.freeze({
    laneSessionId: 'lane',
    laneId: 'lane',
    leaseId: 'lease',
    claimLeaseId: 'lease',
    ticketKey: 'ticket',
    ticketId: 'ticket',
    handoffToken: 'handoff',
    handoffTokenHash: 'handoff',
    capabilityKey: 'capability',
    nonce: 'capability',
    nonceHash: 'capability'
});
export function capabilityFingerprint(value, kind) {
    const normalized = normalizeOptionalString(value);
    if (!normalized)
        return null;
    const digest = createHash('sha256').update(`${kind}\n${normalized}`).digest('hex').slice(0, fingerprintLength);
    return `${kind}fp:${digest}`;
}
export function laneFingerprint(laneSessionId) {
    return capabilityFingerprint(laneSessionId, 'lane');
}
export function ticketFingerprint(ticketKey) {
    return capabilityFingerprint(ticketKey, 'ticket');
}
/**
 * Deep-redact any replayable capability keys inside an arbitrary report object.
 * Whitelisted `viewerLaneSessionId`/`viewerLaneSessionIds` may be exempted so an
 * owner still receives its own live lane id (it already holds it). Every other
 * lane id, lease id, ticket key, or token is projected to a fingerprint.
 */
export function redactCapabilityKeys(value, options = {}) {
    const exempt = new Set((options.exemptLaneSessionIds ?? []).map((entry) => entry.trim()).filter(Boolean));
    return redactValue(value, exempt);
}
function redactValue(value, exempt) {
    if (Array.isArray(value)) {
        return value.map((entry) => redactValue(entry, exempt));
    }
    if (value && typeof value === 'object') {
        const source = value;
        const output = {};
        for (const [key, entry] of Object.entries(source)) {
            const kind = replayableCapabilityFields[key];
            if (kind && typeof entry === 'string') {
                if (exempt.has(entry.trim())) {
                    output[key] = entry;
                }
                else {
                    output[key] = capabilityFingerprint(entry, kind) ?? null;
                }
                continue;
            }
            output[key] = redactValue(entry, exempt);
        }
        return output;
    }
    return value;
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

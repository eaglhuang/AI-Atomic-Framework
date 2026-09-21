import { createHash } from 'node:crypto';
export const OBSERVED_EVIDENCE_SOURCE_SCHEMA_ID = 'atm.observedEvidenceSource.v1';
export const OBSERVATION_SNAPSHOT_SCHEMA_ID = 'atm.observationSnapshot.v1';
/**
 * Reads evidence only through declared source ports.  The public result has no
 * caller-provided success bit: availability and agreement are derived from the
 * observed values themselves.
 */
export function collectObservedEvidence(sources) {
    const normalized = [...sources].sort((left, right) => left.descriptor.sourceId.localeCompare(right.descriptor.sourceId));
    if (normalized.length === 0)
        return snapshot('unavailable', [], null, null, ['no-observed-source']);
    const values = [];
    const diagnostics = [];
    for (const source of normalized) {
        try {
            const value = source.read();
            if (value === undefined || value === null)
                diagnostics.push(`source-unavailable:${source.descriptor.sourceId}`);
            else
                values.push({ sourceId: source.descriptor.sourceId, value });
        }
        catch {
            diagnostics.push(`source-unavailable:${source.descriptor.sourceId}`);
        }
    }
    if (values.length === 0)
        return snapshot('unavailable', normalized.map((source) => source.descriptor.sourceId), null, null, diagnostics);
    const digests = [...new Set(values.map((entry) => digest(entry.value)))];
    if (digests.length !== 1) {
        return snapshot('conflicting', normalized.map((source) => source.descriptor.sourceId), null, null, [...diagnostics, 'conflicting-observed-values']);
    }
    return snapshot('observed', normalized.map((source) => source.descriptor.sourceId), values[0].value, digests[0], diagnostics);
}
export function verifyObservedEvidence(snapshotValue, expectedDigest) {
    if (snapshotValue.status !== 'observed')
        return { ok: false, diagnostics: [`observation-${snapshotValue.status}`] };
    if (!isDigest(expectedDigest) || snapshotValue.valueDigest !== expectedDigest)
        return { ok: false, diagnostics: ['observed-digest-mismatch'] };
    return { ok: true, diagnostics: [] };
}
function snapshot(status, sourceIds, value, valueDigest, diagnostics) {
    return {
        schemaId: OBSERVATION_SNAPSHOT_SCHEMA_ID,
        specVersion: '0.1.0',
        status,
        sourceIds,
        observedAt: new Date().toISOString(),
        value,
        valueDigest,
        diagnostics: [...new Set(diagnostics)].sort(),
    };
}
function digest(value) {
    return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function isDigest(value) {
    return /^sha256:[a-f0-9]{64}$/i.test(value);
}

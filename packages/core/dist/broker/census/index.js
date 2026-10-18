import { createHash } from 'node:crypto';
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const record = value;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
export function sha256Digest(value) {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
export function buildSharedWriteGateCoverage(input) {
    const generatedAt = input.generatedAt ?? new Date(0).toISOString();
    const entries = input.entries.map((entry) => ({
        ...entry,
        digest: sha256Digest(entry)
    }));
    const unknownOwnerCount = entries.filter((entry) => entry.ownerCard === 'unknown' || entry.authority === 'unknown').length;
    const unavailableReceipts = entries.filter((entry) => entry.observationStatus === 'unavailable');
    const withoutDigest = {
        schemaId: 'atm.sharedWriteGateCoverage.v1',
        specVersion: '0.1.0',
        generatedAt,
        entries,
        currentSourceDiscrimination: input.currentSourceDiscrimination ?? [],
        projectionOnlyItemCount: input.projectionOnlyItemCount ?? 0,
        unknownOwnerCount,
        unavailableReceipts
    };
    return {
        ...withoutDigest,
        digest: sha256Digest(withoutDigest)
    };
}

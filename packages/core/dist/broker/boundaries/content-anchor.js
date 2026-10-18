import { createHash } from 'node:crypto';
export const CONTENT_ANCHOR_MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'content anchor substrate baseline'
});
export function sha256Text(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export function createContentAnchor(input) {
    const lines = input.sourceText.split(/\r?\n/);
    const location = normalizeLocation(input.filePath, input.lineStart, input.lineEnd, lines.length);
    const preimage = location
        ? lines.slice(location.lineStart - 1, location.lineEnd).join('\n')
        : input.sourceText;
    const contextRadius = input.contextRadius ?? 2;
    const contextBefore = location
        ? lines.slice(Math.max(0, location.lineStart - 1 - contextRadius), location.lineStart - 1)
        : [];
    const contextAfter = location
        ? lines.slice(location.lineEnd, Math.min(lines.length, location.lineEnd + contextRadius))
        : [];
    const identity = [
        input.baseDigest,
        input.filePath.replace(/\\/g, '/'),
        input.kind,
        input.symbolName ?? '',
        input.astPath?.join('/') ?? '',
        sha256Text(preimage)
    ].join('\0');
    return {
        schemaId: 'atm.contentAnchor.v1',
        specVersion: '0.1.0',
        migration: CONTENT_ANCHOR_MIGRATION,
        anchorId: `content-anchor-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
        baseDigest: input.baseDigest,
        filePath: input.filePath.replace(/\\/g, '/'),
        fileDigest: sha256Text(input.sourceText),
        kind: input.kind,
        ...(input.symbolName ? { symbolName: input.symbolName } : {}),
        ...(input.astPath ? { astPath: input.astPath } : {}),
        contextBefore,
        contextAfter,
        preimageDigest: sha256Text(preimage),
        ...(location ? { location } : {}),
        provenance: input.provenance,
        confidence: input.confidence
    };
}
function normalizeLocation(filePath, lineStart, lineEnd, lineCount) {
    if (lineStart === undefined && lineEnd === undefined) {
        return undefined;
    }
    const start = lineStart ?? lineEnd;
    const end = lineEnd ?? lineStart;
    if (!Number.isInteger(start) || !Number.isInteger(end) || !start || !end || start < 1 || end < start || end > lineCount) {
        throw new Error(`Invalid content anchor line window for ${filePath}: ${lineStart ?? '?'}-${lineEnd ?? '?'}`);
    }
    return { filePath: filePath.replace(/\\/g, '/'), lineStart: start, lineEnd: end };
}

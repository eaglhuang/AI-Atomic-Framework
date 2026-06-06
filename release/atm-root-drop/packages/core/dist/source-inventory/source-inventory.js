/**
 * Source inventory contract for Decomposition Police (APF-0031).
 *
 * Produces a read-only inventory of source surfaces with line counts,
 * language hints, entrypoints, and legacy URIs. Does not modify any
 * host project. 1000 LOC is the configurable default threshold.
 */
export const DEFAULT_MAX_FILE_LINES = 1000;
const DEFAULT_IGNORED_PATTERNS = [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '.git/',
    'release/'
];
export function buildSourceInventoryReport(input) {
    const maxFileLines = input.maxFileLines ?? DEFAULT_MAX_FILE_LINES;
    const ignoredPathPatterns = input.ignoredPathPatterns ?? DEFAULT_IGNORED_PATTERNS;
    const normalized = input.entries.map((entry) => normalizeEntry(entry, ignoredPathPatterns));
    return {
        schemaId: 'atm.sourceInventoryReport',
        specVersion: '0.1.0',
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        maxFileLines,
        entries: normalized,
        ignoredPathPatterns: [...ignoredPathPatterns]
    };
}
export function isPathIgnored(filePath, ignoredPathPatterns) {
    return ignoredPathPatterns.some((pattern) => filePath.includes(pattern));
}
function normalizeEntry(entry, ignoredPathPatterns) {
    const filePath = String(entry.filePath ?? '').trim();
    if (!filePath) {
        throw new Error('SourceInventoryEntry.filePath is required.');
    }
    const lineCount = Number(entry.lineCount ?? 0);
    const language = entry.language?.trim();
    const ignoredReason = entry.ignoredReason
        ?? (isPathIgnored(filePath, ignoredPathPatterns) ? 'ignored-by-pattern' : undefined);
    return {
        filePath,
        language,
        lineCount,
        exportedSymbols: entry.exportedSymbols ? [...entry.exportedSymbols] : undefined,
        entrypointHint: entry.entrypointHint,
        legacyUri: entry.legacyUri ?? filePath,
        ignoredReason,
        hasActiveReplacementMap: entry.hasActiveReplacementMap ?? false,
        replacementMapId: entry.replacementMapId
    };
}
export function filterEligibleForDecomposition(report) {
    return report.entries.filter((entry) => {
        if (entry.ignoredReason)
            return false;
        if (entry.hasActiveReplacementMap)
            return false;
        if (entry.lineCount <= report.maxFileLines)
            return false;
        return true;
    });
}

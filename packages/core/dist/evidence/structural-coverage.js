import { createHash } from 'node:crypto';
export const STRUCTURAL_COVERAGE_SCHEMA_ID = 'atm.structuralCoverage.v1';
export const STRUCTURAL_COVERAGE_COMPILER_ID = 'atm.structuralCoverageAdapter.v1';
export function compileStructuralCoverage(input) {
    const normalized = normalizeInput(input);
    const diagnostics = [];
    const seen = new Set();
    for (const entry of normalized.obligations) {
        if (seen.has(entry.obligationId))
            diagnostics.push(`duplicate-obligation:${entry.obligationId}`);
        seen.add(entry.obligationId);
    }
    if (normalized.denominator.total < 0 || !Number.isInteger(normalized.denominator.total)) {
        diagnostics.push('invalid-denominator-total');
    }
    if (normalized.denominator.total !== normalized.obligations.length) {
        diagnostics.push(`denominator-mismatch:${normalized.denominator.total}:${normalized.obligations.length}`);
    }
    const projection = countProjection(normalized.obligations);
    if (projection.total !== normalized.denominator.total)
        diagnostics.push('projection-denominator-mismatch');
    const status = diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('denominator-mismatch') || entry === 'projection-denominator-mismatch')
        ? 'contradictory'
        : normalized.obligations.some((entry) => entry.coverage === 'unsupported')
            ? 'blocked'
            : normalized.obligations.some((entry) => entry.coverage === 'uncovered')
                ? 'stale'
                : 'proven';
    const authorityDigest = digest({ model: normalized.model, denominator: normalized.denominator, entries: normalized.obligations });
    const result = {
        schemaId: STRUCTURAL_COVERAGE_SCHEMA_ID,
        specVersion: '0.1.0',
        compilerId: STRUCTURAL_COVERAGE_COMPILER_ID,
        coverageId: normalized.coverageId,
        generatedAt: normalized.generatedAt,
        model: normalized.model,
        authority: { sealed: true, digest: authorityDigest },
        denominator: normalized.denominator,
        projection,
        entries: normalized.obligations.map((entry) => ({ ...entry, entryDigest: digest(entry) })),
        status,
        diagnostics,
        resultDigest: digest({ coverageId: normalized.coverageId, authorityDigest, projection, status, diagnostics })
    };
    return result;
}
export const createStructuralCoverage = compileStructuralCoverage;
export function reconcileStructuralCoverageDenominator(input) {
    return compileStructuralCoverage(input);
}
export function replayStructuralCoverage(result) {
    return compileStructuralCoverage({
        coverageId: result.coverageId,
        generatedAt: result.generatedAt,
        model: result.model,
        denominator: result.denominator,
        obligations: result.entries
    });
}
export function validateStructuralCoverage(result) {
    const replay = replayStructuralCoverage(result);
    const diagnostics = [...result.diagnostics];
    if (result.authority.sealed !== true)
        diagnostics.push('authority-not-sealed');
    if (result.resultDigest !== replay.resultDigest)
        diagnostics.push('result-digest-mismatch');
    if (result.authority.digest !== replay.authority.digest)
        diagnostics.push('authority-digest-mismatch');
    if (result.status !== replay.status)
        diagnostics.push('status-mismatch');
    return { ok: diagnostics.length === 0 && result.status !== 'contradictory', diagnostics: [...new Set(diagnostics)] };
}
function normalizeInput(input) {
    return {
        coverageId: text(input.coverageId),
        generatedAt: text(input.generatedAt),
        model: { modelId: text(input.model.modelId), modelDigest: text(input.model.modelDigest) },
        denominator: { sourceId: text(input.denominator.sourceId), total: Number(input.denominator.total), digest: text(input.denominator.digest) },
        obligations: [...input.obligations].map((entry) => ({
            obligationId: text(entry.obligationId),
            semanticFamily: text(entry.semanticFamily),
            sourceRef: text(entry.sourceRef),
            coverage: entry.coverage,
            observedDigest: text(entry.observedDigest)
        })).sort((a, b) => a.obligationId.localeCompare(b.obligationId))
    };
}
function countProjection(entries) {
    const counts = { total: entries.length, covered: 0, uncovered: 0, unsupported: 0, excluded: 0, ratio: 0 };
    for (const entry of entries)
        counts[entry.coverage] += 1;
    counts.ratio = counts.total === 0 ? 0 : counts.covered / counts.total;
    return counts;
}
function digest(value) {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
function text(value) { return String(value ?? '').trim(); }

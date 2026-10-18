import { createHash } from 'node:crypto';
export const COVERAGE_RATCHET_BASELINE_SCHEMA_ID = 'atm.coverageRatchetBaseline.v1';
export const COVERAGE_RATCHET_BASELINE_COMPILER_ID = 'atm.coverageRatchetBaselineAdapter.v1';
export function compileCoverageRatchetBaseline(input) {
    const normalized = normalize(input);
    const diagnostics = [];
    if (!normalized.authority.sealed || !normalized.authority.digest)
        diagnostics.push('authority-not-sealed');
    if (!normalized.observedAuthorityDigest || normalized.observedAuthorityDigest !== normalized.authority.digest)
        diagnostics.push('authority-digest-mismatch');
    if (!Number.isFinite(normalized.minimumRatio) || normalized.minimumRatio < 0 || normalized.minimumRatio > 1)
        diagnostics.push('invalid-minimum-ratio');
    const seen = new Set();
    for (const baseline of normalized.baselines) {
        if (seen.has(baseline.scope))
            diagnostics.push(`duplicate-scope:${baseline.scope}`);
        seen.add(baseline.scope);
        if (!Number.isInteger(baseline.total) || baseline.total < 0 || !Number.isInteger(baseline.covered) || baseline.covered < 0 || baseline.covered > baseline.total)
            diagnostics.push(`invalid-counts:${baseline.scope}`);
        if (!Number.isFinite(baseline.ratio) || baseline.ratio < 0 || baseline.ratio > 1 || (baseline.total > 0 && baseline.ratio !== baseline.covered / baseline.total))
            diagnostics.push(`ratio-mismatch:${baseline.scope}`);
    }
    const projection = { changed: find(normalized.baselines, 'changed'), impacted: find(normalized.baselines, 'impacted'), repository: find(normalized.baselines, 'repository'), minimumObservedRatio: normalized.baselines.length ? Math.min(...normalized.baselines.map((entry) => entry.ratio)) : 0 };
    for (const scope of ['changed', 'impacted', 'repository'])
        if (!projection[scope])
            diagnostics.push(`missing-baseline:${scope}`);
    if (projection.minimumObservedRatio < normalized.minimumRatio)
        diagnostics.push('coverage-below-ratchet');
    const contradictory = diagnostics.some((item) => item.startsWith('duplicate-') || item.startsWith('invalid-') || item.startsWith('ratio-mismatch'));
    const stale = diagnostics.some((item) => item.includes('digest') || item.startsWith('missing-baseline'));
    const status = contradictory ? 'contradictory' : stale ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
    const result = { schemaId: COVERAGE_RATCHET_BASELINE_SCHEMA_ID, specVersion: '0.1.0', compilerId: COVERAGE_RATCHET_BASELINE_COMPILER_ID, ratchetId: normalized.ratchetId, generatedAt: normalized.generatedAt, authority: normalized.authority, minimumRatio: normalized.minimumRatio, baselines: normalized.baselines, projection, status, diagnostics, resultDigest: digest({ authority: normalized.authority, ratchetId: normalized.ratchetId, minimumRatio: normalized.minimumRatio, baselines: normalized.baselines, projection, status, diagnostics }) };
    return result;
}
export const createCoverageRatchetBaseline = compileCoverageRatchetBaseline;
export const migrateCoverageRatchetBaseline = compileCoverageRatchetBaseline;
export function replayCoverageRatchetBaseline(result) { return compileCoverageRatchetBaseline({ ratchetId: result.ratchetId, generatedAt: result.generatedAt, authority: result.authority, minimumRatio: result.minimumRatio, observedAuthorityDigest: result.authority.digest, baselines: result.baselines }); }
export function validateCoverageRatchetBaseline(result) { const replay = replayCoverageRatchetBaseline(result); const diagnostics = [...result.diagnostics]; if (result.resultDigest !== replay.resultDigest)
    diagnostics.push('result-digest-mismatch'); if (result.status !== replay.status)
    diagnostics.push('status-mismatch'); return { ok: diagnostics.length === 0 && result.status === 'proven', diagnostics: [...new Set(diagnostics)] }; }
function normalize(input) { return { ratchetId: text(input.ratchetId), generatedAt: text(input.generatedAt), authority: { authorityId: text(input.authority?.authorityId), digest: text(input.authority?.digest), sealed: true }, minimumRatio: Number(input.minimumRatio), observedAuthorityDigest: text(input.observedAuthorityDigest), baselines: [...(input.baselines ?? [])].map((entry) => ({ scope: entry.scope, ratio: Number(entry.ratio), covered: Number(entry.covered), total: Number(entry.total), digest: text(entry.digest) })).sort((a, b) => a.scope.localeCompare(b.scope)) }; }
function find(entries, scope) { return entries.find((entry) => entry.scope === scope) ?? null; }
function text(value) { return String(value ?? '').trim(); }
function digest(value) { return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`; }
function stable(value) { if (value === null || typeof value !== 'object')
    return JSON.stringify(value); if (Array.isArray(value))
    return `[${value.map(stable).join(',')}]`; const record = value; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`; }

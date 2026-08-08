import { createHash } from 'node:crypto';

export const COVERAGE_RATCHET_BASELINE_SCHEMA_ID = 'atm.coverageRatchetBaseline.v1' as const;
export const COVERAGE_RATCHET_BASELINE_COMPILER_ID = 'atm.coverageRatchetBaselineAdapter.v1' as const;

export type CoverageRatchetStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type CoverageRatchetScope = 'changed' | 'impacted' | 'repository';

export interface CoverageRatchetAuthority { readonly authorityId: string; readonly digest: string; readonly sealed: true; }
export interface CoverageRatchetBaselineInput { readonly scope: CoverageRatchetScope; readonly ratio: number; readonly covered: number; readonly total: number; readonly digest: string; }
export interface CoverageRatchetInput {
  readonly ratchetId: string;
  readonly generatedAt: string;
  readonly authority: CoverageRatchetAuthority;
  readonly baselines: readonly CoverageRatchetBaselineInput[];
  readonly minimumRatio: number;
  readonly observedAuthorityDigest: string;
}
export interface CoverageRatchetResult {
  readonly schemaId: typeof COVERAGE_RATCHET_BASELINE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly compilerId: typeof COVERAGE_RATCHET_BASELINE_COMPILER_ID;
  readonly ratchetId: string;
  readonly generatedAt: string;
  readonly authority: CoverageRatchetAuthority;
  readonly minimumRatio: number;
  readonly baselines: readonly CoverageRatchetBaselineInput[];
  readonly projection: { readonly changed: CoverageRatchetBaselineInput | null; readonly impacted: CoverageRatchetBaselineInput | null; readonly repository: CoverageRatchetBaselineInput | null; readonly minimumObservedRatio: number };
  readonly status: CoverageRatchetStatus;
  readonly diagnostics: readonly string[];
  readonly resultDigest: string;
}
export interface CoverageRatchetValidation { readonly ok: boolean; readonly diagnostics: readonly string[]; }

export function compileCoverageRatchetBaseline(input: CoverageRatchetInput): CoverageRatchetResult {
  const normalized = normalize(input);
  const diagnostics: string[] = [];
  if (!normalized.authority.sealed || !normalized.authority.digest) diagnostics.push('authority-not-sealed');
  if (!normalized.observedAuthorityDigest || normalized.observedAuthorityDigest !== normalized.authority.digest) diagnostics.push('authority-digest-mismatch');
  if (!Number.isFinite(normalized.minimumRatio) || normalized.minimumRatio < 0 || normalized.minimumRatio > 1) diagnostics.push('invalid-minimum-ratio');
  const seen = new Set<string>();
  for (const baseline of normalized.baselines) {
    if (seen.has(baseline.scope)) diagnostics.push(`duplicate-scope:${baseline.scope}`);
    seen.add(baseline.scope);
    if (!Number.isInteger(baseline.total) || baseline.total < 0 || !Number.isInteger(baseline.covered) || baseline.covered < 0 || baseline.covered > baseline.total) diagnostics.push(`invalid-counts:${baseline.scope}`);
    if (!Number.isFinite(baseline.ratio) || baseline.ratio < 0 || baseline.ratio > 1 || (baseline.total > 0 && baseline.ratio !== baseline.covered / baseline.total)) diagnostics.push(`ratio-mismatch:${baseline.scope}`);
  }
  const projection = { changed: find(normalized.baselines, 'changed'), impacted: find(normalized.baselines, 'impacted'), repository: find(normalized.baselines, 'repository'), minimumObservedRatio: normalized.baselines.length ? Math.min(...normalized.baselines.map((entry) => entry.ratio)) : 0 };
  for (const scope of ['changed', 'impacted', 'repository'] as const) if (!projection[scope]) diagnostics.push(`missing-baseline:${scope}`);
  if (projection.minimumObservedRatio < normalized.minimumRatio) diagnostics.push('coverage-below-ratchet');
  const contradictory = diagnostics.some((item) => item.startsWith('duplicate-') || item.startsWith('invalid-') || item.startsWith('ratio-mismatch'));
  const stale = diagnostics.some((item) => item.includes('digest') || item.startsWith('missing-baseline'));
  const status: CoverageRatchetStatus = contradictory ? 'contradictory' : stale ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
  const result = { schemaId: COVERAGE_RATCHET_BASELINE_SCHEMA_ID, specVersion: '0.1.0' as const, compilerId: COVERAGE_RATCHET_BASELINE_COMPILER_ID, ratchetId: normalized.ratchetId, generatedAt: normalized.generatedAt, authority: normalized.authority, minimumRatio: normalized.minimumRatio, baselines: normalized.baselines, projection, status, diagnostics, resultDigest: digest({ authority: normalized.authority, ratchetId: normalized.ratchetId, minimumRatio: normalized.minimumRatio, baselines: normalized.baselines, projection, status, diagnostics }) } satisfies CoverageRatchetResult;
  return result;
}
export const createCoverageRatchetBaseline = compileCoverageRatchetBaseline;
export const migrateCoverageRatchetBaseline = compileCoverageRatchetBaseline;
export function replayCoverageRatchetBaseline(result: CoverageRatchetResult): CoverageRatchetResult { return compileCoverageRatchetBaseline({ ratchetId: result.ratchetId, generatedAt: result.generatedAt, authority: result.authority, minimumRatio: result.minimumRatio, observedAuthorityDigest: result.authority.digest, baselines: result.baselines }); }
export function validateCoverageRatchetBaseline(result: CoverageRatchetResult): CoverageRatchetValidation { const replay = replayCoverageRatchetBaseline(result); const diagnostics = [...result.diagnostics]; if (result.resultDigest !== replay.resultDigest) diagnostics.push('result-digest-mismatch'); if (result.status !== replay.status) diagnostics.push('status-mismatch'); return { ok: diagnostics.length === 0 && result.status === 'proven', diagnostics: [...new Set(diagnostics)] }; }

function normalize(input: CoverageRatchetInput) { return { ratchetId: text(input.ratchetId), generatedAt: text(input.generatedAt), authority: { authorityId: text(input.authority?.authorityId), digest: text(input.authority?.digest), sealed: true as const }, minimumRatio: Number(input.minimumRatio), observedAuthorityDigest: text(input.observedAuthorityDigest), baselines: [...(input.baselines ?? [])].map((entry) => ({ scope: entry.scope, ratio: Number(entry.ratio), covered: Number(entry.covered), total: Number(entry.total), digest: text(entry.digest) })).sort((a, b) => a.scope.localeCompare(b.scope)) }; }
function find(entries: readonly CoverageRatchetBaselineInput[], scope: CoverageRatchetScope) { return entries.find((entry) => entry.scope === scope) ?? null; }
function text(value: unknown) { return String(value ?? '').trim(); }
function digest(value: unknown) { return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`; }
function stable(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`; }

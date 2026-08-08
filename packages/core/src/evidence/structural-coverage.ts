import { createHash } from 'node:crypto';

export const STRUCTURAL_COVERAGE_SCHEMA_ID = 'atm.structuralCoverage.v1' as const;
export const STRUCTURAL_COVERAGE_COMPILER_ID = 'atm.structuralCoverageAdapter.v1' as const;

export type StructuralCoverageStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';

export interface StructuralCoverageModelRef {
  readonly modelId: string;
  readonly modelDigest: string;
}

export interface StructuralCoverageObligationInput {
  readonly obligationId: string;
  readonly semanticFamily: string;
  readonly sourceRef: string;
  readonly coverage: 'covered' | 'uncovered' | 'unsupported' | 'excluded';
  readonly observedDigest: string;
}

export interface StructuralCoverageDenominatorInput {
  readonly sourceId: string;
  readonly total: number;
  readonly digest: string;
}

export interface StructuralCoverageInput {
  readonly coverageId: string;
  readonly generatedAt: string;
  readonly model: StructuralCoverageModelRef;
  readonly denominator: StructuralCoverageDenominatorInput;
  readonly obligations: readonly StructuralCoverageObligationInput[];
}

export interface StructuralCoverageEntry extends StructuralCoverageObligationInput {
  readonly entryDigest: string;
}

export interface StructuralCoverageResult {
  readonly schemaId: typeof STRUCTURAL_COVERAGE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly compilerId: typeof STRUCTURAL_COVERAGE_COMPILER_ID;
  readonly coverageId: string;
  readonly generatedAt: string;
  readonly model: StructuralCoverageModelRef;
  readonly authority: { readonly sealed: true; readonly digest: string };
  readonly denominator: StructuralCoverageDenominatorInput;
  readonly projection: {
    readonly total: number;
    readonly covered: number;
    readonly uncovered: number;
    readonly unsupported: number;
    readonly excluded: number;
    readonly ratio: number;
  };
  readonly entries: readonly StructuralCoverageEntry[];
  readonly status: StructuralCoverageStatus;
  readonly diagnostics: readonly string[];
  readonly resultDigest: string;
}

export interface StructuralCoverageValidation {
  readonly ok: boolean;
  readonly diagnostics: readonly string[];
}

export function compileStructuralCoverage(input: StructuralCoverageInput): StructuralCoverageResult {
  const normalized = normalizeInput(input);
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  for (const entry of normalized.obligations) {
    if (seen.has(entry.obligationId)) diagnostics.push(`duplicate-obligation:${entry.obligationId}`);
    seen.add(entry.obligationId);
  }
  if (normalized.denominator.total < 0 || !Number.isInteger(normalized.denominator.total)) {
    diagnostics.push('invalid-denominator-total');
  }
  if (normalized.denominator.total !== normalized.obligations.length) {
    diagnostics.push(`denominator-mismatch:${normalized.denominator.total}:${normalized.obligations.length}`);
  }
  const projection = countProjection(normalized.obligations);
  if (projection.total !== normalized.denominator.total) diagnostics.push('projection-denominator-mismatch');
  const status: StructuralCoverageStatus = diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('denominator-mismatch') || entry === 'projection-denominator-mismatch')
    ? 'contradictory'
    : normalized.obligations.some((entry) => entry.coverage === 'unsupported')
      ? 'blocked'
      : normalized.obligations.some((entry) => entry.coverage === 'uncovered')
        ? 'stale'
        : 'proven';
  const authorityDigest = digest({ model: normalized.model, denominator: normalized.denominator, entries: normalized.obligations });
  const result = {
    schemaId: STRUCTURAL_COVERAGE_SCHEMA_ID,
    specVersion: '0.1.0' as const,
    compilerId: STRUCTURAL_COVERAGE_COMPILER_ID,
    coverageId: normalized.coverageId,
    generatedAt: normalized.generatedAt,
    model: normalized.model,
    authority: { sealed: true as const, digest: authorityDigest },
    denominator: normalized.denominator,
    projection,
    entries: normalized.obligations.map((entry) => ({ ...entry, entryDigest: digest(entry) })),
    status,
    diagnostics,
    resultDigest: digest({ coverageId: normalized.coverageId, authorityDigest, projection, status, diagnostics })
  } satisfies StructuralCoverageResult;
  return result;
}

export const createStructuralCoverage = compileStructuralCoverage;

export function reconcileStructuralCoverageDenominator(input: StructuralCoverageInput): StructuralCoverageResult {
  return compileStructuralCoverage(input);
}

export function replayStructuralCoverage(result: StructuralCoverageResult): StructuralCoverageResult {
  return compileStructuralCoverage({
    coverageId: result.coverageId,
    generatedAt: result.generatedAt,
    model: result.model,
    denominator: result.denominator,
    obligations: result.entries
  });
}

export function validateStructuralCoverage(result: StructuralCoverageResult): StructuralCoverageValidation {
  const replay = replayStructuralCoverage(result);
  const diagnostics = [...result.diagnostics];
  if (result.authority.sealed !== true) diagnostics.push('authority-not-sealed');
  if (result.resultDigest !== replay.resultDigest) diagnostics.push('result-digest-mismatch');
  if (result.authority.digest !== replay.authority.digest) diagnostics.push('authority-digest-mismatch');
  if (result.status !== replay.status) diagnostics.push('status-mismatch');
  return { ok: diagnostics.length === 0 && result.status !== 'contradictory', diagnostics: [...new Set(diagnostics)] };
}

function normalizeInput(input: StructuralCoverageInput) {
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

function countProjection(entries: readonly StructuralCoverageObligationInput[]) {
  const counts = { total: entries.length, covered: 0, uncovered: 0, unsupported: 0, excluded: 0, ratio: 0 };
  for (const entry of entries) counts[entry.coverage] += 1;
  counts.ratio = counts.total === 0 ? 0 : counts.covered / counts.total;
  return counts;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function text(value: unknown): string { return String(value ?? '').trim(); }

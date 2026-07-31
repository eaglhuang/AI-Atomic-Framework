import { createHash } from 'node:crypto';
import {
  createObligationInventory,
  type ObligationInventory,
  type ObligationSourceRef,
  type ObligationValidatorRef
} from './obligation-inventory.ts';

export const COVERAGE_UNIVERSE_SCHEMA_ID = 'atm.coverageUniverse.v1' as const;
export const COVERAGE_UNIVERSE_COMPILER_ID = 'atm.coverageUniverseCompiler.v1' as const;

export type CoverageReachabilityStatus = 'reachable' | 'unreachable' | 'unsupported' | 'excluded' | 'unknown';

export interface CoverageUniverseModelInput {
  readonly modelId: string;
  readonly modelVersion?: string | null;
  readonly modelDigest?: string | null;
}

export interface CoverageUniverseObligationInput {
  readonly semanticKey: string;
  readonly semanticFamily: string;
  readonly owningSeam: string;
  readonly reachabilityStatus: CoverageReachabilityStatus;
  readonly sourceRefs?: readonly ObligationSourceRef[];
  readonly validatorRefs?: readonly ObligationValidatorRef[];
  readonly description?: string | null;
  readonly observedAt?: string | null;
  readonly exclusionReason?: string | null;
}

export interface CoverageUniverseCompileInput {
  readonly universeId: string;
  readonly generatedAt: string;
  readonly model: CoverageUniverseModelInput;
  readonly obligations: readonly CoverageUniverseObligationInput[];
}

export interface CoverageUniverseEntry {
  readonly obligationId: string;
  readonly semanticKey: string;
  readonly semanticFamily: string;
  readonly owningSeam: string;
  readonly reachabilityStatus: CoverageReachabilityStatus;
  readonly sourceRefs: readonly ObligationSourceRef[];
  readonly validatorRefs: readonly ObligationValidatorRef[];
  readonly description: string | null;
  readonly exclusionReason: string | null;
  readonly inventoryEntryDigest: string;
  readonly gapKind: 'none' | 'gap' | 'unsupported' | 'excluded' | 'unknown';
}

export interface CoverageUniverseGapCandidate {
  readonly obligationId: string;
  readonly semanticFamily: string;
  readonly owningSeam: string;
  readonly reachabilityStatus: CoverageReachabilityStatus;
  readonly reason: string;
  readonly candidateTestCaseId: string;
}

export interface CoverageUniverse {
  readonly schemaId: typeof COVERAGE_UNIVERSE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly compilerId: typeof COVERAGE_UNIVERSE_COMPILER_ID;
  readonly universeId: string;
  readonly generatedAt: string;
  readonly model: Required<CoverageUniverseModelInput>;
  readonly entries: readonly CoverageUniverseEntry[];
  readonly obligationInventory: ObligationInventory;
  readonly gapCandidates: readonly CoverageUniverseGapCandidate[];
  readonly reachabilitySummary: Record<CoverageReachabilityStatus, number>;
  readonly universeDigest: string;
}

export class CoverageUniverseCompiler {
  compile(input: CoverageUniverseCompileInput): CoverageUniverse {
    return compileCoverageUniverse(input);
  }
}

export function compileCoverageUniverse(input: CoverageUniverseCompileInput): CoverageUniverse {
  const model = normalizeModel(input.model);
  const normalizedInputs = normalizeObligationInputs(input.obligations);
  const inventory = createObligationInventory({
    inventoryId: `${normalizeText(input.universeId)}:obligations`,
    modelId: model.modelId,
    generatedAt: normalizeText(input.generatedAt),
    entries: normalizedInputs.map((entry) => ({
      obligationId: canonicalObligationId(entry),
      semanticFamily: entry.semanticFamily,
      owningSeam: entry.owningSeam,
      lifecycleStatus: entry.reachabilityStatus === 'excluded' ? 'excluded' : 'active',
      sourceRefs: entry.sourceRefs,
      validatorRefs: entry.validatorRefs,
      description: entry.description,
      observedAt: entry.observedAt
    }))
  });
  const inventoryEntriesById = new Map(inventory.entries.map((entry) => [entry.obligationId, entry]));

  const entries = normalizedInputs
    .map((entry): CoverageUniverseEntry => {
      const obligationId = canonicalObligationId(entry);
      const inventoryEntry = inventoryEntriesById.get(obligationId);
      if (!inventoryEntry) {
        throw new Error(`Coverage universe compiler lost obligation ${obligationId}`);
      }
      return {
        obligationId,
        semanticKey: entry.semanticKey,
        semanticFamily: entry.semanticFamily,
        owningSeam: entry.owningSeam,
        reachabilityStatus: entry.reachabilityStatus,
        sourceRefs: entry.sourceRefs,
        validatorRefs: entry.validatorRefs,
        description: entry.description,
        exclusionReason: entry.exclusionReason,
        inventoryEntryDigest: inventoryEntry.entryDigest,
        gapKind: gapKindFor(entry.reachabilityStatus)
      };
    })
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId));

  const gapCandidates = entries
    .filter((entry) => entry.gapKind !== 'none')
    .map((entry): CoverageUniverseGapCandidate => ({
      obligationId: entry.obligationId,
      semanticFamily: entry.semanticFamily,
      owningSeam: entry.owningSeam,
      reachabilityStatus: entry.reachabilityStatus,
      reason: gapReason(entry),
      candidateTestCaseId: candidateTestCaseId(entry)
    }));

  const reachabilitySummary = summarizeReachability(entries);
  const universeDigest = digestCanonical({
    universeId: normalizeText(input.universeId),
    model,
    inventoryDigest: inventory.inventoryDigest,
    entries: entries.map((entry) => ({
      obligationId: entry.obligationId,
      semanticKey: entry.semanticKey,
      semanticFamily: entry.semanticFamily,
      owningSeam: entry.owningSeam,
      reachabilityStatus: entry.reachabilityStatus,
      sourceRefs: entry.sourceRefs,
      validatorRefs: entry.validatorRefs,
      description: entry.description,
      exclusionReason: entry.exclusionReason,
      inventoryEntryDigest: entry.inventoryEntryDigest,
      gapKind: entry.gapKind
    })),
    gapCandidates,
    reachabilitySummary
  });

  return {
    schemaId: COVERAGE_UNIVERSE_SCHEMA_ID,
    specVersion: '0.1.0',
    compilerId: COVERAGE_UNIVERSE_COMPILER_ID,
    universeId: normalizeText(input.universeId),
    generatedAt: normalizeText(input.generatedAt),
    model,
    entries,
    obligationInventory: inventory,
    gapCandidates,
    reachabilitySummary,
    universeDigest
  };
}

function canonicalObligationId(input: NormalizedCoverageUniverseObligationInput): string {
  const readable = [
    slug(input.semanticFamily),
    slug(input.owningSeam),
    slug(input.semanticKey)
  ].filter(Boolean).join('.');
  const digest = digestCanonical({
    semanticKey: input.semanticKey,
    semanticFamily: input.semanticFamily,
    owningSeam: input.owningSeam,
    sourceRefs: input.sourceRefs
  }).slice('sha256:'.length, 'sha256:'.length + 12);
  return `atm.obligation:${readable}:${digest}`;
}

type NormalizedCoverageUniverseObligationInput = Required<Omit<CoverageUniverseObligationInput, 'observedAt' | 'description' | 'exclusionReason'>> & {
  readonly description: string | null;
  readonly observedAt: string | null;
  readonly exclusionReason: string | null;
};

function normalizeObligationInputs(values: readonly CoverageUniverseObligationInput[]): NormalizedCoverageUniverseObligationInput[] {
  return values
    .map((entry) => ({
      semanticKey: normalizeText(entry.semanticKey),
      semanticFamily: normalizeText(entry.semanticFamily),
      owningSeam: normalizeText(entry.owningSeam),
      reachabilityStatus: entry.reachabilityStatus,
      sourceRefs: normalizeSourceRefs(entry.sourceRefs),
      validatorRefs: normalizeValidatorRefs(entry.validatorRefs),
      description: normalizeNullableText(entry.description),
      observedAt: normalizeNullableText(entry.observedAt),
      exclusionReason: normalizeNullableText(entry.exclusionReason)
    }))
    .filter((entry) => entry.semanticKey && entry.semanticFamily && entry.owningSeam)
    .sort((left, right) =>
      left.semanticFamily.localeCompare(right.semanticFamily)
      || left.owningSeam.localeCompare(right.owningSeam)
      || left.semanticKey.localeCompare(right.semanticKey)
    );
}

function normalizeModel(input: CoverageUniverseModelInput): Required<CoverageUniverseModelInput> {
  return {
    modelId: normalizeText(input.modelId),
    modelVersion: normalizeNullableText(input.modelVersion),
    modelDigest: normalizeNullableText(input.modelDigest)
  };
}

function normalizeSourceRefs(values: readonly ObligationSourceRef[] = []): ObligationSourceRef[] {
  return values
    .map((entry) => ({ kind: entry.kind, ref: normalizeText(entry.ref) }))
    .filter((entry) => entry.ref)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
}

function normalizeValidatorRefs(values: readonly ObligationValidatorRef[] = []): ObligationValidatorRef[] {
  return values
    .map((entry) => ({ command: normalizeText(entry.command), caseId: normalizeNullableText(entry.caseId) }))
    .filter((entry) => entry.command)
    .sort((left, right) => left.command.localeCompare(right.command) || String(left.caseId ?? '').localeCompare(String(right.caseId ?? '')));
}

function gapKindFor(status: CoverageReachabilityStatus): CoverageUniverseEntry['gapKind'] {
  if (status === 'reachable') return 'none';
  if (status === 'unreachable') return 'gap';
  return status;
}

function gapReason(entry: CoverageUniverseEntry): string {
  if (entry.reachabilityStatus === 'unreachable') return 'Obligation is known but no reachable validator or execution path covers it.';
  if (entry.reachabilityStatus === 'unsupported') return 'Obligation belongs to a seam the current model cannot exercise.';
  if (entry.reachabilityStatus === 'excluded') return entry.exclusionReason ?? 'Obligation is explicitly excluded from this coverage universe.';
  return 'Obligation reachability is unknown and needs discovery or test generation.';
}

function candidateTestCaseId(entry: CoverageUniverseEntry): string {
  const digest = digestCanonical({
    obligationId: entry.obligationId,
    reachabilityStatus: entry.reachabilityStatus,
    owningSeam: entry.owningSeam
  }).slice('sha256:'.length, 'sha256:'.length + 8);
  return `test_candidate_${slug(entry.semanticFamily)}_${slug(entry.owningSeam)}_${digest}`;
}

function summarizeReachability(entries: readonly CoverageUniverseEntry[]): Record<CoverageReachabilityStatus, number> {
  const summary: Record<CoverageReachabilityStatus, number> = {
    reachable: 0,
    unreachable: 0,
    unsupported: 0,
    excluded: 0,
    unknown: 0
  };
  for (const entry of entries) {
    summary[entry.reachabilityStatus] += 1;
  }
  return summary;
}

function digestCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

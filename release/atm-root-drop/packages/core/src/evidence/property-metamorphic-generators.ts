import { createHash } from 'node:crypto';

export const PROPERTY_METAMORPHIC_GENERATORS_SCHEMA_ID = 'atm.propertyMetamorphicGenerators.v1' as const;

export type PropertyMetamorphicStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';

export interface PropertyAuthority {
  readonly authorityId: string;
  readonly digest: string;
  readonly sealed: boolean;
}

export interface PropertyRelation {
  readonly relationId: string;
  readonly inputDigest: string;
  readonly transformedDigest: string;
  readonly expectedRelation: 'equal' | 'subset' | 'superset' | 'different' | string;
  readonly observedRelation?: string;
}

export interface PropertyGeneratorInput {
  readonly authority: PropertyAuthority;
  readonly generatorId: string;
  readonly relations: readonly PropertyRelation[];
  readonly sourceDigest: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface PropertyGeneratorResult {
  readonly schemaId: typeof PROPERTY_METAMORPHIC_GENERATORS_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly generatorId: string;
  readonly authority: PropertyAuthority;
  readonly relations: readonly PropertyRelation[];
  readonly generatedCaseIds: readonly string[];
  readonly status: PropertyMetamorphicStatus;
  readonly diagnostics: readonly string[];
  readonly repairCommand: string | null;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly resultDigest: string;
}

export function compilePropertyMetamorphicGenerators(input: PropertyGeneratorInput): PropertyGeneratorResult {
  const normalized = normalizeInput(input);
  const diagnostics = collectDiagnostics(normalized);
  const generatedCaseIds = normalized.relations.map((relation) =>
    `case:${sha256(`${normalized.generatorId}|${relation.relationId}`)}`,
  );
  const status = deriveStatus(diagnostics);
  const repairCommand = status === 'proven'
    ? null
    : 'restore the sealed property authority and supported relation evidence, then regenerate';
  const result = {
    schemaId: PROPERTY_METAMORPHIC_GENERATORS_SCHEMA_ID,
    specVersion: '0.1.0' as const,
    generatorId: normalized.generatorId,
    authority: normalized.authority,
    relations: normalized.relations,
    generatedCaseIds,
    status,
    diagnostics,
    repairCommand,
    provenance: normalized.provenance,
  };
  return { ...result, resultDigest: resultDigest(result) };
}

export const createPropertyMetamorphicGenerators = compilePropertyMetamorphicGenerators;

export function replayPropertyMetamorphicGenerators(result: PropertyGeneratorResult): PropertyGeneratorResult {
  return compilePropertyMetamorphicGenerators({
    authority: result.authority,
    generatorId: result.generatorId,
    relations: result.relations,
    sourceDigest: result.authority.digest,
    provenance: result.provenance,
  });
}

export function validatePropertyMetamorphicGenerators(result: PropertyGeneratorResult) {
  const replayed = replayPropertyMetamorphicGenerators(result);
  const diagnostics = [...result.diagnostics];
  if (resultDigest(result) !== result.resultDigest || replayed.resultDigest !== result.resultDigest) {
    diagnostics.push('result-digest-mismatch');
  }
  return { ok: diagnostics.length === 0 && result.status === 'proven', diagnostics: [...new Set(diagnostics)] };
}

function collectDiagnostics(input: ReturnType<typeof normalizeInput>): string[] {
  const diagnostics: string[] = [];
  if (!input.authority.authorityId || !input.authority.digest || !input.authority.sealed) diagnostics.push('authority-incomplete');
  if (!input.generatorId || !input.sourceDigest || !input.relations.length) diagnostics.push('generator-incomplete');
  if (input.sourceDigest !== input.authority.digest) diagnostics.push('source-authority-drift');
  const seen = new Set<string>();
  for (const relation of input.relations) {
    if (seen.has(relation.relationId)) diagnostics.push(`duplicate-relation:${relation.relationId}`);
    seen.add(relation.relationId);
    if (!relation.relationId || !relation.inputDigest || !relation.transformedDigest) diagnostics.push(`invalid-relation:${relation.relationId}`);
    if (!['equal', 'subset', 'superset', 'different'].includes(relation.expectedRelation)) diagnostics.push(`unsupported-relation:${relation.relationId}`);
    if (relation.observedRelation && relation.observedRelation !== relation.expectedRelation) diagnostics.push(`relation-mismatch:${relation.relationId}`);
  }
  return diagnostics;
}

function deriveStatus(diagnostics: readonly string[]): PropertyMetamorphicStatus {
  if (diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('invalid-') || entry === 'authority-incomplete' || entry === 'generator-incomplete')) return 'contradictory';
  if (diagnostics.some((entry) => entry === 'source-authority-drift')) return 'stale';
  if (diagnostics.some((entry) => entry.startsWith('unsupported-') || entry.startsWith('relation-mismatch'))) return 'blocked';
  return 'proven';
}

function normalizeInput(input: PropertyGeneratorInput) {
  return {
    authority: input.authority,
    generatorId: String(input.generatorId ?? '').trim(),
    sourceDigest: String(input.sourceDigest ?? '').trim(),
    relations: [...(input.relations ?? [])]
      .map((relation) => ({
        ...relation,
        relationId: String(relation.relationId ?? '').trim(),
        inputDigest: String(relation.inputDigest ?? '').trim(),
        transformedDigest: String(relation.transformedDigest ?? '').trim(),
        expectedRelation: String(relation.expectedRelation ?? '').trim(),
        observedRelation: relation.observedRelation == null ? undefined : String(relation.observedRelation).trim(),
      }))
      .sort((left, right) => left.relationId.localeCompare(right.relationId)),
    provenance: input.provenance ?? {},
  };
}

function resultDigest(result: Omit<PropertyGeneratorResult, 'resultDigest'> | PropertyGeneratorResult): string {
  const { resultDigest: _existingDigest, ...payload } = result as PropertyGeneratorResult;
  return `sha256:${sha256(stableJson(payload))}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)))
      : entry
  ));
}

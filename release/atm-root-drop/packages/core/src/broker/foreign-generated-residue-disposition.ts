import { createHash } from 'node:crypto';

export const FOREIGN_GENERATED_RESIDUE_DISPOSITION_SCHEMA_ID = 'atm.foreignGeneratedResidueDisposition.v1';

export interface ForeignGeneratedResidueProvenance {
  readonly path: string;
  readonly observedDigest: `sha256:${string}`;
  readonly producerTaskId: string;
  readonly artifactSchemaId: string;
  readonly sourceSnapshotSchemaId: string;
  readonly sourceDigest: `sha256:${string}`;
}

export interface ForeignGeneratedResidueDisposition {
  readonly schemaId: typeof FOREIGN_GENERATED_RESIDUE_DISPOSITION_SCHEMA_ID;
  readonly state: 'deferred' | 'blocked';
  readonly reason: string;
  readonly provenance: ForeignGeneratedResidueProvenance | null;
}

/**
 * Pure evidence classifier for a foreign generated artifact. It deliberately
 * does not grant a write capability; callers may only carry a deferred
 * observation forward in an admission ticket.
 */
export function classifyForeignGeneratedResidue(input: {
  readonly path: string;
  readonly content: string | null;
  readonly candidateTaskId: string;
  readonly producerDeclaresPath: boolean;
  readonly runnerInventoryMember: boolean;
}): ForeignGeneratedResidueDisposition {
  const filePath = normalizePath(input.path);
  if (input.runnerInventoryMember) return blocked('runner-publication inventory owns this output');
  if (!filePath.startsWith('artifacts/generated/')) return blocked('path is not a generated artifact surface');
  if (!input.content) return blocked('generated artifact content is unavailable');
  let document: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return blocked('artifact is not a structured object');
    document = parsed as Record<string, unknown>;
  } catch {
    return blocked('artifact is not valid JSON');
  }
  const taskId = readText(document.taskId);
  const schemaId = readAtmSchema(document.schemaId);
  const snapshot = asRecord(document.sourceSnapshot);
  const snapshotSchema = readAtmSchema(snapshot?.schemaId);
  const sourceDigest = readDigest(snapshot?.sourceDigest);
  if (!taskId || taskId === input.candidateTaskId || !schemaId || !snapshotSchema || !sourceDigest || !input.producerDeclaresPath) {
    return blocked('artifact lacks a distinct governed producer declaration or source-snapshot proof');
  }
  return {
    schemaId: FOREIGN_GENERATED_RESIDUE_DISPOSITION_SCHEMA_ID,
    state: 'deferred',
    reason: 'foreign generated artifact has a distinct governed producer, declared path, and source-snapshot digest; observation is deferred without write authority',
    provenance: {
      path: filePath,
      observedDigest: digest(input.content),
      producerTaskId: taskId,
      artifactSchemaId: schemaId,
      sourceSnapshotSchemaId: snapshotSchema,
      sourceDigest
    }
  };
}

function blocked(reason: string): ForeignGeneratedResidueDisposition {
  return { schemaId: FOREIGN_GENERATED_RESIDUE_DISPOSITION_SCHEMA_ID, state: 'blocked', reason, provenance: null };
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function readAtmSchema(value: unknown): string | null {
  const text = readText(value);
  return text?.startsWith('atm.') ? text : null;
}
function readDigest(value: unknown): `sha256:${string}` | null {
  const text = readText(value);
  return text && /^sha256:[a-f0-9]{64}$/i.test(text) ? text as `sha256:${string}` : null;
}
function normalizePath(value: string): string { return value.replace(/\\/g, '/').replace(/^\.\//, ''); }
function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }

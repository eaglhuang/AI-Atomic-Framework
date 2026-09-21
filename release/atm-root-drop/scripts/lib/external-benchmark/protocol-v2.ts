import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

export interface EvidenceRef { uri: string; digest: string }
export interface OperationV2 {
  operationId: string;
  truth: 'benign' | 'conflict' | 'unknown';
  decision: 'allowed' | 'blocked' | 'unknown';
  denominator: 'false-block' | 'missed-conflict' | 'unavailable';
}
export interface BenchmarkV2 {
  schemaId: 'atm.externalBenchmarkRun.v2';
  protocolVersion: '2.0.0';
  runId: string;
  pairId: string;
  clusterId: string;
  arm: 'baseline' | 'atm';
  sequence: 'AB' | 'BA';
  completion: 'completed' | 'failed' | 'aborted' | 'unknown';
  operations: OperationV2[];
  cost: {
    inputTokens: number | null; outputTokens: number | null;
    billedCost: number | null; currency: string;
    humanMinutes: number | null; computeCost: number | null;
    billingEvidence: EvidenceRef | null; humanEvidence: EvidenceRef | null;
  };
  independence: {
    sponsorController: string;
    operator: { actorId: string; controllerId: string; keyId: string | null };
    custodian: { actorId: string; controllerId: string; keyId: string | null };
    adjudicator: { actorId: string; controllerId: string; keyId: string | null };
    isolationEvidence: EvidenceRef | null;
    controllerEvidence: EvidenceRef | null;
  };
  gates: {
    preRun: { package: EvidenceRef | null; corpusSeal: EvidenceRef | null };
    postRun: { adjudication: EvidenceRef | null; telemetry: EvidenceRef | null };
  };
}

const schema = JSON.parse(readFileSync(new URL('../../../schemas/evidence/external-benchmark-v2.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);

/** Parse only; no coercion, defaults, file writes, or implicit v1 migration. */
export function parseBenchmarkV2(input: unknown): BenchmarkV2 {
  if (!validate(input)) throw new Error(`Invalid benchmark v2: ${JSON.stringify(validate.errors)}`);
  const record = structuredClone(input) as BenchmarkV2;
  const ids = new Set<string>();
  for (const operation of record.operations) {
    if (ids.has(operation.operationId)) throw new Error('Duplicate operation identity');
    ids.add(operation.operationId);
    const denominator = operation.truth === 'unknown' || operation.decision === 'unknown'
      ? 'unavailable' : operation.truth === 'benign' ? 'false-block' : 'missed-conflict';
    if (operation.denominator !== denominator) throw new Error('Operation denominator disagrees with observed truth/decision');
  }
  if (record.cost.billedCost !== null && !record.cost.billingEvidence) throw new Error('Known billing requires evidence, including zero');
  if (record.cost.humanMinutes !== null && !record.cost.humanEvidence) throw new Error('Known human time requires evidence, including zero');
  return record;
}

/** Byte preservation is intentionally separate from JSON canonicalization. */
export function assertSealedBytes(bytes: Uint8Array, expectedDigest: string): string {
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== expectedDigest) throw new Error('Sealed bytes do not match expected seal');
  return digest;
}

export type EvidencePurpose = 'isolation' | 'controllers' | 'package' | 'corpusSeal' | 'adjudication' | 'telemetry';
/** Verifier must bind both the evidence bytes and their meaning to this run. */
export type EvidenceVerifier = (ref: EvidenceRef, purpose: EvidencePurpose, record: BenchmarkV2) => boolean;
export type IndependenceLevel = 'internal-cross-check' | 'isolated-internal' | 'external-operator' | 'external-custody-adjudication';
const unverified: EvidenceVerifier = () => false;

function verifiedRef(ref: EvidenceRef | null, purpose: EvidencePurpose, record: BenchmarkV2, verify: EvidenceVerifier): boolean {
  if (!ref) return false;
  try { return verify(ref, purpose, structuredClone(record)) === true; } catch { return false; }
}

export function assessIndependence(input: BenchmarkV2, verify: EvidenceVerifier = unverified): IndependenceLevel {
  const record = parseBenchmarkV2(input);
  const role = record.independence;
  if (!verifiedRef(role.isolationEvidence, 'isolation', record, verify)) return 'internal-cross-check';
  if (!verifiedRef(role.controllerEvidence, 'controllers', record, verify)) return 'isolated-internal';
  if (role.operator.controllerId === role.sponsorController) return 'isolated-internal';
  const actors = [role.operator, role.custodian, role.adjudicator];
  // Contradictory identity/key ownership is not evidence of separate control.
  for (const actor of actors) {
    if (actors.some(other => other.controllerId !== actor.controllerId &&
      (other.actorId === actor.actorId || (actor.keyId !== null && other.keyId === actor.keyId)))) return 'isolated-internal';
  }
  const controllers = [role.sponsorController, ...actors.map(actor => actor.controllerId)];
  return new Set(controllers).size === controllers.length ? 'external-custody-adjudication' : 'external-operator';
}

export function assessGates(input: BenchmarkV2, verify: EvidenceVerifier = unverified): { preRunReady: boolean; postRunReady: boolean } {
  const record = parseBenchmarkV2(input);
  const preRunReady = Object.entries(record.gates.preRun).every(([purpose, ref]) =>
    verifiedRef(ref, purpose as EvidencePurpose, record, verify));
  const postRunReady = preRunReady && Object.entries(record.gates.postRun).every(([purpose, ref]) =>
    verifiedRef(ref, purpose as EvidencePurpose, record, verify));
  return { preRunReady, postRunReady };
}

import { createHash, verify } from 'node:crypto';
import { calculateAdjudicationRates, type OracleAdjudication } from './adjudication.ts';
import { aggregateRawRuns, type RawBenchmarkRun } from './metrics.ts';
import { decideBenchmark, type BenchmarkDecision } from './report.ts';

export interface ProtocolManifest {
  readonly protocolVersion?: string;
  readonly preregistrationDigest?: string;
  readonly arms: { readonly atm: { readonly packageAvailability: 'sealed' | 'unavailable'; readonly packageVersion: string | null; readonly packageTarballSha256: string | null; readonly workspaceLink: boolean } };
  readonly oracle?: {
    readonly hiddenCorpusOwner: string;
    readonly adjudicator: string;
    readonly baselineImplementer: string;
    readonly atmImplementer: string;
  };
  readonly executionPrerequisites: Record<string, { readonly sealed: boolean; readonly evidenceDigest: string | null }>;
  readonly runEligibility: { readonly phase?: 'pre-run'; readonly eligible: boolean; readonly blockingReasons: readonly string[] };
}

export interface ExternalPrerequisiteArtifacts {
  readonly hiddenCorpusAcceptance?: unknown;
  readonly independentAdjudication?: unknown;
  readonly providerTelemetry?: unknown;
  readonly providerRawExport?: Uint8Array;
}

const PRE_RUN_PREREQUISITES = [
  'publicNpm',
  'hiddenCorpusAcceptance'
] as const;

const FINAL_DECISION_PREREQUISITES = [
  'publicNpm',
  'hiddenCorpusAcceptance',
  'independentAdjudication',
  'providerTelemetry'
] as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonSha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function collectMissingPrerequisites(
  protocol: Pick<ProtocolManifest, 'executionPrerequisites'>,
  phase: 'pre-run' | 'final-decision'
): readonly string[] {
  const required = phase === 'pre-run' ? PRE_RUN_PREREQUISITES : FINAL_DECISION_PREREQUISITES;
  return required.filter((name) => {
    const prerequisite = protocol.executionPrerequisites[name];
    return !prerequisite || !prerequisite.sealed || !SHA256.test(prerequisite.evidenceDigest ?? '');
  });
}

export function computePreregistrationDigest(protocol: ProtocolManifest): string {
  const { preregistrationDigest: _preregistrationDigest, executionPrerequisites: _executionPrerequisites, runEligibility: _runEligibility, ...sealedProtocol } = protocol as unknown as Record<string, unknown>;
  return canonicalJsonSha256(sealedProtocol);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonEmptyString(record: Record<string, unknown>, field: string): boolean {
  return typeof record[field] === 'string' && record[field].trim().length > 0;
}

function isoTimestamp(record: Record<string, unknown>, field: string): boolean {
  return nonEmptyString(record, field) && Number.isFinite(Date.parse(record[field] as string));
}

function sha256Field(record: Record<string, unknown>, field: string): boolean {
  return typeof record[field] === 'string' && SHA256.test(record[field] as string);
}

function verifyDetachedSignature(record: Record<string, unknown>): boolean {
  const signature = typeof record.signature === 'string' ? record.signature : null;
  const publicKeyPem = typeof record.publicKeyPem === 'string' ? record.publicKeyPem : null;
  if (!signature || !publicKeyPem) return false;
  const { signature: _signature, publicKeyPem: _publicKeyPem, ...payload } = record;
  try {
    return verify(null, Buffer.from(canonicalJson(payload)), publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function verifyArtifact(
  name: string,
  value: unknown,
  expected: { readonly schemaId: string; readonly signerRole: string; readonly digest: string | null },
  protocol: ProtocolManifest
): string | null {
  const record = asRecord(value);
  if (!record) return `${name} artifact is missing or not a JSON object`;
  if (record.schemaId !== expected.schemaId) return `${name} artifact schemaId is invalid`;
  if (record.signerRole !== expected.signerRole) return `${name} artifact signer role is invalid`;
  if (!protocol.protocolVersion || record.protocolVersion !== protocol.protocolVersion) return `${name} artifact protocol version does not match preregistration`;
  if (!protocol.preregistrationDigest || record.protocolDigest !== protocol.preregistrationDigest) return `${name} artifact protocol digest does not match preregistration`;
  if (!SHA256.test(expected.digest ?? '') || canonicalJsonSha256(record) !== expected.digest) return `${name} artifact digest does not match sealed evidence`;
  if (!verifyDetachedSignature(record)) return `${name} artifact detached signature is invalid`;
  return null;
}

function verifyArtifactSemantics(name: string, record: Record<string, unknown>): string | null {
  if (!nonEmptyString(record, 'signerId')) return `${name} artifact must name a non-empty signer identity`;
  if (name === 'hidden corpus acceptance') {
    if (!nonEmptyString(record, 'corpusId') || !sha256Field(record, 'corpusDigest') || record.visibility !== 'oracle-only' || !isoTimestamp(record, 'acceptedAt')) {
      return 'hidden corpus acceptance artifact must bind corpusId, corpusDigest, oracle-only visibility, and acceptedAt';
    }
  }
  if (name === 'independent adjudication') {
    if (!nonEmptyString(record, 'hiddenCorpusOwner') || !sha256Field(record, 'inputDigest') || !sha256Field(record, 'outputDigest') || !isoTimestamp(record, 'labeledAt')) {
      return 'independent adjudication artifact must bind hiddenCorpusOwner, inputDigest, outputDigest, and labeledAt';
    }
  }
  if (name === 'provider telemetry') {
    if (!nonEmptyString(record, 'provider') || !sha256Field(record, 'rawExportSha256') || !isoTimestamp(record, 'observedAt') || !Array.isArray(record.runIds) || record.runIds.length === 0 || record.runIds.some((runId) => typeof runId !== 'string' || runId.length === 0)) {
      return 'provider telemetry artifact must bind provider, rawExportSha256, observedAt, and non-empty runIds';
    }
  }
  return null;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((value) => right.includes(value));
}

function verifyRunBindings(protocol: ProtocolManifest, runs: readonly RawBenchmarkRun[], adjudications: readonly OracleAdjudication[], artifacts: ExternalPrerequisiteArtifacts): readonly string[] {
  if (runs.length === 0 && adjudications.length === 0) return [];
  const reasons: string[] = [];
  const telemetry = asRecord(artifacts.providerTelemetry);
  const adjudicationManifest = asRecord(artifacts.independentAdjudication);
  const oracle = protocol.oracle;
  if (!oracle) return ['protocol oracle identities are required before external evidence can be consumed'];
  const runIds = runs.map((run) => run.runId);
  const telemetryRunIds = Array.isArray(telemetry?.runIds) ? telemetry.runIds.filter((runId): runId is string => typeof runId === 'string') : [];
  if (!sameSet(runIds, telemetryRunIds)) reasons.push('provider telemetry runIds must cover each raw run exactly once');
  if (adjudicationManifest?.inputDigest !== canonicalJsonSha256(runs)) reasons.push('independent adjudication input digest does not bind the supplied raw runs');
  if (adjudicationManifest?.outputDigest !== canonicalJsonSha256(adjudications)) reasons.push('independent adjudication output digest does not bind the supplied adjudications');
  const runsById = new Map(runs.map((run) => [run.runId, run]));
  if (runsById.size !== runs.length) reasons.push('raw run IDs must be unique');
  if (new Set(adjudications.map((record) => record.runId)).size !== adjudications.length || adjudications.length !== runs.length) reasons.push('each raw run must have exactly one independent adjudication');
  for (const record of adjudications) {
    const run = runsById.get(record.runId);
    const expectedImplementer = record.arm === 'baseline' ? oracle.baselineImplementer : oracle.atmImplementer;
    if (!run || run.arm !== record.arm || record.hiddenCorpusOwner !== oracle.hiddenCorpusOwner || record.adjudicator !== oracle.adjudicator || record.implementer !== expectedImplementer) {
      reasons.push('adjudications must bind each raw run to the preregistered oracle, adjudicator, and arm implementer identities');
      break;
    }
  }
  return reasons;
}

export function verifyExternalPrerequisites(protocol: ProtocolManifest, artifacts: ExternalPrerequisiteArtifacts | undefined): readonly string[] {
  if (!artifacts) return ['verified external prerequisite artifacts are required'];
  const checks: Array<[string, unknown, { readonly schemaId: string; readonly signerRole: string; readonly digest: string | null }]> = [
    ['hidden corpus acceptance', artifacts.hiddenCorpusAcceptance, { schemaId: 'atm.hiddenCorpusAcceptance.v1', signerRole: 'hidden-corpus-custodian', digest: protocol.executionPrerequisites.hiddenCorpusAcceptance?.evidenceDigest ?? null }],
    ['independent adjudication', artifacts.independentAdjudication, { schemaId: 'atm.adjudicationManifest.v1', signerRole: 'independent-adjudicator', digest: protocol.executionPrerequisites.independentAdjudication?.evidenceDigest ?? null }],
    ['provider telemetry', artifacts.providerTelemetry, { schemaId: 'atm.providerCostTelemetry.v1', signerRole: 'provider-telemetry', digest: protocol.executionPrerequisites.providerTelemetry?.evidenceDigest ?? null }]
  ];
  const reasons = checks.map(([name, value, expected]) => verifyArtifact(name, value, expected, protocol)).filter((reason): reason is string => reason !== null);
  const telemetry = asRecord(artifacts.providerTelemetry);
  const hiddenCorpusAcceptance = asRecord(artifacts.hiddenCorpusAcceptance);
  const independentAdjudication = asRecord(artifacts.independentAdjudication);
  for (const [name, record] of [['hidden corpus acceptance', hiddenCorpusAcceptance], ['independent adjudication', independentAdjudication], ['provider telemetry', telemetry]] as const) {
    if (record) {
      const semanticFailure = verifyArtifactSemantics(name, record);
      if (semanticFailure) reasons.push(semanticFailure);
    }
  }
  const signerIds = [hiddenCorpusAcceptance?.signerId, independentAdjudication?.signerId, telemetry?.signerId];
  if (signerIds.some((signerId) => typeof signerId !== 'string' || signerId.length === 0)) {
    reasons.push('external prerequisite artifacts must each name a signer identity');
  } else if (new Set(signerIds).size !== signerIds.length) {
    reasons.push('hidden corpus, adjudication, and provider telemetry artifacts must have distinct signer identities');
  }
  const publicKeys = [hiddenCorpusAcceptance?.publicKeyPem, independentAdjudication?.publicKeyPem, telemetry?.publicKeyPem];
  if (publicKeys.every((key) => typeof key === 'string' && key.length > 0) && new Set(publicKeys).size !== publicKeys.length) {
    reasons.push('hidden corpus, adjudication, and provider telemetry artifacts must use distinct signing keys');
  }
  if (protocol.oracle && (hiddenCorpusAcceptance?.signerId !== protocol.oracle.hiddenCorpusOwner || independentAdjudication?.signerId !== protocol.oracle.adjudicator)) {
    reasons.push('hidden corpus and adjudication signer identities must match the preregistered oracle roles');
  }
  if (independentAdjudication?.hiddenCorpusOwner !== hiddenCorpusAcceptance?.signerId) {
    reasons.push('independent adjudication must bind to the hidden-corpus custodian signer identity');
  }
  const rawExportDigest = typeof telemetry?.rawExportSha256 === 'string' ? telemetry.rawExportSha256 : null;
  const observedRawExportDigest = artifacts.providerRawExport ? `sha256:${createHash('sha256').update(artifacts.providerRawExport).digest('hex')}` : null;
  if (!SHA256.test(rawExportDigest ?? '') || rawExportDigest !== observedRawExportDigest) reasons.push('provider telemetry raw export digest does not match the supplied original export');
  return reasons;
}

export function executeExternalBenchmark(protocol: ProtocolManifest, runs: readonly RawBenchmarkRun[], adjudications: readonly OracleAdjudication[], artifacts?: ExternalPrerequisiteArtifacts): BenchmarkDecision {
  const packageSealed = protocol.arms.atm.packageAvailability === 'sealed' && protocol.arms.atm.packageVersion !== null && protocol.arms.atm.packageTarballSha256 !== null && protocol.arms.atm.workspaceLink === false;
  const missingPrerequisites = collectMissingPrerequisites(protocol, 'final-decision');
  if (!protocol.runEligibility.eligible || !packageSealed || missingPrerequisites.length > 0) {
    return decideBenchmark({ eligible: false, blockingReasons: protocol.runEligibility.blockingReasons.length ? protocol.runEligibility.blockingReasons : missingPrerequisites.length ? missingPrerequisites : ['published ATM package is not sealed'] , rounds: [] });
  }
  const prerequisiteFailures = verifyExternalPrerequisites(protocol, artifacts);
  if (prerequisiteFailures.length > 0) return decideBenchmark({ eligible: false, blockingReasons: prerequisiteFailures, rounds: [] });
  const bindingFailures = verifyRunBindings(protocol, runs, adjudications, artifacts!);
  if (bindingFailures.length > 0) return decideBenchmark({ eligible: false, blockingReasons: bindingFailures, rounds: [] });
  const baseline = aggregateRawRuns(runs, 'baseline');
  const atm = aggregateRawRuns(runs, 'atm');
  const baselineSafety = calculateAdjudicationRates(adjudications, 'baseline');
  const atmSafety = calculateAdjudicationRates(adjudications, 'atm');
  const rounds = [...new Set(runs.map((run) => run.sequence))];
  return decideBenchmark({ eligible: true, blockingReasons: [], rounds, baseline, atm, baselineSafety, atmSafety });
}

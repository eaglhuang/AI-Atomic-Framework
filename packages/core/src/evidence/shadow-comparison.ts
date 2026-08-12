import { createHash } from 'node:crypto';

export const SHADOW_COMPARISON_SCHEMA_ID = 'atm.shadowComparison.v1' as const;
export type ShadowOutcome = 'pass' | 'fail' | 'unknown';
export type ShadowStatus = 'proven' | 'blocked';

export interface ShadowCase {
  readonly caseId: string;
  readonly selected: boolean;
  readonly legacy: ShadowOutcome;
  readonly selectedResult: ShadowOutcome;
  readonly latencyMs: number;
  readonly cached?: boolean;
}

export interface ShadowCandidateIdentity {
  readonly sourceDigest: string;
  readonly runnerDigest: string;
  readonly catalogDigest: string;
  readonly candidateDigest: string;
}

export interface ShadowCommandReceipt {
  readonly command: string;
  readonly runId: string;
  readonly artifactPath?: string | null;
  readonly stale?: boolean;
}

export interface ShadowComparisonInput {
  readonly authorityDigest: string;
  readonly policyEpoch: string;
  readonly selectedCandidate: ShadowCandidateIdentity;
  readonly fullCandidate: ShadowCandidateIdentity;
  readonly cases?: readonly ShadowCase[];
  readonly legacyLatencyMs?: number;
  readonly selectedCommand?: ShadowCommandReceipt | null;
  readonly fullCommand?: ShadowCommandReceipt | null;
}

export interface ShadowComparisonResult {
  readonly schemaId: typeof SHADOW_COMPARISON_SCHEMA_ID;
  readonly status: ShadowStatus;
  readonly policyEpoch: string;
  readonly policyEpochValid: boolean;
  readonly candidate: {
    readonly sourceDigest: string;
    readonly runnerDigest: string;
    readonly catalogDigest: string;
    readonly candidateDigest: string;
    readonly sameCandidate: boolean;
  };
  readonly commands: {
    readonly selected: ShadowCommandReceipt | null;
    readonly full: ShadowCommandReceipt | null;
  };
  readonly selected: readonly string[];
  readonly skipped: readonly string[];
  readonly falseBlocks: readonly string[];
  readonly escapedDefects: readonly string[];
  readonly unknown: readonly string[];
  readonly latency: { readonly selectedMs: number; readonly legacyMs: number };
  readonly cache: { readonly hits: number; readonly misses: number; readonly invalidated: boolean };
  readonly legacyAuthority: readonly { readonly caseId: string; readonly result: string }[];
  readonly diagnostics: readonly string[];
  readonly negativeControls: readonly string[];
  readonly resultDigest: string;
}

export function compareShadow(input: ShadowComparisonInput): ShadowComparisonResult {
  const cases = [...(input?.cases ?? [])].sort((a, b) => text(a.caseId).localeCompare(text(b.caseId)));
  const selected = cases.filter((item) => item.selected).map((item) => text(item.caseId));
  const skipped = cases.filter((item) => !item.selected).map((item) => text(item.caseId));
  const falseBlocks = cases
    .filter((item) => !item.selected && item.legacy === 'pass' && item.selectedResult === 'fail')
    .map((item) => text(item.caseId));
  const escapedDefects = cases
    .filter((item) => item.legacy === 'fail' && item.selectedResult === 'pass')
    .map((item) => text(item.caseId));
  const unknown = cases
    .filter((item) => item.legacy === 'unknown' || item.selectedResult === 'unknown')
    .map((item) => text(item.caseId));

  const diagnostics: string[] = [];
  const selectedCandidate = normalizeCandidate(input?.selectedCandidate);
  const fullCandidate = normalizeCandidate(input?.fullCandidate);
  const sameCandidate = candidateDigest(selectedCandidate) === candidateDigest(fullCandidate);

  if (!isDigest(input?.authorityDigest)) diagnostics.push('authority-missing-or-invalid');
  if (!text(input?.policyEpoch)) diagnostics.push('policy-epoch-missing');
  if (!candidateComplete(selectedCandidate)) diagnostics.push('selected-candidate-incomplete');
  if (!candidateComplete(fullCandidate)) diagnostics.push('full-candidate-incomplete');
  if (candidateComplete(selectedCandidate) && candidateComplete(fullCandidate) && !sameCandidate) diagnostics.push('candidate-digest-mismatch');
  if (!input?.selectedCommand) diagnostics.push('selected-command-missing');
  if (!input?.fullCommand) diagnostics.push('full-source-missing');
  if (input?.selectedCommand?.stale) diagnostics.push('selected-receipt-stale');
  if (input?.fullCommand?.stale) diagnostics.push('full-receipt-stale');
  if (escapedDefects.length) diagnostics.push('escaped-defect-invalidates-policy-epoch');
  if (unknown.length) diagnostics.push('unknown-shadow-data');

  const status: ShadowStatus = diagnostics.length ? 'blocked' : 'proven';
  const policyEpochValid = status === 'proven';
  const resultCore = {
    authorityDigest: text(input?.authorityDigest),
    policyEpoch: text(input?.policyEpoch),
    selectedCandidate,
    fullCandidate,
    cases,
    diagnostics
  };

  return {
    schemaId: SHADOW_COMPARISON_SCHEMA_ID,
    status,
    policyEpoch: text(input?.policyEpoch),
    policyEpochValid,
    candidate: {
      sourceDigest: selectedCandidate.sourceDigest,
      runnerDigest: selectedCandidate.runnerDigest,
      catalogDigest: selectedCandidate.catalogDigest,
      candidateDigest: selectedCandidate.candidateDigest,
      sameCandidate
    },
    commands: {
      selected: normalizeCommand(input?.selectedCommand),
      full: normalizeCommand(input?.fullCommand)
    },
    selected,
    skipped,
    falseBlocks,
    escapedDefects,
    unknown,
    latency: {
      selectedMs: cases.filter((item) => item.selected).reduce((sum, item) => sum + Math.max(0, Number(item.latencyMs) || 0), 0),
      legacyMs: Math.max(0, Number(input?.legacyLatencyMs) || 0)
    },
    cache: {
      hits: cases.filter((item) => item.cached === true).length,
      misses: cases.filter((item) => item.cached !== true).length,
      invalidated: !policyEpochValid
    },
    legacyAuthority: cases.map((item) => ({ caseId: text(item.caseId), result: item.legacy })),
    diagnostics: unique(diagnostics),
    negativeControls: [
      'candidate-digest-mismatch',
      'full-source-missing',
      'selected-receipt-stale',
      'full-receipt-stale',
      'escaped-defect-invalidates-policy-epoch',
      'unknown-shadow-data'
    ],
    resultDigest: digest(resultCore)
  };
}

export const compileShadowComparison = compareShadow;

export function validateShadowComparison(result: ShadowComparisonResult): { readonly ok: boolean; readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = [];
  if (result.schemaId !== SHADOW_COMPARISON_SCHEMA_ID) diagnostics.push('invalid-schema');
  if (result.status === 'proven' && (!result.policyEpochValid || result.cache.invalidated || !result.candidate.sameCandidate || result.escapedDefects.length || result.unknown.length || result.diagnostics.length)) diagnostics.push('invalid-proven-verdict');
  if (result.status === 'blocked' && (result.policyEpochValid || !result.cache.invalidated || !result.diagnostics.length)) diagnostics.push('invalid-blocked-verdict');
  if (result.escapedDefects.length && !result.diagnostics.includes('escaped-defect-invalidates-policy-epoch')) diagnostics.push('escaped-defect-diagnostic-missing');
  if (!result.commands.full && !result.diagnostics.includes('full-source-missing')) diagnostics.push('full-source-diagnostic-missing');
  if (!result.candidate.sameCandidate && !result.diagnostics.includes('candidate-digest-mismatch')) diagnostics.push('candidate-mismatch-diagnostic-missing');
  return { ok: diagnostics.length === 0, diagnostics };
}

function normalizeCandidate(candidate: ShadowCandidateIdentity | undefined): ShadowCandidateIdentity {
  return {
    sourceDigest: text(candidate?.sourceDigest),
    runnerDigest: text(candidate?.runnerDigest),
    catalogDigest: text(candidate?.catalogDigest),
    candidateDigest: text(candidate?.candidateDigest)
  };
}

function normalizeCommand(command: ShadowCommandReceipt | null | undefined): ShadowCommandReceipt | null {
  if (!command) return null;
  return {
    command: text(command.command),
    runId: text(command.runId),
    artifactPath: command.artifactPath == null ? null : text(command.artifactPath),
    stale: command.stale === true
  };
}

function candidateComplete(candidate: ShadowCandidateIdentity): boolean {
  return isDigest(candidate.sourceDigest) && isDigest(candidate.runnerDigest) && isDigest(candidate.catalogDigest) && isDigest(candidate.candidateDigest);
}

function candidateDigest(candidate: ShadowCandidateIdentity): string {
  return digest(candidate);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isDigest(value: unknown): value is string {
  return /^sha256:[a-f0-9]{64}$/i.test(text(value));
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

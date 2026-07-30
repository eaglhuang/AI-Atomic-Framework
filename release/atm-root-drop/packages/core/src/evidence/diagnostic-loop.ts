import { createHash } from 'node:crypto';

export const DIAGNOSTIC_LOOP_RECEIPT_SCHEMA_ID = 'atm.diagnosticLoopReceipt.v1' as const;

export type DiagnosticLoopSeverity = 'blocking' | 'non-blocking';

export interface DiagnosticLoopHypothesis {
  readonly id: string;
  readonly summary: string;
  readonly predictedObservation: string;
  readonly experimentCommand: string;
  readonly experimentResult: 'matched' | 'falsified' | 'inconclusive';
}

export interface DiagnosticLoopCommandObservation {
  readonly command: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
}

export interface DiagnosticLoopReceiptInput {
  readonly taskId: string;
  readonly symptom: string;
  readonly severity: DiagnosticLoopSeverity;
  readonly reproducer: DiagnosticLoopCommandObservation;
  readonly symptomObserved: boolean;
  readonly reproductionRate: number;
  readonly minimizedFixture: string;
  readonly candidateDigest: string;
  readonly environmentDigest: string;
  readonly hypotheses: readonly DiagnosticLoopHypothesis[];
  readonly winningHypothesisId: string;
  readonly regressionCaseId: string;
  readonly greenEvidence: DiagnosticLoopCommandObservation;
  readonly temporaryInstrumentation: 'removed' | 'promoted' | 'none';
  readonly emergencyRationale?: {
    readonly reason: string;
    readonly expiresAt: string;
  } | null;
  readonly createdAt?: string | null;
}

export interface DiagnosticLoopReceipt {
  readonly schemaId: typeof DIAGNOSTIC_LOOP_RECEIPT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly taskId: string;
  readonly symptom: string;
  readonly severity: DiagnosticLoopSeverity;
  readonly reproducer: DiagnosticLoopCommandObservation;
  readonly symptomObserved: boolean;
  readonly reproductionRate: number;
  readonly minimizedFixture: string;
  readonly candidateDigest: string;
  readonly environmentDigest: string;
  readonly hypotheses: readonly DiagnosticLoopHypothesis[];
  readonly winningHypothesisId: string;
  readonly regressionCaseId: string;
  readonly greenEvidence: DiagnosticLoopCommandObservation;
  readonly temporaryInstrumentation: 'removed' | 'promoted' | 'none';
  readonly emergencyRationale: {
    readonly reason: string;
    readonly expiresAt: string;
  } | null;
  readonly valid: boolean;
  readonly admission: 'admit-repair' | 'fail-closed';
  readonly reasons: readonly string[];
  readonly receiptDigest: string;
  readonly createdAt: string;
}

export function evaluateDiagnosticLoopReceipt(input: DiagnosticLoopReceiptInput): DiagnosticLoopReceipt {
  const normalized = normalizeDiagnosticLoopInput(input);
  const reasons: string[] = [];

  if (!normalized.taskId) reasons.push('missing-task-id');
  if (!normalized.symptom) reasons.push('missing-symptom');
  if (!normalized.reproducer.command) reasons.push('missing-reproducer-command');
  if (!normalized.symptomObserved) reasons.push('symptom-not-observed');
  if (normalized.reproducer.exitCode === 0) reasons.push('reproducer-must-fail-or-signal-symptom');
  if (normalized.reproductionRate <= 0) reasons.push('reproduction-rate-must-be-positive');
  if (!normalized.minimizedFixture) reasons.push('missing-minimized-fixture');
  if (!isSha256(normalized.candidateDigest)) reasons.push('invalid-candidate-digest');
  if (!isSha256(normalized.environmentDigest)) reasons.push('invalid-environment-digest');
  if (normalized.hypotheses.length === 0) reasons.push('missing-hypotheses');
  if (!normalized.winningHypothesisId) reasons.push('missing-winning-hypothesis');
  if (!normalized.regressionCaseId) reasons.push('missing-regression-case-id');
  if (!normalized.greenEvidence.command) reasons.push('missing-green-command');
  if (normalized.greenEvidence.exitCode !== 0) reasons.push('green-evidence-must-pass');
  if (normalized.temporaryInstrumentation === 'promoted' && !normalized.greenEvidence.command.includes('validate')) {
    reasons.push('promoted-instrumentation-requires-validation-command');
  }

  const winning = normalized.hypotheses.find((hypothesis) => hypothesis.id === normalized.winningHypothesisId) ?? null;
  if (!winning) {
    reasons.push('winning-hypothesis-not-found');
  } else if (winning.experimentResult !== 'matched') {
    reasons.push('winning-hypothesis-must-match-experiment');
  }
  for (const hypothesis of normalized.hypotheses) {
    if (!hypothesis.id) reasons.push('hypothesis-missing-id');
    if (!hypothesis.predictedObservation) reasons.push(`hypothesis-missing-prediction:${hypothesis.id || 'unknown'}`);
    if (!hypothesis.experimentCommand) reasons.push(`hypothesis-missing-experiment:${hypothesis.id || 'unknown'}`);
  }

  if (normalized.emergencyRationale) {
    if (!normalized.emergencyRationale.reason) reasons.push('emergency-rationale-missing-reason');
    if (!normalized.emergencyRationale.expiresAt) reasons.push('emergency-rationale-missing-expiry');
  }

  const digestInput = {
    taskId: normalized.taskId,
    symptom: normalized.symptom,
    reproducer: normalized.reproducer,
    candidateDigest: normalized.candidateDigest,
    environmentDigest: normalized.environmentDigest,
    hypotheses: normalized.hypotheses,
    winningHypothesisId: normalized.winningHypothesisId,
    regressionCaseId: normalized.regressionCaseId,
    greenEvidence: normalized.greenEvidence,
    temporaryInstrumentation: normalized.temporaryInstrumentation,
    emergencyRationale: normalized.emergencyRationale
  };
  const valid = reasons.length === 0;

  return {
    schemaId: DIAGNOSTIC_LOOP_RECEIPT_SCHEMA_ID,
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial diagnostic loop receipt contract.'
    },
    ...normalized,
    valid,
    admission: valid ? 'admit-repair' : 'fail-closed',
    reasons,
    receiptDigest: sha256Json(digestInput)
  };
}

function normalizeDiagnosticLoopInput(input: DiagnosticLoopReceiptInput): Omit<DiagnosticLoopReceiptInput, 'emergencyRationale' | 'createdAt'> & {
  readonly emergencyRationale: { readonly reason: string; readonly expiresAt: string } | null;
  readonly createdAt: string;
} {
  return {
    taskId: String(input.taskId ?? '').trim(),
    symptom: String(input.symptom ?? '').trim(),
    severity: input.severity === 'non-blocking' ? 'non-blocking' : 'blocking',
    reproducer: normalizeCommandObservation(input.reproducer),
    symptomObserved: input.symptomObserved === true,
    reproductionRate: Number.isFinite(input.reproductionRate) ? Math.max(0, Math.min(1, input.reproductionRate)) : 0,
    minimizedFixture: String(input.minimizedFixture ?? '').trim(),
    candidateDigest: normalizeDigest(input.candidateDigest),
    environmentDigest: normalizeDigest(input.environmentDigest),
    hypotheses: (input.hypotheses ?? []).map(normalizeHypothesis),
    winningHypothesisId: String(input.winningHypothesisId ?? '').trim(),
    regressionCaseId: String(input.regressionCaseId ?? '').trim(),
    greenEvidence: normalizeCommandObservation(input.greenEvidence),
    temporaryInstrumentation: input.temporaryInstrumentation === 'removed' || input.temporaryInstrumentation === 'promoted'
      ? input.temporaryInstrumentation
      : 'none',
    emergencyRationale: input.emergencyRationale
      ? {
        reason: String(input.emergencyRationale.reason ?? '').trim(),
        expiresAt: String(input.emergencyRationale.expiresAt ?? '').trim()
      }
      : null,
    createdAt: input.createdAt?.trim() || new Date(0).toISOString()
  };
}

function normalizeHypothesis(hypothesis: DiagnosticLoopHypothesis): DiagnosticLoopHypothesis {
  const result = hypothesis.experimentResult === 'matched' || hypothesis.experimentResult === 'falsified'
    ? hypothesis.experimentResult
    : 'inconclusive';
  return {
    id: String(hypothesis.id ?? '').trim(),
    summary: String(hypothesis.summary ?? '').trim(),
    predictedObservation: String(hypothesis.predictedObservation ?? '').trim(),
    experimentCommand: String(hypothesis.experimentCommand ?? '').trim(),
    experimentResult: result
  };
}

function normalizeCommandObservation(observation: DiagnosticLoopCommandObservation): DiagnosticLoopCommandObservation {
  return {
    command: String(observation.command ?? '').trim(),
    exitCode: Number.isInteger(observation.exitCode) ? observation.exitCode : 1,
    stdoutSha256: normalizeDigest(observation.stdoutSha256),
    stderrSha256: normalizeDigest(observation.stderrSha256)
  };
}

function normalizeDigest(value: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(raw)) return `sha256:${raw}`;
  return raw;
}

function isSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

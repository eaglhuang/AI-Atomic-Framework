import { createHash } from 'node:crypto';

export const TDD_CYCLE_RECEIPT_SCHEMA_ID = 'atm.tddCycleReceipt.v1' as const;
export const TDD_LIFECYCLE_BINDING_SCHEMA_ID = 'atm.tddLifecycleBinding.v1' as const;
export const TDD_SUCCESS_RATE_SCHEMA_ID = 'atm.tddSuccessRate.v1' as const;

export const TDD_MODES = ['required', 'recommended', 'reasoned-not-applicable'] as const;
export type TddMode = (typeof TDD_MODES)[number];

export const TDD_PHASES = ['red', 'green'] as const;
export type TddPhase = (typeof TDD_PHASES)[number];

export const TDD_FAILURE_CLASSES = [
  'assertion-failure',
  'syntax',
  'setup',
  'environment',
  'unrelated',
  'digest-mismatch',
  'case-mismatch'
] as const;
export type TddFailureClass = (typeof TDD_FAILURE_CLASSES)[number];

export const TDD_EXEMPTION_KINDS = ['mechanical', 'docs', 'advisory', 'quarantined'] as const;
export type TddExemptionKind = (typeof TDD_EXEMPTION_KINDS)[number];

/** Binding identity that red and green must share for one case proof. */
export interface TddCaseBinding {
  readonly caseId: string;
  readonly testDigest: string;
  readonly acceptanceIds: readonly string[];
  readonly publicSeam: string;
  /** Sealed baseline SHA the red phase executes against. */
  readonly baselineSha: string;
  /** Sealed candidate SHA for green; null while proving red on baseline. */
  readonly candidateSha: string | null;
}

export interface TddPhaseObservation {
  readonly phase: TddPhase;
  readonly binding: TddCaseBinding;
  readonly exitCode: number;
  readonly commandOk: boolean;
  readonly failureClass?: TddFailureClass | null;
  readonly failureReason?: string | null;
  readonly executedCaseCount: number;
  readonly assertionCount: number;
  readonly advisory?: boolean | null;
  readonly quarantineStatus?: string | null;
  readonly expectedRedPredicate?: string | null;
}

export interface TddPhaseReceipt {
  readonly schemaId: typeof TDD_CYCLE_RECEIPT_SCHEMA_ID;
  readonly phase: TddPhase;
  readonly binding: TddCaseBinding;
  readonly valid: boolean;
  readonly countsAsRed: boolean;
  readonly countsAsGreen: boolean;
  readonly failureClass: TddFailureClass | null;
  readonly reasons: readonly string[];
  readonly bindingDigest: string;
}

export interface TddLifecycleBindingResult {
  readonly schemaId: typeof TDD_LIFECYCLE_BINDING_SCHEMA_ID;
  readonly ok: boolean;
  readonly caseId: string;
  readonly testDigest: string;
  readonly acceptanceIds: readonly string[];
  readonly publicSeam: string;
  readonly baselineSha: string;
  readonly candidateSha: string;
  readonly red: TddPhaseReceipt;
  readonly green: TddPhaseReceipt;
  readonly reasons: readonly string[];
}

export interface TddExemptionDeclaration {
  readonly caseId: string;
  readonly kind: TddExemptionKind;
  readonly reason: string;
  readonly reviewed: boolean;
  readonly reviewActorId?: string | null;
}

export interface TddCaseOutcome {
  readonly caseId: string;
  readonly lifecycleComplete: boolean;
  readonly exemption?: TddExemptionDeclaration | null;
  readonly advisory?: boolean | null;
  readonly quarantineStatus?: string | null;
}

export interface TddSuccessRateReport {
  readonly schemaId: typeof TDD_SUCCESS_RATE_SCHEMA_ID;
  readonly eligibleCount: number;
  readonly successCount: number;
  readonly excludedCount: number;
  readonly rate: number | null;
  readonly excludedCaseIds: readonly string[];
  readonly eligibleCaseIds: readonly string[];
  readonly successCaseIds: readonly string[];
}

export interface TddTaskLifecycleResult {
  readonly ok: boolean;
  readonly tddMode: TddMode;
  readonly bindings: readonly TddLifecycleBindingResult[];
  readonly successRate: TddSuccessRateReport;
  readonly reasons: readonly string[];
}

const NON_RED_FAILURE_CLASSES = new Set<TddFailureClass>([
  'syntax',
  'setup',
  'environment',
  'unrelated',
  'digest-mismatch',
  'case-mismatch'
]);

export function isTddMode(value: unknown): value is TddMode {
  return typeof value === 'string' && (TDD_MODES as readonly string[]).includes(value);
}

export function parseTddMode(raw: unknown): TddMode | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'required' || normalized === 'recommended') return normalized;
  if (
    normalized === 'reasoned-not-applicable'
    || normalized === 'reasoned-notapplicable'
    || normalized === 'not-applicable'
    || normalized === 'n/a'
  ) {
    return 'reasoned-not-applicable';
  }
  return null;
}

export function bindingDigest(binding: TddCaseBinding): string {
  return sha256Json({
    caseId: binding.caseId,
    testDigest: binding.testDigest,
    acceptanceIds: [...binding.acceptanceIds].map((entry) => entry.trim()).filter(Boolean).sort(),
    publicSeam: binding.publicSeam,
    baselineSha: binding.baselineSha
  });
}

/**
 * Classify a failed observation. Explicit failureClass wins; otherwise infer
 * from failureReason / exit semantics. Only assertion-failure may count as red.
 */
export function classifyTddFailure(input: {
  readonly exitCode: number;
  readonly commandOk: boolean;
  readonly failureClass?: TddFailureClass | null;
  readonly failureReason?: string | null;
  readonly expectedCaseId?: string | null;
  readonly observedCaseId?: string | null;
  readonly expectedTestDigest?: string | null;
  readonly observedTestDigest?: string | null;
}): TddFailureClass {
  if (input.expectedCaseId && input.observedCaseId && input.expectedCaseId !== input.observedCaseId) {
    return 'case-mismatch';
  }
  if (
    input.expectedTestDigest
    && input.observedTestDigest
    && input.expectedTestDigest !== input.observedTestDigest
  ) {
    return 'digest-mismatch';
  }
  if (input.failureClass && (TDD_FAILURE_CLASSES as readonly string[]).includes(input.failureClass)) {
    return input.failureClass;
  }
  const reason = String(input.failureReason ?? '').toLowerCase();
  if (/syntax|parseerror|unexpected token|ts\d{4}/.test(reason)) return 'syntax';
  if (/setup|fixture|beforeall|beforeeach|missing dependency|cannot find module/.test(reason)) {
    return 'setup';
  }
  if (/environment|enoent|eacces|permission|network|timed?\s*out|spawn/.test(reason)) {
    return 'environment';
  }
  if (/unrelated|wrong suite|different case|out of scope/.test(reason)) return 'unrelated';
  if (input.commandOk || input.exitCode === 0) return 'unrelated';
  return 'assertion-failure';
}

export function evaluateTddPhaseReceipt(observation: TddPhaseObservation): TddPhaseReceipt {
  const reasons: string[] = [];
  const binding = normalizeBinding(observation.binding);
  if (!binding.caseId) reasons.push('missing-case-id');
  if (!binding.testDigest) reasons.push('missing-test-digest');
  if (!binding.publicSeam) reasons.push('missing-public-seam');
  if (!binding.baselineSha) reasons.push('missing-baseline-sha');
  if (binding.acceptanceIds.length === 0) reasons.push('missing-acceptance-ids');
  if (observation.executedCaseCount <= 0) reasons.push('zero-executed-cases');
  if (observation.assertionCount <= 0) reasons.push('zero-assertions');
  if (observation.advisory === true) reasons.push('advisory-excluded');
  if (observation.quarantineStatus && observation.quarantineStatus !== 'active') {
    reasons.push(`quarantined:${observation.quarantineStatus}`);
  }

  const failureClass = observation.phase === 'red'
    ? classifyTddFailure({
      exitCode: observation.exitCode,
      commandOk: observation.commandOk,
      failureClass: observation.failureClass,
      failureReason: observation.failureReason
    })
    : (observation.failureClass ?? null);

  let countsAsRed = false;
  let countsAsGreen = false;

  if (observation.phase === 'red') {
    if (observation.commandOk || observation.exitCode === 0) {
      reasons.push('red-requires-failing-command');
    }
    if (failureClass && NON_RED_FAILURE_CLASSES.has(failureClass)) {
      reasons.push(`invalid-red-failure-class:${failureClass}`);
    }
    if (binding.candidateSha) {
      reasons.push('red-must-bind-baseline-without-candidate');
    }
    countsAsRed = reasons.length === 0 && failureClass === 'assertion-failure';
  } else {
    if (!observation.commandOk || observation.exitCode !== 0) {
      reasons.push('green-requires-passing-command');
    }
    if (!binding.candidateSha) {
      reasons.push('green-requires-candidate-sha');
    } else if (binding.candidateSha === binding.baselineSha) {
      reasons.push('green-candidate-must-differ-from-baseline');
    }
    countsAsGreen = reasons.length === 0;
  }

  return {
    schemaId: TDD_CYCLE_RECEIPT_SCHEMA_ID,
    phase: observation.phase,
    binding,
    valid: observation.phase === 'red' ? countsAsRed : countsAsGreen,
    countsAsRed,
    countsAsGreen,
    failureClass: failureClass ?? null,
    reasons,
    bindingDigest: bindingDigest(binding)
  };
}

export function bindRedGreenLifecycle(input: {
  readonly red: TddPhaseObservation;
  readonly green: TddPhaseObservation;
}): TddLifecycleBindingResult {
  const red = evaluateTddPhaseReceipt({ ...input.red, phase: 'red' });
  const green = evaluateTddPhaseReceipt({ ...input.green, phase: 'green' });
  const reasons: string[] = [];

  if (red.binding.caseId !== green.binding.caseId) reasons.push('case-id-mismatch');
  if (red.binding.testDigest !== green.binding.testDigest) reasons.push('test-digest-mismatch');
  if (red.binding.publicSeam !== green.binding.publicSeam) reasons.push('public-seam-mismatch');
  if (red.binding.baselineSha !== green.binding.baselineSha) reasons.push('baseline-lineage-mismatch');
  if (!sameStringSet(red.binding.acceptanceIds, green.binding.acceptanceIds)) {
    reasons.push('acceptance-mismatch');
  }
  if (red.bindingDigest !== green.bindingDigest) reasons.push('binding-digest-mismatch');
  if (!red.valid) reasons.push('red-receipt-invalid');
  if (!green.valid) reasons.push('green-receipt-invalid');
  if (!green.binding.candidateSha) reasons.push('missing-candidate-lineage');

  return {
    schemaId: TDD_LIFECYCLE_BINDING_SCHEMA_ID,
    ok: reasons.length === 0,
    caseId: red.binding.caseId,
    testDigest: red.binding.testDigest,
    acceptanceIds: red.binding.acceptanceIds,
    publicSeam: red.binding.publicSeam,
    baselineSha: red.binding.baselineSha,
    candidateSha: green.binding.candidateSha ?? '',
    red,
    green,
    reasons
  };
}

/**
 * One task may prove multiple integration case IDs. Exemptions that are
 * mechanical/docs/advisory/quarantined are excluded from success-rate inflation.
 */
export function evaluateTddSuccessRate(outcomes: readonly TddCaseOutcome[]): TddSuccessRateReport {
  const excludedCaseIds: string[] = [];
  const eligibleCaseIds: string[] = [];
  const successCaseIds: string[] = [];

  for (const outcome of outcomes) {
    if (isExcludedFromTddSuccessRate(outcome)) {
      excludedCaseIds.push(outcome.caseId);
      continue;
    }
    eligibleCaseIds.push(outcome.caseId);
    if (outcome.lifecycleComplete) successCaseIds.push(outcome.caseId);
  }

  const eligibleCount = eligibleCaseIds.length;
  const successCount = successCaseIds.length;
  return {
    schemaId: TDD_SUCCESS_RATE_SCHEMA_ID,
    eligibleCount,
    successCount,
    excludedCount: excludedCaseIds.length,
    rate: eligibleCount === 0 ? null : successCount / eligibleCount,
    excludedCaseIds,
    eligibleCaseIds,
    successCaseIds
  };
}

export function isExcludedFromTddSuccessRate(outcome: TddCaseOutcome): boolean {
  if (outcome.advisory === true) return true;
  if (outcome.quarantineStatus && outcome.quarantineStatus !== 'active') return true;
  const kind = outcome.exemption?.kind;
  if (!kind) return false;
  if (kind === 'mechanical' || kind === 'docs' || kind === 'advisory' || kind === 'quarantined') {
    return true;
  }
  return false;
}

export function evaluateTaskTddLifecycle(input: {
  readonly tddMode: TddMode;
  readonly notApplicableReason?: string | null;
  readonly pairs: readonly { red: TddPhaseObservation; green: TddPhaseObservation }[];
  readonly exemptions?: readonly TddExemptionDeclaration[];
}): TddTaskLifecycleResult {
  const reasons: string[] = [];
  if (input.tddMode === 'reasoned-not-applicable') {
    if (!String(input.notApplicableReason ?? '').trim()) {
      reasons.push('reasoned-not-applicable-requires-reason');
    }
    return {
      ok: reasons.length === 0,
      tddMode: input.tddMode,
      bindings: [],
      successRate: evaluateTddSuccessRate([]),
      reasons
    };
  }

  const bindings = input.pairs.map((pair) => bindRedGreenLifecycle(pair));
  const exemptionByCase = new Map((input.exemptions ?? []).map((entry) => [entry.caseId, entry]));
  const outcomes: TddCaseOutcome[] = bindings.map((binding) => ({
    caseId: binding.caseId,
    lifecycleComplete: binding.ok,
    exemption: exemptionByCase.get(binding.caseId) ?? null
  }));
  const successRate = evaluateTddSuccessRate(outcomes);

  if (input.tddMode === 'required') {
    if (bindings.length === 0) reasons.push('required-tdd-mode-needs-case-bindings');
    if (bindings.some((entry) => !entry.ok)) reasons.push('required-tdd-binding-incomplete');
  }

  return {
    ok: reasons.length === 0 && (input.tddMode === 'recommended' || bindings.every((entry) => entry.ok)),
    tddMode: input.tddMode,
    bindings,
    successRate,
    reasons
  };
}

function normalizeBinding(binding: TddCaseBinding): TddCaseBinding {
  return {
    caseId: String(binding.caseId ?? '').trim(),
    testDigest: String(binding.testDigest ?? '').trim(),
    acceptanceIds: [...new Set((binding.acceptanceIds ?? []).map((entry) => String(entry).trim()).filter(Boolean))],
    publicSeam: String(binding.publicSeam ?? '').trim(),
    baselineSha: String(binding.baselineSha ?? '').trim(),
    candidateSha: binding.candidateSha == null ? null : String(binding.candidateSha).trim() || null
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left.map((entry) => entry.trim()).filter(Boolean))].sort();
  const b = [...new Set(right.map((entry) => entry.trim()).filter(Boolean))].sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

import { sha256Digest } from '../census/index.ts';
import {
  PARALLEL_REPLAY_LIFECYCLE_STEPS,
  STEP_PURPOSE_HINTS,
  WEAK_OR_UNRELATED_COMMAND_PATTERNS,
  type ComposeDisposition,
  type LifecycleReceiptValidation,
  type LifecycleReceiptVerdict,
  type LifecycleTimeWindow,
  type ParallelReplayLifecycleStep,
  type PostComposeValidationEvidence,
  type SameFileIntentEvidence,
  type SemanticLifecycleReceipt
} from './lifecycle-receipt-types.ts';
import { finishValidation } from './lifecycle-receipt-validation.ts';

export * from './lifecycle-receipt-types.ts';
export * from './lifecycle-receipt-observability.ts';
export { finishValidation } from './lifecycle-receipt-validation.ts';

export function isParallelReplayLifecycleStep(value: unknown): value is ParallelReplayLifecycleStep {
  return typeof value === 'string' && (PARALLEL_REPLAY_LIFECYCLE_STEPS as readonly string[]).includes(value);
}

export function buildSemanticLifecycleReceipt(input: Omit<SemanticLifecycleReceipt, 'schemaId' | 'digest'> & {
  readonly digest?: string;
}): SemanticLifecycleReceipt {
  const withoutDigest = {
    schemaId: 'atm.parallelReplayLifecycleReceipt.v1' as const,
    step: input.step,
    commandPurpose: input.commandPurpose,
    taskId: input.taskId,
    actorId: input.actorId,
    ticketGeneration: input.ticketGeneration,
    sharedSurface: input.sharedSurface,
    timeWindow: input.timeWindow,
    command: input.command,
    exitCode: input.exitCode,
    canonicalEventRef: input.canonicalEventRef ?? null,
    producerLabel: input.producerLabel ?? null
  };
  return {
    ...withoutDigest,
    digest: input.digest ?? sha256Digest(withoutDigest)
  };
}

export function validateSemanticLifecycleReceipt(
  receipt: unknown,
  expected?: {
    readonly step?: ParallelReplayLifecycleStep;
    readonly taskId?: string;
    readonly actorId?: string;
    readonly ticketGeneration?: string | null;
    readonly sharedSurface?: string | null;
  }
): LifecycleReceiptValidation {
  const reasons: string[] = [];
  const invariantCodes: Array<'INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010'> = [];

  if (!receipt || typeof receipt !== 'object') {
    return finishValidation('rejected', ['receipt-missing-or-non-object'], invariantCodes);
  }
  const value = receipt as Partial<SemanticLifecycleReceipt> & Record<string, unknown>;

  if (value.schemaId !== 'atm.parallelReplayLifecycleReceipt.v1') {
    reasons.push('unsupported-or-missing-schemaId');
  }
  if (!isParallelReplayLifecycleStep(value.step)) {
    reasons.push('unknown-or-missing-lifecycle-step');
  }
  if (typeof value.commandPurpose !== 'string' || value.commandPurpose.trim().length === 0) {
    reasons.push('missing-command-purpose');
  }
  if (typeof value.taskId !== 'string' || value.taskId.trim().length === 0) {
    reasons.push('missing-taskId');
  }
  if (typeof value.actorId !== 'string' || value.actorId.trim().length === 0) {
    reasons.push('missing-actorId');
  }
  if (!('ticketGeneration' in value)) {
    reasons.push('missing-ticketGeneration-binding');
  }
  if (!('sharedSurface' in value)) {
    reasons.push('missing-sharedSurface-binding');
  }
  if (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.digest)) {
    reasons.push('missing-or-invalid-digest');
  }
  if (!isValidTimeWindow(value.timeWindow)) {
    reasons.push('missing-or-invalid-time-window');
  }
  if (typeof value.command !== 'string' || value.command.trim().length === 0) {
    reasons.push('missing-command');
  } else if (isUnrelatedOrWeakCommand(value.command)) {
    reasons.push('unrelated-or-weak-command-shape');
  }
  if (typeof value.exitCode !== 'number' || !Number.isInteger(value.exitCode)) {
    reasons.push('missing-exitCode');
  } else if (value.exitCode !== 0) {
    reasons.push('command-exit-nonzero');
  }

  if (typeof value.step === 'string' && typeof value.commandPurpose === 'string') {
    if (!commandPurposeMatchesStep(value.step as ParallelReplayLifecycleStep, value.commandPurpose)) {
      reasons.push('command-purpose-step-mismatch');
    }
  }

  if (value.producerLabel && (!value.canonicalEventRef || typeof value.canonicalEventRef !== 'string')) {
    if (typeof value.command !== 'string' || value.command.trim().length === 0) {
      reasons.push('label-only-receipt-without-canonical-authority');
    }
  }

  if (expected?.step && value.step !== expected.step) reasons.push('step-does-not-match-expected');
  if (expected?.taskId && value.taskId !== expected.taskId) reasons.push('taskId-does-not-match-expected');
  if (expected?.actorId && value.actorId !== expected.actorId) reasons.push('actorId-does-not-match-expected');
  if (expected && 'ticketGeneration' in expected && value.ticketGeneration !== expected.ticketGeneration) {
    reasons.push('ticketGeneration-does-not-match-expected');
  }
  if (expected && 'sharedSurface' in expected && value.sharedSurface !== expected.sharedSurface) {
    reasons.push('sharedSurface-does-not-match-expected');
  }

  if (reasons.some((reason) => reason.includes('label-only') || reason.includes('unrelated'))) {
    invariantCodes.push('INV-ATM-009');
  }

  const verdict: LifecycleReceiptVerdict = reasons.length === 0
    ? 'accepted'
    : reasons.every((reason) => reason === 'command-exit-nonzero' || reason.startsWith('missing-or-invalid-digest'))
      ? 'inconclusive'
      : 'rejected';
  return finishValidation(verdict, reasons, invariantCodes);
}

export function deriveAdmissionFromCanonicalTicket(input: {
  readonly canonicalTicketState: string | null | undefined;
  readonly callerRequestedParallel?: boolean;
  readonly intersectionNonEmpty?: boolean;
}): {
  readonly admission: 'parallel' | 'serialized' | 'not-required' | 'invalid' | 'missing';
  readonly reason: string;
  readonly invariantCodes: readonly ('INV-ATM-008')[];
} {
  const ticket = String(input.canonicalTicketState ?? '').trim();
  if (!ticket) {
    return {
      admission: 'missing',
      reason: 'canonical-ticket-state-missing',
      invariantCodes: input.callerRequestedParallel ? ['INV-ATM-008'] : []
    };
  }
  if (ticket === 'not-required') {
    if (input.intersectionNonEmpty) {
      return {
        admission: 'invalid',
        reason: 'deliberate-non-empty-intersection-with-not-required',
        invariantCodes: ['INV-ATM-008']
      };
    }
    return {
      admission: 'not-required',
      reason: 'canonical-ticket-not-required',
      invariantCodes: input.callerRequestedParallel ? ['INV-ATM-008'] : []
    };
  }
  if (ticket === 'contradictory' || ticket === 'blocked' || ticket === 'refused') {
    return {
      admission: 'invalid',
      reason: `canonical-ticket-${ticket}`,
      invariantCodes: ['INV-ATM-008']
    };
  }
  if (input.callerRequestedParallel && ticket !== 'parallel' && ticket !== 'composer-routed' && ticket !== 'execute-now') {
    return {
      admission: 'invalid',
      reason: 'caller-parallel-cannot-override-canonical-ticket',
      invariantCodes: ['INV-ATM-008']
    };
  }
  if (ticket === 'parallel' || ticket === 'composer-routed' || ticket === 'execute-now') {
    return { admission: 'parallel', reason: 'canonical-ticket-parallel-eligible', invariantCodes: [] };
  }
  if (ticket === 'serialized' || ticket === 'must-serialize' || ticket === 'queue') {
    return { admission: 'serialized', reason: 'canonical-ticket-serialized', invariantCodes: [] };
  }
  return {
    admission: 'invalid',
    reason: 'canonical-ticket-unrecognized',
    invariantCodes: ['INV-ATM-008']
  };
}

export function validateSameFileIntentEvidence(evidence: SameFileIntentEvidence): LifecycleReceiptValidation {
  const reasons: string[] = [];
  const invariantCodes: Array<'INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010'> = [];

  const hasAnchor = evidence.atomOrContentAnchors.length > 0 || evidence.boundedSourceRanges.length > 0;
  if (!hasAnchor) reasons.push('missing-atom-or-bounded-source-anchor');
  if (!evidence.adapterIdentity || !evidence.adapterDecision) reasons.push('missing-adapter-identity-or-decision');
  if (evidence.selectedRequestIds.length === 0 && evidence.queuedRequestIds.length === 0) {
    reasons.push('missing-selected-or-queued-request-ids');
  }
  if (evidence.composeBatchMembership.length === 0 && evidence.queuedRequestIds.length === 0) {
    reasons.push('missing-compose-batch-membership');
  }
  if (!evidence.serializabilityProofDigest) reasons.push('missing-serializability-proof');
  if (!evidence.stewardBeforeHash || !evidence.stewardAfterHash) reasons.push('missing-steward-before-after-hashes');
  if (evidence.sharedCommitMemberAttribution.length === 0) reasons.push('missing-shared-commit-member-attribution');

  if (evidence.pathOnlyFileLock) {
    reasons.push('path-only-file-lock');
    invariantCodes.push('INV-ATM-010');
  }
  if (evidence.workerDirectWrite) {
    reasons.push('worker-direct-write');
    invariantCodes.push('INV-ATM-010');
  }
  if (evidence.detachedWorktreeIsolation) {
    reasons.push('detached-worktree-isolation');
    invariantCodes.push('INV-ATM-010');
  }

  return finishValidation(reasons.length === 0 ? 'accepted' : 'rejected', reasons, [...new Set(invariantCodes)]);
}

export function validatePostComposeSemanticEvidence(evidence: PostComposeValidationEvidence): LifecycleReceiptValidation {
  const reasons: string[] = [];
  const invariantCodes: Array<'INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010'> = [];

  if (!evidence.candidateOutputDigest || !/^sha256:[a-f0-9]{64}$/.test(evidence.candidateOutputDigest)) {
    reasons.push('missing-candidate-output-digest');
  }
  if (evidence.validatorReferences.length === 0) reasons.push('missing-validator-references');
  if (!evidence.sealedSelectionSourceDigest) reasons.push('missing-sealed-selection-source');
  if (!evidence.executable) reasons.push('missing-executable');
  if (!evidence.cwd) reasons.push('missing-cwd');
  if (!evidence.runnerOrBuildDigest) reasons.push('missing-runner-or-build-digest');
  if (!Number.isFinite(evidence.startedAtMs) || !Number.isFinite(evidence.finishedAtMs) || evidence.finishedAtMs < evidence.startedAtMs) {
    reasons.push('invalid-validation-timestamps');
  }
  if (evidence.derivedResult === 'unexecuted' || evidence.derivedResult === 'unavailable' || evidence.exitStatus === null) {
    reasons.push(`validation-${evidence.derivedResult === 'unexecuted' ? 'unexecuted' : evidence.derivedResult === 'unavailable' ? 'unavailable' : 'missing-exit'}`);
  }
  if (evidence.derivedResult === 'fail') reasons.push('validation-failed');
  if (evidence.derivedResult === 'inconclusive') reasons.push('validation-inconclusive');

  if (evidence.serializabilityProofPresent && evidence.derivedResult !== 'pass' && evidence.canonicalWriteAuthorized) {
    reasons.push('serializability-cannot-authorize-canonical-write');
    invariantCodes.push('INV-ATM-009');
  }
  if (evidence.canonicalWriteAuthorized && evidence.derivedResult !== 'pass') {
    reasons.push('canonical-write-without-passing-semantic-validation');
  }

  return finishValidation(reasons.length === 0 ? 'accepted' : 'rejected', reasons, invariantCodes);
}

export function evaluateComposeQueueResidency(input: {
  readonly disposition: ComposeDisposition;
  readonly waitedMs: number;
  readonly hasCanonicalQueueTransitionEvent: boolean;
}): LifecycleReceiptValidation {
  const reasons: string[] = [];
  if (input.disposition === 'compose-selected') {
    if (input.waitedMs < 0) reasons.push('negative-waitedMs');
    return finishValidation(reasons.length === 0 ? 'accepted' : 'rejected', reasons, []);
  }
  if (input.disposition === 'queued' || input.disposition === 'revalidation-required') {
    if (!input.hasCanonicalQueueTransitionEvent) {
      reasons.push('queue-disposition-without-canonical-queue-transition');
    }
    if (input.waitedMs <= 0 && input.hasCanonicalQueueTransitionEvent) {
      reasons.push('queued-transition-requires-positive-waitedMs');
    }
    return finishValidation(reasons.length === 0 ? 'accepted' : 'rejected', reasons, []);
  }
  return finishValidation('rejected', ['unknown-compose-disposition'], []);
}

function isValidTimeWindow(value: unknown): value is LifecycleTimeWindow {
  if (!value || typeof value !== 'object') return false;
  const window = value as LifecycleTimeWindow;
  return Number.isFinite(window.startedAtMs)
    && Number.isFinite(window.finishedAtMs)
    && window.finishedAtMs >= window.startedAtMs;
}

function isUnrelatedOrWeakCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) return true;
  return WEAK_OR_UNRELATED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

function commandPurposeMatchesStep(step: ParallelReplayLifecycleStep, purpose: string): boolean {
  const normalized = purpose.toLowerCase();
  return STEP_PURPOSE_HINTS[step].some((hint) => normalized.includes(hint));
}

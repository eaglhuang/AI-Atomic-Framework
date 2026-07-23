/**
 * Exact ErrorCode constants owned by TASK-ERR-0006.
 * packages/generated/src/error-codes.ts re-exports these for downstream cards
 * (for example ATM-GOV-0254); do not invent parallel string literals.
 */
export const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED =
  'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED' as const;

export const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE =
  'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE' as const;

export type SemanticValidatorOutcome =
  | 'pass'
  | 'fail'
  | 'unavailable'
  | 'unexecuted'
  | 'malformed';

export interface SemanticValidatorReceipt {
  readonly validatorId: string;
  readonly outcome: SemanticValidatorOutcome;
  readonly commandBacked: boolean;
  readonly executable?: string | null;
  readonly argv?: readonly string[] | null;
  readonly cwd?: string | null;
  readonly exitCode?: number | null;
  readonly stdoutDigest?: string | null;
  readonly stderrDigest?: string | null;
}

export interface PostComposeSemanticCandidate {
  readonly schemaId?: string;
  readonly candidateDigest: string;
  readonly baseHeadSha: string;
  readonly sealedSelectionSourceDigest: string;
  readonly requiredValidatorIds: readonly string[];
  readonly validatorReceipts: readonly SemanticValidatorReceipt[];
  readonly serializabilityProofPresent?: boolean;
  readonly canonicalWriteAttempted?: boolean;
}

export type PostComposeSemanticCode =
  | typeof ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED
  | typeof ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE;

export interface PostComposeSemanticValidationDecision {
  readonly schemaId: 'atm.postComposeSemanticValidationDecision.v1';
  readonly verdict: 'pass' | 'failed' | 'unavailable' | 'malformed';
  readonly code: PostComposeSemanticCode | null;
  readonly canonicalWriteAuthorized: boolean;
  readonly failedValidatorIds: readonly string[];
  readonly unavailableValidatorIds: readonly string[];
  readonly malformedValidatorIds: readonly string[];
  readonly recoveryCommand: string | null;
  readonly reasons: readonly string[];
}

const RECOVERY_COMMAND = 'node atm.mjs broker post-compose-semantic-validation --candidate-file <path> --json';

/**
 * Pure policy for post-compose semantic validation ErrorCode selection.
 * Serializability is necessary but never authorizes a canonical write alone.
 */
export function evaluatePostComposeSemanticValidation(
  candidate: PostComposeSemanticCandidate
): PostComposeSemanticValidationDecision {
  const reasons: string[] = [];
  if (!candidate.candidateDigest || !/^sha256:[a-f0-9]{64}$/i.test(candidate.candidateDigest)) {
    reasons.push('missing-or-invalid-candidate-digest');
  }
  if (!candidate.baseHeadSha || candidate.baseHeadSha.trim().length === 0) {
    reasons.push('missing-base-head-sha');
  }
  if (!candidate.sealedSelectionSourceDigest) {
    reasons.push('missing-sealed-selection-source');
  }
  if (!Array.isArray(candidate.requiredValidatorIds) || candidate.requiredValidatorIds.length === 0) {
    reasons.push('missing-required-validator-set');
  }

  const receiptsById = new Map<string, SemanticValidatorReceipt>();
  const malformedValidatorIds: string[] = [];
  for (const receipt of candidate.validatorReceipts ?? []) {
    if (!isWellFormedReceipt(receipt)) {
      malformedValidatorIds.push(readValidatorId(receipt) || 'unknown');
      continue;
    }
    receiptsById.set(receipt.validatorId, receipt);
  }

  const failedValidatorIds: string[] = [];
  const unavailableValidatorIds: string[] = [];

  for (const validatorId of candidate.requiredValidatorIds ?? []) {
    const receipt = receiptsById.get(validatorId);
    if (!receipt) {
      unavailableValidatorIds.push(validatorId);
      reasons.push(`missing-receipt:${validatorId}`);
      continue;
    }
    if (!receipt.commandBacked || receipt.outcome === 'unavailable' || receipt.outcome === 'unexecuted') {
      unavailableValidatorIds.push(validatorId);
      reasons.push(`unavailable:${validatorId}`);
      continue;
    }
    if (receipt.outcome === 'malformed') {
      malformedValidatorIds.push(validatorId);
      reasons.push(`malformed:${validatorId}`);
      continue;
    }
    if (receipt.outcome === 'fail' || receipt.exitCode !== 0) {
      failedValidatorIds.push(validatorId);
      reasons.push(`failed:${validatorId}`);
      continue;
    }
  }

  if (malformedValidatorIds.length > 0) {
    return finish('malformed', ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE, {
      failedValidatorIds,
      unavailableValidatorIds,
      malformedValidatorIds: [...new Set(malformedValidatorIds)],
      reasons: [...reasons, 'malformed-validator-receipt'],
      canonicalWriteAttempted: candidate.canonicalWriteAttempted === true
    });
  }

  if (unavailableValidatorIds.length > 0 || reasons.includes('missing-required-validator-set')) {
    return finish('unavailable', ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE, {
      failedValidatorIds,
      unavailableValidatorIds: [...new Set(unavailableValidatorIds)],
      malformedValidatorIds,
      reasons,
      canonicalWriteAttempted: candidate.canonicalWriteAttempted === true
    });
  }

  if (failedValidatorIds.length > 0) {
    return finish('failed', ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED, {
      failedValidatorIds: [...new Set(failedValidatorIds)],
      unavailableValidatorIds,
      malformedValidatorIds,
      reasons,
      canonicalWriteAttempted: candidate.canonicalWriteAttempted === true
    });
  }

  if (reasons.length > 0) {
    return finish('unavailable', ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE, {
      failedValidatorIds,
      unavailableValidatorIds,
      malformedValidatorIds,
      reasons,
      canonicalWriteAttempted: candidate.canonicalWriteAttempted === true
    });
  }

  // Serializability alone never substitutes for semantic validation; by this
  // point every required validator has a command-backed pass.
  return {
    schemaId: 'atm.postComposeSemanticValidationDecision.v1',
    verdict: 'pass',
    code: null,
    canonicalWriteAuthorized: true,
    failedValidatorIds: [],
    unavailableValidatorIds: [],
    malformedValidatorIds: [],
    recoveryCommand: null,
    reasons: candidate.serializabilityProofPresent ? ['semantic-pass-with-serializability'] : ['semantic-pass']
  };
}

function readValidatorId(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== 'object') return null;
  const validatorId = (receipt as { validatorId?: unknown }).validatorId;
  return typeof validatorId === 'string' && validatorId.trim().length > 0 ? validatorId : null;
}

function isWellFormedReceipt(receipt: unknown): receipt is SemanticValidatorReceipt {
  if (!receipt || typeof receipt !== 'object') return false;
  const candidate = receipt as Partial<SemanticValidatorReceipt>;
  if (typeof candidate.validatorId !== 'string' || candidate.validatorId.trim().length === 0) return false;
  if (typeof candidate.commandBacked !== 'boolean') return false;
  if (typeof candidate.outcome !== 'string') return false;
  if (candidate.commandBacked) {
    if (!candidate.executable || !Array.isArray(candidate.argv) || !candidate.cwd) return false;
    if (candidate.exitCode !== null && candidate.exitCode !== undefined && !Number.isInteger(candidate.exitCode)) {
      return false;
    }
  }
  return true;
}

function finish(
  verdict: 'failed' | 'unavailable' | 'malformed',
  code: PostComposeSemanticCode,
  input: {
    readonly failedValidatorIds: readonly string[];
    readonly unavailableValidatorIds: readonly string[];
    readonly malformedValidatorIds: readonly string[];
    readonly reasons: readonly string[];
    readonly canonicalWriteAttempted: boolean;
  }
): PostComposeSemanticValidationDecision {
  const reasons = [...input.reasons];
  if (input.canonicalWriteAttempted) {
    reasons.push('canonical-write-prohibited-after-semantic-gate');
  }
  return {
    schemaId: 'atm.postComposeSemanticValidationDecision.v1',
    verdict,
    code,
    canonicalWriteAuthorized: false,
    failedValidatorIds: input.failedValidatorIds,
    unavailableValidatorIds: input.unavailableValidatorIds,
    malformedValidatorIds: input.malformedValidatorIds,
    recoveryCommand: RECOVERY_COMMAND,
    reasons
  };
}

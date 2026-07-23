import type { PatchCandidateMaterialization, SealedValidatorSelection } from './patch-candidate-materializer.ts';
import { sealValidatorSelection } from './patch-candidate-materializer.ts';

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
  readonly selectionInputDigest?: string;
  readonly requiredValidatorIds: readonly string[];
  readonly validatorReceipts: readonly SemanticValidatorReceipt[];
  readonly serializabilityProofPresent?: boolean;
  readonly canonicalWriteAttempted?: boolean;
  /** When set, must match the sealed union; drift invalidates the cell. */
  readonly observedSelection?: SealedValidatorSelection;
}

export interface StewardSemanticAuthorizationReceipt {
  readonly schemaId: 'atm.stewardSemanticValidationReceipt.v1';
  readonly candidateDigest: string;
  readonly outputDigest: string;
  readonly decisionVerdict: PostComposeSemanticValidationDecision['verdict'];
  readonly ok: boolean;
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
 * Build the policy candidate envelope from an immutable materialization.
 * Serializability on the materialization is recorded but never authorizes write.
 */
export function buildPostComposeSemanticCandidateFromMaterialization(
  materialization: PatchCandidateMaterialization,
  validatorReceipts: readonly SemanticValidatorReceipt[] = [],
  options?: { readonly canonicalWriteAttempted?: boolean }
): PostComposeSemanticCandidate {
  return {
    schemaId: 'atm.postComposeSemanticCandidate.v1',
    candidateDigest: materialization.candidateDigest,
    baseHeadSha: materialization.baseHeadSha,
    sealedSelectionSourceDigest: materialization.sealedSelection.sealedSelectionSourceDigest,
    selectionInputDigest: materialization.sealedSelection.selectionInputDigest,
    requiredValidatorIds: materialization.sealedSelection.requiredValidatorIds,
    validatorReceipts,
    serializabilityProofPresent: materialization.serializabilityProofPresent,
    canonicalWriteAttempted: options?.canonicalWriteAttempted === true,
    observedSelection: materialization.sealedSelection
  };
}

/**
 * Bind a steward-facing authorization receipt to an exact candidate digest.
 * Serializability alone never yields ok:true.
 */
export function toStewardSemanticAuthorizationReceipt(input: {
  readonly candidateDigest: string;
  readonly decision: PostComposeSemanticValidationDecision;
}): StewardSemanticAuthorizationReceipt {
  const ok = input.decision.verdict === 'pass' && input.decision.canonicalWriteAuthorized === true;
  return {
    schemaId: 'atm.stewardSemanticValidationReceipt.v1',
    candidateDigest: input.candidateDigest,
    outputDigest: input.candidateDigest,
    decisionVerdict: input.decision.verdict,
    ok
  };
}

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
  if (!Array.isArray(candidate.requiredValidatorIds)) {
    reasons.push('missing-required-validator-set');
  }

  if (candidate.observedSelection) {
    const resealed = sealValidatorSelection({
      cardValidators: candidate.observedSelection.cardValidators,
      adapterStaticChecks: candidate.observedSelection.adapterStaticChecks,
      catalogTargetedTests: candidate.observedSelection.catalogTargetedTests
    });
    if (
      resealed.sealedSelectionSourceDigest !== candidate.sealedSelectionSourceDigest ||
      resealed.selectionInputDigest !== (candidate.selectionInputDigest ?? resealed.selectionInputDigest) ||
      JSON.stringify(resealed.requiredValidatorIds) !== JSON.stringify(candidate.requiredValidatorIds)
    ) {
      reasons.push('post-reveal-validator-union-drift');
    }
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

  // Empty sealed validator union is intentional and auditable. Serializability
  // alone still never authorizes a write — authorization requires this gate pass.
  return {
    schemaId: 'atm.postComposeSemanticValidationDecision.v1',
    verdict: 'pass',
    code: null,
    canonicalWriteAuthorized: true,
    failedValidatorIds: [],
    unavailableValidatorIds: [],
    malformedValidatorIds: [],
    recoveryCommand: null,
    reasons: candidate.serializabilityProofPresent
      ? ['semantic-pass-with-serializability', 'serializability-insufficient-alone']
      : ['semantic-pass']
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

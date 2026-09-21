import { sealValidatorSelection } from './patch-candidate-materializer.js';
/**
 * Exact ErrorCode constants owned by TASK-ERR-0006.
 * packages/generated/src/error-codes.ts re-exports these for downstream cards
 * (for example ATM-GOV-0254); do not invent parallel string literals.
 */
export const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED = 'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED';
export const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE = 'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE';
const RECOVERY_COMMAND = 'node atm.mjs broker post-compose-semantic-validation --candidate-file <path> --json';
/**
 * Build the policy candidate envelope from an immutable materialization.
 * Serializability on the materialization is recorded but never authorizes write.
 */
export function buildPostComposeSemanticCandidateFromMaterialization(materialization, validatorReceipts = [], options) {
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
export function toStewardSemanticAuthorizationReceipt(input) {
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
export function evaluatePostComposeSemanticValidation(candidate) {
    const reasons = [];
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
        if (resealed.sealedSelectionSourceDigest !== candidate.sealedSelectionSourceDigest ||
            resealed.selectionInputDigest !== (candidate.selectionInputDigest ?? resealed.selectionInputDigest) ||
            JSON.stringify(resealed.requiredValidatorIds) !== JSON.stringify(candidate.requiredValidatorIds)) {
            reasons.push('post-reveal-validator-union-drift');
        }
    }
    const receiptsById = new Map();
    const malformedValidatorIds = [];
    for (const receipt of candidate.validatorReceipts ?? []) {
        if (!isWellFormedReceipt(receipt)) {
            malformedValidatorIds.push(readValidatorId(receipt) || 'unknown');
            continue;
        }
        receiptsById.set(receipt.validatorId, receipt);
    }
    const failedValidatorIds = [];
    const unavailableValidatorIds = [];
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
function readValidatorId(receipt) {
    if (!receipt || typeof receipt !== 'object')
        return null;
    const validatorId = receipt.validatorId;
    return typeof validatorId === 'string' && validatorId.trim().length > 0 ? validatorId : null;
}
function isWellFormedReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object')
        return false;
    const candidate = receipt;
    if (typeof candidate.validatorId !== 'string' || candidate.validatorId.trim().length === 0)
        return false;
    if (typeof candidate.commandBacked !== 'boolean')
        return false;
    if (typeof candidate.outcome !== 'string')
        return false;
    if (candidate.commandBacked) {
        if (!candidate.executable || !Array.isArray(candidate.argv) || !candidate.cwd)
            return false;
        if (candidate.exitCode !== null && candidate.exitCode !== undefined && !Number.isInteger(candidate.exitCode)) {
            return false;
        }
    }
    return true;
}
function finish(verdict, code, input) {
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

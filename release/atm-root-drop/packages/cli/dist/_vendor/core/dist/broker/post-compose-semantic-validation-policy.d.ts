import { type PatchCandidateMaterialization, type SealedValidatorSelection } from './patch-candidate-materializer.js';
/**
 * Exact ErrorCode constants owned by TASK-ERR-0006.
 * packages/generated/src/error-codes.ts re-exports these for downstream cards
 * (for example ATM-GOV-0254); do not invent parallel string literals.
 */
export declare const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED: "ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED";
export declare const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE: "ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE";
export type SemanticValidatorOutcome = 'pass' | 'fail' | 'unavailable' | 'unexecuted' | 'malformed';
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
export type PostComposeSemanticCode = typeof ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED | typeof ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE;
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
/**
 * Build the policy candidate envelope from an immutable materialization.
 * Serializability on the materialization is recorded but never authorizes write.
 */
export declare function buildPostComposeSemanticCandidateFromMaterialization(materialization: PatchCandidateMaterialization, validatorReceipts?: readonly SemanticValidatorReceipt[], options?: {
    readonly canonicalWriteAttempted?: boolean;
}): PostComposeSemanticCandidate;
/**
 * Bind a steward-facing authorization receipt to an exact candidate digest.
 * Serializability alone never yields ok:true.
 */
export declare function toStewardSemanticAuthorizationReceipt(input: {
    readonly candidateDigest: string;
    readonly decision: PostComposeSemanticValidationDecision;
}): StewardSemanticAuthorizationReceipt;
/**
 * Pure policy for post-compose semantic validation ErrorCode selection.
 * Serializability is necessary but never authorizes a canonical write alone.
 */
export declare function evaluatePostComposeSemanticValidation(candidate: PostComposeSemanticCandidate): PostComposeSemanticValidationDecision;

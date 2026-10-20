import type { StewardSemanticAuthorizationReceipt } from './post-compose-semantic-validation-policy.js';
/**
 * Exact ErrorCode constants owned by TASK-ERR-0004. Downstream adapters must
 * re-export these instead of minting parallel string literals.
 */
export declare const ATM_BROKER_STEWARD_RECEIPT_REQUIRED: "ATM_BROKER_STEWARD_RECEIPT_REQUIRED";
export declare const ATM_BROKER_STEWARD_RECEIPT_INVALID: "ATM_BROKER_STEWARD_RECEIPT_INVALID";
export type SharedWriteAdmissionCode = typeof ATM_BROKER_STEWARD_RECEIPT_REQUIRED | typeof ATM_BROKER_STEWARD_RECEIPT_INVALID;
export declare const SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID: "atm.sharedWriteProvenanceReceipt.v1";
/** Only a neutral write lane may be the canonical writer of a shared file. */
export declare const NEUTRAL_STEWARD_ROLES: readonly ["neutral-steward", "deterministic-composer"];
export type NeutralStewardRole = (typeof NEUTRAL_STEWARD_ROLES)[number];
/**
 * A canonical shared write is defined purely by write-claim cardinality: a file
 * carrying two or more distinct active write claims is shared, regardless of
 * which task, actor, or path is involved (INV-ATM-009).
 */
export declare const SHARED_WRITE_CLAIM_CARDINALITY_THRESHOLD = 2;
export interface SharedWriteProvenanceReceipt {
    readonly schemaId: typeof SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID;
    readonly receiptId: string;
    readonly canonicalRoot: string;
    readonly baseSha: string;
    readonly headSha: string;
    readonly compositionPlanDigest: string;
    readonly candidateOutputDigest: string;
    readonly serializabilityProofDigest: string | null;
    readonly stewardId: string;
    readonly stewardRole: NeutralStewardRole;
    readonly memberTaskIds: readonly string[];
    /** normalized repo-relative path -> exact blob digest of the steward output. */
    readonly fileDigests: Readonly<Record<string, string>>;
    readonly canonicalWriteCount: number;
    readonly semanticAuthorization: StewardSemanticAuthorizationReceipt;
    readonly semanticBaseHeadSha: string;
    readonly semanticSealedSelectionSourceDigest: string;
    readonly semanticRunnerBuildDigest: string;
    readonly issuedAt: string;
    readonly consumedAt?: string | null;
}
export interface SharedWriteObservedFile {
    readonly path: string;
    readonly writeClaimTaskIds: readonly string[];
    /** Exact digest of the bytes about to be committed; null when unreadable. */
    readonly stagedBlobDigest: string | null;
}
export interface SharedWriteAdmissionObservation {
    readonly canonicalRoot: string;
    readonly baseSha: string;
    readonly headSha: string;
    readonly committingTaskId?: string | null;
    readonly files: readonly SharedWriteObservedFile[];
    /** Raw, still-untrusted receipt evidence gathered by the local adapter. */
    readonly receipts: readonly unknown[];
    readonly expectedCompositionPlanDigest?: string | null;
    readonly expectedSealedSelectionSourceDigest?: string | null;
    readonly expectedRunnerBuildDigest?: string | null;
}
export interface SharedWriteAdmissionFinding {
    readonly code: SharedWriteAdmissionCode;
    readonly file: string;
    readonly writeClaimTaskIds: readonly string[];
    readonly reasons: readonly string[];
    readonly detail: string;
    readonly requiredCommand: string;
}
export interface SharedWriteAdmissionDecision {
    readonly schemaId: 'atm.sharedWriteAdmissionDecision.v1';
    readonly ok: boolean;
    readonly verdict: 'admit' | 'blocked';
    readonly sharedFiles: readonly string[];
    readonly admittedFiles: readonly string[];
    readonly findings: readonly SharedWriteAdmissionFinding[];
    /** Attribution is derived from validated receipts only, never from callers. */
    readonly attributedTaskIds: readonly string[];
    readonly consumedReceiptIds: readonly string[];
}
/** A file is shared when at least two distinct write claims cover it. */
export declare function isSharedCanonicalWrite(file: SharedWriteObservedFile): boolean;
/**
 * Single pure admission verifier for every shared-write entry point. Adapters
 * only gather local evidence; all policy lives here so the pre-commit hook, the
 * ATM git commit route, and broker shared delivery cannot drift apart.
 */
export declare function evaluateSharedWriteAdmission(observation: SharedWriteAdmissionObservation): SharedWriteAdmissionDecision;

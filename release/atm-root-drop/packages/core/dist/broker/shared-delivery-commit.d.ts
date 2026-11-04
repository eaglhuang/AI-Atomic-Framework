import type { WaveBrokerBatchDecision, WaveBrokerSchedulerDocument } from './wave-broker-scheduler.js';
import { type SharedWriteAdmissionDecision, type SharedWriteObservedFile } from './shared-write-provenance-policy.js';
/**
 * Evidence-local input for shared-write admission. The broker adapter only
 * gathers it; the admission rules themselves live in the shared pure verifier.
 */
export interface SharedDeliveryProvenanceInput {
    readonly canonicalRoot: string;
    readonly baseSha: string;
    readonly headSha: string;
    readonly observedFiles: readonly SharedWriteObservedFile[];
    readonly receipts: readonly unknown[];
    readonly expectedCompositionPlanDigest?: string | null;
    readonly expectedSealedSelectionSourceDigest?: string | null;
    readonly expectedRunnerBuildDigest?: string | null;
}
export interface SharedDeliveryCommitInput {
    readonly decision: WaveBrokerBatchDecision;
    readonly scheduler: WaveBrokerSchedulerDocument;
    readonly actorId: string;
    readonly manifestDigest: string;
    readonly sealedBaseSha: string;
    readonly currentHeadSha: string;
    readonly expectedHeadSha?: string | null;
    readonly claimedTaskIds: readonly string[];
    readonly validatorTaskIds: readonly string[];
    readonly stagedFiles: readonly string[];
    readonly fileSlices?: Readonly<Record<string, readonly string[]>>;
    readonly commitSha?: string | null;
    /**
     * Paths actually recorded by the commit, read back from the committed tree.
     * TASK-GIT-0029: the payload assertion is only evidence if it compares the
     * expected slices against what landed; deriving both sides from the same
     * expected slices proves nothing.
     */
    readonly committedFiles?: readonly string[] | null;
    readonly temporaryIndexPath?: string | null;
    readonly provenance?: SharedDeliveryProvenanceInput | null;
    /** VCS-neutral commit candidate this delivery persists (ATM-GOV-0261). */
    readonly commitCandidateId?: string | null;
    readonly now?: string;
}
export interface SharedWriteReceipt {
    readonly schemaId: 'atm.sharedWriteReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly surfaceKind: 'commit';
    readonly surfaceFamily: string;
    readonly taskIds: readonly string[];
    readonly ticketIds: readonly string[];
    readonly manifestDigest: string;
    readonly sealedBaseSha: string;
    readonly currentHeadSha: string;
    readonly commitSha: string | null;
    readonly fileSlices: Readonly<Record<string, readonly string[]>>;
    readonly payloadDigest: string;
    readonly executorActor: string;
    readonly temporaryIndexIsolated: boolean;
    /** VCS-neutral commit candidate id this receipt persists, when linked. */
    readonly commitCandidateId: string | null;
    readonly payloadAssertion: {
        readonly status: 'pending' | 'passed' | 'failed';
        readonly expectedFileCount: number;
        readonly committedFileCount: number | null;
        /** Paths in the committed tree that no admitted slice declared. */
        readonly unexpectedFiles: readonly string[];
        /** Admitted paths the committed tree does not contain. */
        readonly missingFiles: readonly string[];
    };
    readonly telemetry: SharedDeliveryTreatmentTelemetry;
    readonly createdAt: string;
}
export interface SharedDeliveryTreatmentTelemetry {
    readonly schemaId: 'atm.sharedDeliveryTreatmentTelemetry.v1';
    readonly specVersion: '0.1.0';
    readonly decisionKind: 'batch' | 'serialize' | 'defer';
    readonly parallelAdmissionAttempted: boolean;
    readonly conflictDetected: boolean;
    readonly composeCandidate: boolean;
    readonly composeDecision: 'compose' | 'separate' | 'unsafe' | 'inconclusive';
    readonly finalDisposition: 'commit-ready' | 'committed' | 'serial-fallback' | 'blocked';
    readonly sideEffectAllowed: boolean;
    readonly safetyFallback: string | null;
    readonly correctnessVerdict: 'pending' | 'correct' | 'false-positive' | 'false-negative' | 'escaped-conflict' | 'manual-overridden';
}
export interface SharedDeliveryCommitPlan {
    readonly schemaId: 'atm.sharedDeliveryCommitPlan.v1';
    readonly ok: boolean;
    readonly verdict: 'receipt-ready' | 'serial-fallback' | 'blocked';
    readonly reason: string;
    readonly blockers: readonly string[];
    readonly receipt: SharedWriteReceipt | null;
    readonly sharedWriteAdmission: SharedWriteAdmissionDecision | null;
}
export declare function planSharedDeliveryCommit(input: SharedDeliveryCommitInput): SharedDeliveryCommitPlan;

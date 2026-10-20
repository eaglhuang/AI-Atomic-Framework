export declare const SHARED_COMPOSE_CONTRACT: Readonly<{
    schemaId: "atm.sharedComposeInbox.v1";
    policyVersion: "atm.sharedComposeInbox.v1";
    /** 0 keeps one proposal per batch. A window opens only when this is set. */
    defaultComposeWindowMs: 0;
    defaultDeadlineMs: 30000;
    /** Retries after the first submit. Attempt 0 plus these retries is 9 attempts. */
    maxRetriesAfterFirstSubmit: 8;
    maxAttempts: 9;
    defaultMaxBatchSize: 32;
    /**
     * Exhaustive git merge-file order proof is n*2^(n-1) process spawns.
     * Subsets larger than this are not treated as proven, so the coordinator
     * will not accept them.
     */
    legalProofMaxMembers: 8;
    defaultComposingStaleMs: 2000;
    lockWaitMs: 5000;
}>;
export type ProposalStage = 'admission' | 'batch' | 'compose' | 'commit';
export type ProposalTerminal = 'committed' | 'rejected-conflict' | 'rejected-admission' | 'timeout' | 'error' | 'retry-exhausted' | 'durable-unacked' | 'late-commit-after-timeout' | 'reconciliation-incomplete' | 'inconsistent';
export type StopReason = 'acked-in-window' | 'ack-late' | 'ack-missing' | 'rename-after-stop' | 'item-stop' | 'own-deadline' | 'entry-points-still-live' | 'retry-limit' | 'not-admitted' | 'conflict' | 'excluded-by-arrival-maximal-subset' | 'legal-proof-limit' | 'hash-mismatch' | 'error';
export declare function compareProposalId(left: string, right: string): number;
export declare function setKey(proposalIds: readonly string[]): string[];
export declare function appendProposalStage(stages: readonly ProposalStage[], stage: ProposalStage): ProposalStage[];
export interface SharedComposeAdmissionInput {
    readonly admitted: boolean;
    readonly reasonCode?: string | null;
    readonly waitMs?: number;
}
export interface SubmitSharedComposeInput {
    readonly inboxDir: string;
    readonly targetPath: string;
    readonly targetFile: string;
    readonly proposalId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly baseHash: string;
    readonly baseBytes: string;
    readonly patch: string;
    readonly baseCommit?: string | null;
    readonly scope?: string | null;
    readonly ticket?: string | null;
    readonly validators?: readonly string[];
    readonly composeWindowMs?: number;
    readonly maxBatchSize?: number;
    readonly deadlineMs?: number;
    readonly itemStopAt?: number | null;
    readonly admission?: SharedComposeAdmissionInput;
    readonly composingStaleMs?: number;
    readonly now?: () => number;
    readonly onBeforeHashCheck?: () => void;
    readonly onBeforeCommit?: () => void;
    readonly onAfterRename?: () => void;
    readonly onBeforeAck?: () => void;
    /** Rename, but do not write the receipt. The returned terminal is the pre-ack observation. */
    readonly suppressAck?: boolean;
}
export interface RecoverSharedComposeInput {
    readonly inboxDir: string;
    readonly force?: boolean;
    readonly composingStaleMs?: number;
    readonly now?: () => number;
}
export interface RecoverSharedComposeResult {
    readonly recoveredBatchIds: readonly string[];
    readonly removedTempFiles: readonly string[];
}

import type { WaveBrokerBatchDecision, WaveBrokerSchedulerDocument } from './wave-broker-scheduler.ts';
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
    readonly temporaryIndexPath?: string | null;
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
    readonly createdAt: string;
}
export interface SharedDeliveryCommitPlan {
    readonly schemaId: 'atm.sharedDeliveryCommitPlan.v1';
    readonly ok: boolean;
    readonly verdict: 'receipt-ready' | 'serial-fallback' | 'blocked';
    readonly reason: string;
    readonly blockers: readonly string[];
    readonly receipt: SharedWriteReceipt | null;
}
export declare function planSharedDeliveryCommit(input: SharedDeliveryCommitInput): SharedDeliveryCommitPlan;

import type { TeamWaveEnvelope } from './team-wave-envelope.ts';
export type WaveManifestState = 'planned' | 'admitted' | 'executing' | 'ready-for-write' | 'writing' | 'ready-to-close' | 'closed' | 'needs-review' | 'failed-retryable' | 'failed-terminal';
export interface WaveManifestTask {
    readonly taskId: string;
    readonly waveId: string;
    readonly targetRepo: string;
    readonly surfaceFamily: string;
    readonly scopePaths: readonly string[];
    readonly validators: readonly string[];
    readonly dependencyReady: boolean;
    readonly laneSessionId?: string | null;
    readonly claimId?: string | null;
}
export interface WaveManifestTicket {
    readonly ticketId: string;
    readonly taskId: string;
    readonly surfaceFamily: string;
    readonly state: string;
}
export interface WaveManifestReceipt {
    readonly receiptId: string;
    readonly kind: 'commit' | 'build' | 'projection' | 'checkpoint' | 'worker';
    readonly taskIds: readonly string[];
    readonly digest?: string | null;
}
export interface WaveManifest {
    readonly schemaId: 'atm.waveManifest.v1';
    readonly specVersion: '0.1.0';
    readonly waveId: string;
    readonly batchRunId: string;
    readonly state: WaveManifestState;
    readonly sealedBaseSha: string | null;
    readonly coordinatorActorId: string;
    readonly executor: 'auto' | 'local-lanes' | 'editor-subagents' | 'team-agents' | 'manual';
    readonly targetRepo: string;
    readonly tasks: readonly WaveManifestTask[];
    readonly brokerTickets: readonly WaveManifestTicket[];
    readonly sharedReceipts: readonly WaveManifestReceipt[];
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface WaveManifestValidation {
    readonly ok: boolean;
    readonly reasons: readonly string[];
}
export interface WaveEligibilityDecision {
    readonly ok: boolean;
    readonly waveId: string | null;
    readonly surfaceFamily: string | null;
    readonly taskIds: readonly string[];
    readonly reasons: readonly string[];
}
export declare function createWaveManifest(input: {
    readonly waveId: string;
    readonly batchRunId: string;
    readonly coordinatorActorId: string;
    readonly targetRepo: string;
    readonly tasks: readonly WaveManifestTask[];
    readonly executor?: WaveManifest['executor'];
    readonly sealedBaseSha?: string | null;
    readonly state?: WaveManifestState;
    readonly brokerTickets?: readonly WaveManifestTicket[];
    readonly sharedReceipts?: readonly WaveManifestReceipt[];
    readonly now?: string;
}): WaveManifest;
export declare function validateWaveManifest(manifest: WaveManifest): WaveManifestValidation;
export declare function canTransitionWaveManifest(from: WaveManifestState, to: WaveManifestState): boolean;
export declare function transitionWaveManifest(manifest: WaveManifest, to: WaveManifestState, now?: string): WaveManifest;
export declare function evaluateWaveEligibility(tasks: readonly WaveManifestTask[]): WaveEligibilityDecision;
export declare function waveManifestSummary(manifest: WaveManifest): {
    schemaId: "atm.waveManifestSummary.v1";
    waveId: string;
    batchRunId: string;
    state: WaveManifestState;
    taskIds: readonly string[];
    surfaceFamilies: readonly string[];
    brokerTicketCount: number;
    sharedReceiptCount: number;
};
export declare function fromTeamWaveEnvelope(envelope: TeamWaveEnvelope, input: {
    readonly batchRunId: string;
    readonly sealedBaseSha?: string | null;
    readonly validatorsByTask?: Readonly<Record<string, readonly string[]>>;
    readonly dependencyReadyByTask?: Readonly<Record<string, boolean>>;
    readonly surfaceFamilyByTask?: Readonly<Record<string, string>>;
    readonly now?: string;
}): WaveManifest;

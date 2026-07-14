import { type TaskQueueRecord } from './task-direction.ts';
import { type BatchRunRecord } from './work-channels.ts';
import { type BatchTeamAdmissionDecision } from './team.ts';
export type BatchTeamAttemptUsage = {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly fullyLoadedCostUsd?: number;
    readonly retry?: boolean;
    readonly discarded?: boolean;
};
export type BatchTeamIntegrationReport = {
    readonly schemaId: 'atm.batchTeamIntegrationReport.v1';
    readonly taskId: string;
    readonly batchId: string;
    readonly sealedClose: {
        readonly usesSealAndCommitTransaction: true;
        readonly checkpointRefusesPayloadMismatch: true;
        readonly payloadDigestMatchesEvidence: boolean;
    };
    readonly teamAdmission: BatchTeamAdmissionDecision;
    readonly usage: {
        readonly attemptCount: number;
        readonly retryCount: number;
        readonly discardedContributionCount: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly cacheReadTokens: number;
        readonly fullyLoadedCostUsd: number;
    };
    readonly latency: {
        readonly queueHeadLatencyMs: number;
        readonly batchMakespanMs: number;
        readonly throughputPerMinute: number;
        readonly throughputIsSingleTaskLatency: false;
    };
    readonly stopLoss: {
        readonly triggered: boolean;
        readonly laterQueueHeadRoute: 'unchanged' | 'cheaper-qualified-model-mix' | 'single-agent';
        readonly closeSemanticsChanged: false;
    };
};
export declare function runBatch(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function buildBatchTeamIntegrationReport(input: {
    readonly taskId: string;
    readonly batchId: string;
    readonly currentQueueHeadTaskId: string | null | undefined;
    readonly structuralParallelism: boolean;
    readonly evidencePayloadDigest: string | null | undefined;
    readonly sealedPayloadDigest: string | null | undefined;
    readonly attempts?: readonly BatchTeamAttemptUsage[];
    readonly queueHeadLatencyMs: number;
    readonly batchMakespanMs: number;
    readonly completedTaskCount: number;
    readonly stopLossTriggered?: boolean;
    readonly costTelemetryLoaded?: boolean;
}): BatchTeamIntegrationReport;
export declare function buildPendingCheckpointCommitWindow(cwd: string, batchRun: BatchRunRecord | null | undefined, taskQueue: TaskQueueRecord | null | undefined): {
    schemaId: string;
    batchId: string;
    taskId: string;
    currentBatchTaskId: string | null;
    changedFiles: string[];
    deliverableFiles: string[];
    commitFiles: string[];
    commitCommand: string;
    statusCommand: string;
    note: string;
} | null;

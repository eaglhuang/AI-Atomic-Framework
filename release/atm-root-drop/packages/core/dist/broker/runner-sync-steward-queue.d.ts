import { RUNNER_SYNC_STEWARD_GENERATOR } from './global-resource-projection.ts';
export type RunnerSyncStewardRequestInput = {
    readonly taskId: string;
    readonly actorId: string;
    readonly sealedSourceSha: string;
    readonly requestedSurfaces: readonly string[];
    readonly createdAt?: string;
    readonly heartbeatAt?: string;
    readonly ttlSeconds?: number;
};
export type RunnerSyncStewardRequest = {
    readonly taskId: string;
    readonly actorId: string;
    readonly sealedSourceSha: string;
    readonly requestedSurfaces: readonly string[];
    readonly createdAt: string;
    readonly heartbeatAt: string;
    readonly expiresAt: string;
    readonly ttlSeconds: number;
    readonly queuePosition: number;
    readonly suggestedNextAction: string;
};
export type RunnerSyncStewardGroup = {
    readonly stewardWorkId: string;
    readonly sealedSourceSha: string;
    readonly queuePosition: number;
    readonly status: 'queue-head' | 'waiting';
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly requestedSurfaces: readonly string[];
    readonly waitingTasks: readonly string[];
    readonly suggestedNextAction: string;
    readonly requests: readonly RunnerSyncStewardRequest[];
};
export type RunnerSyncStewardQueueDocument = {
    readonly schemaId: 'atm.runnerSyncStewardQueue.v1';
    readonly specVersion: '0.1.0';
    readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
    readonly updatedAt: string;
    readonly groups: readonly RunnerSyncStewardGroup[];
};
export type RunnerSyncStewardQueueResult = {
    readonly schemaId: 'atm.runnerSyncStewardQueueResult.v1';
    readonly ok: boolean;
    readonly status: 'queue-head' | 'coalesced-waiter' | 'waiting-different-source';
    readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
    readonly stewardWorkId: string;
    readonly sealedSourceSha: string;
    readonly queuePosition: number;
    readonly waitingTasks: readonly string[];
    readonly requestedSurfaces: readonly string[];
    readonly suggestedNextAction: string;
    readonly queue: RunnerSyncStewardQueueDocument;
};
export type RunnerSyncStewardStaleRelease = {
    readonly taskId: string;
    readonly actorId: string;
    readonly sealedSourceSha: string;
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly expiredAt: string;
    readonly safeRetryCommand: string;
};
export type RunnerSyncStewardCleanupResult = {
    readonly schemaId: 'atm.runnerSyncStewardCleanupResult.v1';
    readonly ok: boolean;
    readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
    readonly staleReleases: readonly RunnerSyncStewardStaleRelease[];
    readonly queue: RunnerSyncStewardQueueDocument;
};
export type RunnerSyncStewardReleaseInput = {
    readonly taskId: string;
    readonly stewardWorkId: string;
    readonly receiptRef?: string | null;
    readonly receiptDigest?: string | null;
    readonly releasedAt?: string;
};
export type RunnerSyncStewardReleaseRecord = {
    readonly taskId: string;
    readonly actorId: string;
    readonly sealedSourceSha: string;
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly waitingTasks: readonly string[];
    readonly requestedSurfaces: readonly string[];
    readonly receiptRef: string | null;
    readonly receiptDigest: string | null;
    readonly releasedAt: string;
};
export type RunnerSyncStewardReleaseResult = {
    readonly schemaId: 'atm.runnerSyncStewardReleaseResult.v1';
    readonly ok: boolean;
    readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
    readonly released: RunnerSyncStewardReleaseRecord;
    readonly queue: RunnerSyncStewardQueueDocument;
    readonly next: RunnerSyncStewardQueueResult | null;
    readonly suggestedNextAction: string;
};
export declare function emptyRunnerSyncStewardQueue(now?: string): RunnerSyncStewardQueueDocument;
export declare function enqueueRunnerSyncStewardRequest(queue: RunnerSyncStewardQueueDocument | null | undefined, request: RunnerSyncStewardRequestInput): RunnerSyncStewardQueueResult;
export declare function cleanupRunnerSyncStewardQueue(queue: RunnerSyncStewardQueueDocument | null | undefined, now?: string): RunnerSyncStewardCleanupResult;
export declare function releaseRunnerSyncStewardQueue(queue: RunnerSyncStewardQueueDocument | null | undefined, input: RunnerSyncStewardReleaseInput): RunnerSyncStewardReleaseResult;
export declare function explainRunnerSyncStewardPosition(queue: RunnerSyncStewardQueueDocument | null | undefined, taskId: string, now?: string): RunnerSyncStewardQueueResult | null;

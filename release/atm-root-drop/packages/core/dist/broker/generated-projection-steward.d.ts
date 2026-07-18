export type GeneratedProjectionRequestInput = {
    readonly taskId: string;
    readonly actorId: string;
    readonly projectionKey: string;
    readonly sourceItemPaths: readonly string[];
    readonly createdAt?: string;
    readonly heartbeatAt?: string;
    readonly ttlSeconds?: number;
};
export type GeneratedProjectionRequest = {
    readonly taskId: string;
    readonly actorId: string;
    readonly projectionKey: string;
    readonly sourceItemPaths: readonly string[];
    readonly createdAt: string;
    readonly heartbeatAt: string;
    readonly expiresAt: string;
    readonly ttlSeconds: number;
    readonly queuePosition: number;
    readonly suggestedRetryCommand: string;
};
export type GeneratedProjectionQueue = {
    readonly projectionKey: string;
    readonly entries: readonly GeneratedProjectionRequest[];
};
export type GeneratedProjectionStewardDocument = {
    readonly schemaId: 'atm.generatedProjectionSteward.v1';
    readonly specVersion: '0.1.0';
    readonly updatedAt: string;
    readonly queues: readonly GeneratedProjectionQueue[];
};
export type GeneratedProjectionEnqueueResult = {
    readonly schemaId: 'atm.generatedProjectionStewardResult.v1';
    readonly ok: boolean;
    readonly projectionKey: string;
    readonly ownerTaskId: string;
    readonly queuePosition: number;
    readonly sourceItemPaths: readonly string[];
    readonly suggestedNextAction: string;
    readonly queue: GeneratedProjectionStewardDocument;
};
export type GeneratedProjectionCleanupResult = {
    readonly schemaId: 'atm.generatedProjectionStewardCleanupResult.v1';
    readonly ok: boolean;
    readonly staleReleases: readonly GeneratedProjectionStaleRelease[];
    readonly queue: GeneratedProjectionStewardDocument;
};
export type GeneratedProjectionStaleRelease = {
    readonly taskId: string;
    readonly actorId: string;
    readonly projectionKey: string;
    readonly queuePosition: number;
    readonly expiredAt: string;
    readonly suggestedRetryCommand: string;
};
export type BacklogItemShardProjectionClassification = {
    readonly schemaId: 'atm.backlogItemShardProjectionClassification.v1';
    readonly itemShardPaths: readonly string[];
    readonly generatedProjectionKeys: readonly string[];
    readonly closeBundleMustIncludeMarkdownProjection: false;
    readonly reason: string;
};
export declare function emptyGeneratedProjectionSteward(now?: string): GeneratedProjectionStewardDocument;
export declare function classifyBacklogItemShardProjectionWork(paths: readonly string[]): BacklogItemShardProjectionClassification;
export declare function enqueueGeneratedProjectionRebuild(document: GeneratedProjectionStewardDocument | null | undefined, request: GeneratedProjectionRequestInput): GeneratedProjectionEnqueueResult;
export declare function cleanupGeneratedProjectionSteward(document: GeneratedProjectionStewardDocument | null | undefined, now?: string): GeneratedProjectionCleanupResult;
export declare function governanceBacklogProjectionKeyForPath(path: string): string | null;

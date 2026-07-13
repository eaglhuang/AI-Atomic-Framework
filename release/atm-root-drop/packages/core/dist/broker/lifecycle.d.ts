import type { WriteBrokerRegistryDocument, ActiveWriteIntent } from './types.ts';
export declare const DEFAULT_BROKER_LIFECYCLE_REGISTRY_RELATIVE_PATH = ".atm/runtime/write-broker.registry.json";
export interface BrokerLifecycleState {
    readonly registryPath: string;
    readonly registry: WriteBrokerRegistryDocument;
    readonly activeIntents: readonly ActiveWriteIntent[];
    readonly runtimeCleanup?: BrokerRuntimeCleanupReport;
}
export interface BrokerRuntimeCleanupReport {
    readonly removedIntentSnapshots: readonly string[];
    readonly removedSharedQueueSnapshot: boolean;
    readonly removedSharedFreezeSnapshot: boolean;
    readonly prunedSharedQueueEntries: number;
    readonly prunedSharedFreezeRecords: number;
}
export interface BrokerLifecycleClaimCheck {
    readonly ok: boolean;
    readonly blocked: boolean;
    readonly reason: string | null;
    readonly registryPath: string;
    readonly blockingIntent: ActiveWriteIntent | null;
    readonly activeIntents: readonly ActiveWriteIntent[];
}
export declare function readBrokerLifecycleState(cwd: string): BrokerLifecycleState;
export declare function inspectBrokerClaimLifecycle(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
}): BrokerLifecycleClaimCheck;
export declare function recordBrokerClaimIntent(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly lane?: ActiveWriteIntent['lane'];
    readonly targetFiles?: readonly string[];
    readonly ttlSeconds?: number;
    readonly leaseMaxSeconds?: number;
}): BrokerLifecycleState;
export declare function clearBrokerRuntimeStateForTask(input: {
    readonly cwd: string;
    readonly taskId: string;
}): BrokerLifecycleState;
export declare function cleanupBrokerRuntimeSnapshots(input: {
    readonly cwd: string;
    readonly releasedTaskIds?: readonly string[];
    readonly activeTaskIds?: readonly string[];
}): BrokerRuntimeCleanupReport;
export declare function renewBrokerClaimIntent(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly ttlSeconds?: number;
}): BrokerLifecycleState;
export declare function removeBrokerRegistryIfEmpty(cwd: string): boolean;
export declare function describeBrokerLifecyclePaths(cwd: string): {
    registryPath: string;
};

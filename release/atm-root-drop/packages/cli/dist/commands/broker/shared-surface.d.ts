import { loadRegistry } from '../../../../core/src/broker/registry.ts';
import { calculateBrokerDecision } from '../../../../core/src/broker/decision.ts';
import { type SharedSurfaceQueue } from '../../../../core/src/broker/shared-surface-queue.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../../../../core/src/broker/types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
export declare function updateSharedSurfaceQueues(input: {
    queuePath: string;
    intent: WriteIntent;
    registry: {
        activeIntents: readonly ActiveWriteIntent[];
    };
    shouldQueue: boolean;
}): {
    readonly queues: SharedSurfaceQueue[];
    readonly newlyQueued: readonly {
        readonly surfacePath: string;
        readonly queueHead: ActiveWriteIntent;
    }[];
};
export declare function createSharedSurfaceFreezeRecords(input: {
    readonly existing: readonly SharedSurfaceFreezeRecord[];
    readonly queueUpdate: {
        readonly newlyQueued: readonly {
            readonly surfacePath: string;
            readonly queueHead: ActiveWriteIntent;
        }[];
    };
    readonly waitingIntent: WriteIntent;
}): SharedSurfaceFreezeRecord[];
export declare function markReleasedSharedSurfaceFreezes(input: {
    readonly records: readonly SharedSurfaceFreezeRecord[];
    readonly releasedTaskId: string;
    readonly queues: readonly SharedSurfaceQueue[];
}): SharedSurfaceFreezeRecord[];
export declare function shouldQueueSharedSurface(decision: ReturnType<typeof calculateBrokerDecision>): boolean;
type SharedSurfaceQueueAdmission = {
    readonly status: 'not-queued' | 'queue-head' | 'queued-private-work' | 'queued-blocked';
    readonly queuedSharedPaths: readonly string[];
    readonly allowedFiles: readonly string[];
    readonly reason: string;
};
export declare function resolveSharedSurfaceQueueAdmission(input: {
    readonly intent: WriteIntent;
    readonly queues: readonly SharedSurfaceQueue[];
}): SharedSurfaceQueueAdmission;
export declare function replaceIntentLane(registry: WriteBrokerRegistryDocument, taskId: string, lane: ActiveWriteIntent['lane']): WriteBrokerRegistryDocument;
export declare function assertBrokerRegisterCliParity(intent: WriteIntent, options: Pick<ParsedBrokerOptions, 'task' | 'actorId' | 'intentFile'>): void;
export declare function syncTeamRunRearbitrationSnapshots(cwd: string, registry: ReturnType<typeof loadRegistry>, triggerTaskId: string, triggerActorId: string): void;
export {};

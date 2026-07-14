export type SharedSurfaceQueueEntry = {
    readonly taskId: string;
    readonly actorId: string;
    readonly surfacePath: string;
    readonly leaseEpoch: number;
    readonly baseHash: string;
    readonly reason: string;
    readonly releaseCondition: string;
    readonly queuedAt: string;
};
export type SharedSurfaceQueue = {
    readonly schemaId: 'atm.brokerSharedSurfaceQueue.v1';
    readonly surfacePath: string;
    readonly entries: readonly SharedSurfaceQueueEntry[];
};
export type SharedSurfaceQueueResult = {
    readonly ok: boolean;
    readonly queue: SharedSurfaceQueue;
    readonly position: number | null;
    readonly code: 'queued' | 'already-queued' | 'invalid-entry' | 'base-hash-mismatch';
    readonly reason: string;
};
export type SharedSurfaceAcquisitionPlan = {
    readonly taskId: string;
    readonly orderedSurfacePaths: readonly string[];
    readonly readyToMutateSharedPaths: boolean;
    readonly waitingOn: readonly {
        surfacePath: string;
        queueHeadTaskId: string;
    }[];
};
export declare function enqueueSharedSurface(input: {
    readonly queue?: SharedSurfaceQueue | null;
    readonly entry: SharedSurfaceQueueEntry;
}): SharedSurfaceQueueResult;
export declare function planSharedSurfaceAcquisition(queues: readonly SharedSurfaceQueue[], taskId: string): SharedSurfaceAcquisitionPlan;
export declare function releaseSharedSurfaceHead(input: {
    readonly queue: SharedSurfaceQueue;
    readonly taskId: string;
}): SharedSurfaceQueue;
export declare function removeSharedSurfaceEntry(input: {
    readonly queue: SharedSurfaceQueue;
    readonly taskId: string;
}): SharedSurfaceQueue;

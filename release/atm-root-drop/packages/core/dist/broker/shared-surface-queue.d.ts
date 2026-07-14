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
export type SharedSurfaceQueueTransaction = {
    readonly schemaId: 'atm.brokerSharedSurfaceQueueTransaction.v1';
    readonly transactionId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly createdAt: string;
    readonly baseQueueDigest: string;
    readonly nextQueueDigest: string;
    readonly intents: readonly SharedSurfaceQueueEntry[];
    readonly barrierConflicts: readonly {
        surfacePath: string;
        queueHeadTaskId: string;
    }[];
    readonly status: 'committed' | 'idempotent-replay' | 'blocked';
    readonly recoveryHint: string | null;
};
export type SharedSurfaceQueueTransactionResult = {
    readonly ok: boolean;
    readonly queues: readonly SharedSurfaceQueue[];
    readonly transaction: SharedSurfaceQueueTransaction;
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
export declare function applySharedSurfaceQueueTransaction(input: {
    readonly queues: readonly SharedSurfaceQueue[];
    readonly entries: readonly SharedSurfaceQueueEntry[];
    readonly transactionId: string;
    readonly createdAt?: string;
}): SharedSurfaceQueueTransactionResult;
export declare function diagnoseStaleSharedSurfaceIntents(input: {
    readonly queues: readonly SharedSurfaceQueue[];
    readonly now: string;
    readonly staleAfterMs: number;
}): readonly {
    readonly taskId: string;
    readonly surfacePath: string;
    readonly queuedAt: string;
    readonly releaseable: boolean;
    readonly reason: string;
}[];
export declare function removeSharedSurfaceEntry(input: {
    readonly queue: SharedSurfaceQueue;
    readonly taskId: string;
}): SharedSurfaceQueue;

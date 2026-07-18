export declare function parseReconcileOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    deliveryCommit: string;
    historicalDeliveryRepo: string | null;
    waiverReason: string | null;
    actorId: string | null;
    waiverOutOfScopeDelivery: boolean;
    emergencyApproval: string | null;
    allowStaleRunner: boolean;
};
export declare function parseDeliverAndCloseOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    deliveryCommit: string | null;
    message: string | null;
    reason: string | null;
    dryRun: boolean;
    fromBatchCheckpoint: boolean;
    batchId: string | null;
};

import type { TaskImportStatus } from '../../tasks.ts';
export declare function parseCreateOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    actorId: string | null;
    title: string | null;
    force: boolean;
};
export declare function parseMirrorOptions(argv: string[]): {
    cwd: string;
    provider: string;
    originTaskId: string;
    taskId: string | null;
    actorId: string | null;
    originUrl: string | null;
    title: string | null;
    status: TaskImportStatus;
    syncStatus: string;
};
export declare function parseHistoricalDeliveryRefs(value: string): string[];
export declare function parseCloseOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    historicalDeliveryRefs: readonly string[];
    historicalDeliveryRepo: string | null;
    reason: string | null;
    actorId: string | null;
    status: "done" | "review" | "blocked" | "abandoned";
    fromBatchCheckpoint: boolean;
    batchId: string | null;
    historicalBatchRef: string | null;
    waiverOutOfScopeDelivery: boolean;
    emergencyApproval: string | null;
    allowStaleRunner: boolean;
};

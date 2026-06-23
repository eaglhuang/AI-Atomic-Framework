export declare function runBatch(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function buildPendingCheckpointCommitWindow(cwd: string, batchRun: any, taskQueue: any): {
    schemaId: string;
    batchId: any;
    taskId: any;
    currentBatchTaskId: any;
    changedFiles: string[];
    deliverableFiles: string[];
    commitFiles: string[];
    commitCommand: string;
    statusCommand: string;
    note: string;
} | null;

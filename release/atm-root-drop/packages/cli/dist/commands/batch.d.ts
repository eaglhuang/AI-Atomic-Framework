import { type TaskQueueRecord } from './task-direction.ts';
import { type BatchRunRecord } from './work-channels.ts';
export declare function runBatch(argv: string[]): Promise<import("./shared.ts").CommandResult>;
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

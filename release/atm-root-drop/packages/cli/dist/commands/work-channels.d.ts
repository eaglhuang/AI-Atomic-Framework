import type { TaskDirectionTask, TaskQueueRecord } from './task-direction.ts';
export interface QuickfixLock {
    readonly schemaId: 'atm.quickfixLock.v1';
    readonly specVersion: '0.1.0';
    readonly actorId: string;
    readonly prompt: string;
    readonly promptHash: string;
    readonly reason: string | null;
    readonly allowedFiles: readonly string[];
    readonly maxFiles: number;
    readonly maxChangedLines: number;
    readonly createdAt: string;
    readonly status: 'active' | 'released';
}
export interface BatchRunRecord {
    readonly schemaId: 'atm.batchRun.v1';
    readonly specVersion: '0.1.0';
    readonly batchId: string;
    readonly scopeKey: string;
    readonly queueId: string | null;
    readonly sourcePrompt: string;
    readonly sourcePromptHash: string;
    readonly targetRepo: string | null;
    readonly taskIds: readonly string[];
    readonly currentIndex: number;
    readonly currentTaskId: string | null;
    readonly commitMode: 'per-task' | 'checkpoint' | 'single';
    readonly checkpointSize: number;
    readonly status: 'active' | 'paused' | 'completed' | 'abandoned';
    readonly hold?: BatchRunHold | null;
    readonly createdByActor: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface BatchRunHold {
    readonly schemaId: 'atm.batchHold.v1';
    readonly status: 'held';
    readonly afterTaskId: string;
    readonly currentTaskId: string | null;
    readonly heldByActor: string;
    readonly heldAt: string;
    readonly resumeCommand: string;
}
export interface BatchRunSelector {
    readonly batchId?: string | null;
    readonly scopeKey?: string | null;
    readonly taskId?: string | null;
    readonly actorId?: string | null;
    readonly sourcePrompt?: string | null;
}
export declare function readActiveQuickfixLock(cwd: string): QuickfixLock | null;
export declare function writeQuickfixLock(input: {
    readonly cwd: string;
    readonly actorId: string;
    readonly prompt: string;
    readonly reason?: string | null;
    readonly allowedFiles: readonly string[];
    readonly maxFiles?: number;
    readonly maxChangedLines?: number;
}): QuickfixLock;
export declare function releaseQuickfixLock(cwd: string, actorId: string): QuickfixLock | null;
export declare function readActiveBatchRun(cwd: string, selector?: BatchRunSelector): BatchRunRecord | null;
export declare function listActiveBatchRuns(cwd: string): readonly BatchRunRecord[];
export declare function readBatchRunById(cwd: string, batchId: string): BatchRunRecord | null;
export declare function findActiveBatchRunForTask(cwd: string, taskId: string): BatchRunRecord | null;
export declare function selectActiveBatchRun(cwd: string, selector?: BatchRunSelector): BatchRunRecord | null;
export declare function activeBatchSelectionStatus(cwd: string, selector?: BatchRunSelector): {
    ok: boolean;
    reason: string | null;
    batchRun: BatchRunRecord | null;
    candidates: BatchRunRecord[];
};
export declare function writeBatchRun(input: {
    readonly cwd: string;
    readonly sourcePrompt: string;
    readonly tasks: readonly TaskDirectionTask[];
    readonly queue: TaskQueueRecord | null;
    readonly actorId: string | null;
    readonly commitMode?: 'per-task' | 'checkpoint' | 'single';
    readonly checkpointSize?: number;
}): BatchRunRecord;
export declare function updateBatchRun(cwd: string, current: BatchRunRecord, updates: Partial<BatchRunRecord>): BatchRunRecord;
export declare function releaseBatchRun(cwd: string, current: BatchRunRecord, status: BatchRunRecord['status']): BatchRunRecord;
export declare function inspectBatchRunConsistency(batchRun: BatchRunRecord | null, taskQueue: TaskQueueRecord | null): {
    ok: boolean;
    reason: null;
    queueHeadTaskId: null;
    batchHeadTaskId: null;
} | {
    ok: boolean;
    reason: string;
    queueHeadTaskId: null;
    batchHeadTaskId: string | null;
} | {
    ok: boolean;
    reason: null;
    queueHeadTaskId: string;
    batchHeadTaskId: string;
} | {
    ok: boolean;
    reason: string;
    queueHeadTaskId: string;
    batchHeadTaskId: string | null;
};
export declare function repairBatchRunFromQueue(cwd: string, batchRun: BatchRunRecord, taskQueue: TaskQueueRecord): BatchRunRecord;
export declare function findBatchFileConflicts(input: {
    readonly currentBatchId: string | null;
    readonly files: readonly string[];
    readonly otherBatches: readonly BatchRunRecord[];
    readonly allowedFilesByBatchId: ReadonlyMap<string, readonly string[]>;
}): {
    batchId: string;
    scopeKey: string;
    taskIds: readonly string[];
    overlappingFiles: string[];
}[];
export declare function extractPathLikeStringsFromPrompt(prompt: string): readonly string[];
export declare function isQuickfixPrompt(prompt: string): boolean;
export declare function isBatchPrompt(prompt: string): boolean;
/**
 * Quickfix / batch scope path matcher. NOT the source of truth for task direction
 * lock allowed files. For task direction governance (claim → guard → close) use
 * `taskDirectionLock.allowedFiles` via `getCanonicalAllowedFilesForTask` /
 * `diagnoseTaskDirectionLockAllowedFiles` in `task-direction.ts` (TASK-AAO-0012).
 */
export declare function isPathAllowedByScope(filePath: string, allowedFiles: readonly string[]): boolean;

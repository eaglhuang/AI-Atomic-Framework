import { type TaskQueueRecord } from '../../task-direction.ts';
import { type TaskIntent } from '../intent-normalizers.ts';
import { type ImportedTaskSummary } from '../route-predicates.ts';
export declare function findActiveTaskQueueForIntent(cwd: string, intent: TaskIntent | null, options?: {
    readonly sourcePromptFallback?: string | null;
    readonly taskId?: string | null;
}): TaskQueueRecord | null;
export declare function reconcilePromptScopeRuntimeForClaim(cwd: string, taskIntent: TaskIntent | null, selectedTasks: readonly ImportedTaskSummary[]): {
    queue: TaskQueueRecord;
    batchRun: import("../../work-channels.ts").BatchRunRecord | null;
    queueHeadTask: ImportedTaskSummary | null;
} | null;
export declare function findActiveBatchRunForIntent(cwd: string, intent: TaskIntent | null, options?: {
    readonly sourcePromptFallback?: string | null;
    readonly taskId?: string | null;
}): import("../../work-channels.ts").BatchRunRecord | null;

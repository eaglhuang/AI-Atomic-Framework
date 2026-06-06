import type { TaskQueueRecord } from './task-direction.ts';
import type { BatchRunRecord } from './work-channels.ts';
export interface NextBatchTaskRef {
    readonly workItemId: string;
}
export interface ActiveBatchClaimDecisionTaskMissing {
    readonly kind: 'queue-head-missing';
    readonly batchId: string;
    readonly currentTaskId: string;
    readonly attemptedTaskId: string;
    readonly requiredPrompt: string;
}
export interface ActiveBatchClaimDecisionUseQueueHead<TTask extends NextBatchTaskRef> {
    readonly kind: 'use-queue-head';
    readonly batchId: string;
    readonly currentTaskId: string;
    readonly attemptedTaskId: string;
    readonly task: TTask;
}
export type ActiveBatchClaimDecision<TTask extends NextBatchTaskRef> = ActiveBatchClaimDecisionTaskMissing | ActiveBatchClaimDecisionUseQueueHead<TTask>;
export declare function decideActiveBatchClaimTask<TTask extends NextBatchTaskRef>(input: {
    readonly activeBatch: BatchRunRecord | null;
    readonly activeQueue: TaskQueueRecord | null | undefined;
    readonly claimableTask: TTask | null;
    readonly visibleTasks: readonly TTask[];
    readonly fallbackTasks: readonly TTask[];
}): ActiveBatchClaimDecision<TTask> | null;

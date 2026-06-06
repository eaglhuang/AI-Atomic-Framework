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

export type ActiveBatchClaimDecision<TTask extends NextBatchTaskRef> =
  | ActiveBatchClaimDecisionTaskMissing
  | ActiveBatchClaimDecisionUseQueueHead<TTask>;

export function decideActiveBatchClaimTask<TTask extends NextBatchTaskRef>(input: {
  readonly activeBatch: BatchRunRecord | null;
  readonly activeQueue: TaskQueueRecord | null | undefined;
  readonly claimableTask: TTask | null;
  readonly visibleTasks: readonly TTask[];
  readonly fallbackTasks: readonly TTask[];
}): ActiveBatchClaimDecision<TTask> | null {
  const activeBatch = input.activeBatch;
  const claimableTask = input.claimableTask;
  if (!activeBatch || activeBatch.status !== 'active' || !activeBatch.currentTaskId || !claimableTask) {
    return null;
  }
  if (!activeBatch.taskIds.includes(claimableTask.workItemId)) {
    return null;
  }
  if (activeBatch.currentTaskId === claimableTask.workItemId) {
    return null;
  }

  const queueHeadTask = findTaskById(input.visibleTasks, activeBatch.currentTaskId)
    ?? findTaskById(input.fallbackTasks, activeBatch.currentTaskId)
    ?? findTaskById(input.visibleTasks, input.activeQueue?.taskIds[input.activeQueue.currentIndex] ?? null)
    ?? findTaskById(input.fallbackTasks, input.activeQueue?.taskIds[input.activeQueue.currentIndex] ?? null);
  if (!queueHeadTask) {
    return {
      kind: 'queue-head-missing',
      batchId: activeBatch.batchId,
      currentTaskId: activeBatch.currentTaskId,
      attemptedTaskId: claimableTask.workItemId,
      requiredPrompt: activeBatch.sourcePrompt
    };
  }
  return {
    kind: 'use-queue-head',
    batchId: activeBatch.batchId,
    currentTaskId: activeBatch.currentTaskId,
    attemptedTaskId: claimableTask.workItemId,
    task: queueHeadTask
  };
}

function findTaskById<TTask extends NextBatchTaskRef>(tasks: readonly TTask[], taskId: string | null | undefined): TTask | null {
  if (!taskId) return null;
  return tasks.find((task) => task.workItemId === taskId) ?? null;
}

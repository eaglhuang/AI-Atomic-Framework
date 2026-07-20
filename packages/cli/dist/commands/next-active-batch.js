export function decideActiveBatchClaimTask(input) {
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
function findTaskById(tasks, taskId) {
    if (!taskId)
        return null;
    return tasks.find((task) => task.workItemId === taskId) ?? null;
}

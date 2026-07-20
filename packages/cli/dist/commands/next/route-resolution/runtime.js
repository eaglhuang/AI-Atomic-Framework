import { abandonTaskQueue, createOrRefreshTaskQueue, findActiveTaskQueue } from '../../task-direction.js';
import { readActiveBatchRun, repairBatchRunFromQueue } from '../../work-channels.js';
import { uniqueSorted } from '../view-projections.js';
export function findActiveTaskQueueForIntent(cwd, intent, options = {}) {
    if (intent?.userPrompt) {
        const exact = findActiveTaskQueue(cwd, intent.userPrompt);
        if (exact)
            return exact;
    }
    if (options.sourcePromptFallback) {
        const fallback = findActiveTaskQueue(cwd, options.sourcePromptFallback);
        if (fallback)
            return fallback;
    }
    for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
        const scoped = findActiveTaskQueue(cwd, null, { scopeKey });
        if (scoped)
            return scoped;
    }
    if (options.taskId) {
        const byTask = findActiveTaskQueue(cwd, null, { taskId: options.taskId });
        if (byTask)
            return byTask;
    }
    return null;
}
export function reconcilePromptScopeRuntimeForClaim(cwd, taskIntent, selectedTasks) {
    const sourcePrompt = taskIntent?.userPrompt?.trim() ?? '';
    if (!sourcePrompt || selectedTasks.length === 0)
        return null;
    const existingQueue = findActiveTaskQueueForIntent(cwd, taskIntent, {
        taskId: selectedTasks[0]?.workItemId ?? null
    });
    const refreshedQueue = createOrRefreshTaskQueue({
        cwd,
        sourcePrompt,
        tasks: selectedTasks,
        taskIds: selectedTasks.map((task) => task.workItemId),
        actorId: null,
        batchId: existingQueue?.batchId ?? null,
        scopeKey: existingQueue?.scopeKey ?? null
    });
    if (existingQueue && existingQueue.queueId !== refreshedQueue.queueId && existingQueue.status === 'active') {
        abandonTaskQueue({
            cwd,
            queueId: existingQueue.queueId,
            actorId: 'atm-runtime-reconcile',
            reason: `superseded by dependency-refreshed prompt queue ${refreshedQueue.queueId}`
        });
    }
    const queueHeadTaskId = refreshedQueue.taskIds[refreshedQueue.currentIndex] ?? null;
    const queueHeadTask = queueHeadTaskId
        ? selectedTasks.find((task) => task.workItemId === queueHeadTaskId) ?? null
        : null;
    const activeBatch = refreshedQueue.batchId
        ? readActiveBatchRun(cwd, { batchId: refreshedQueue.batchId })
        : findActiveBatchRunForIntent(cwd, taskIntent, { taskId: queueHeadTaskId });
    const batchRun = activeBatch?.status === 'active'
        ? repairBatchRunFromQueue(cwd, activeBatch, refreshedQueue)
        : null;
    return {
        queue: refreshedQueue,
        batchRun,
        queueHeadTask
    };
}
export function findActiveBatchRunForIntent(cwd, intent, options = {}) {
    if (intent?.userPrompt) {
        const exact = readActiveBatchRun(cwd, { sourcePrompt: intent.userPrompt });
        if (exact)
            return exact;
    }
    if (options.sourcePromptFallback) {
        const fallback = readActiveBatchRun(cwd, { sourcePrompt: options.sourcePromptFallback });
        if (fallback)
            return fallback;
    }
    for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
        const scoped = readActiveBatchRun(cwd, { scopeKey });
        if (scoped)
            return scoped;
    }
    if (options.taskId) {
        const byTask = readActiveBatchRun(cwd, { taskId: options.taskId });
        if (byTask)
            return byTask;
    }
    return null;
}
function deriveBatchScopeKeysFromIntent(intent) {
    if (!intent)
        return [];
    const roots = [
        ...intent.taskRootHints,
        ...intent.mentionedTaskIds
            .map((taskId) => taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/)?.[1] ?? null)
            .filter((entry) => Boolean(entry))
    ];
    return uniqueSorted(roots.flatMap((root) => normalizeRootHintScopeKeys(root)));
}
function normalizeRootHintScopeKeys(root) {
    const normalized = root.trim().toUpperCase().replace(/_/g, '-');
    if (!normalized)
        return [];
    if (normalized.startsWith('TASK-'))
        return [normalized];
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(normalized)) {
        return [`TASK-${normalized}`];
    }
    return [normalized];
}

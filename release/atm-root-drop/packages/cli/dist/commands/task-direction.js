import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, relativePathFrom } from './shared.js';
import { readActiveTaskDirectionLocks } from './task-direction/active-locks.js';
import { buildTaskSelfAllowPaths } from './task-direction/scope-policy.js';
import { buildQueueId, deriveQueueScopeKey, listTaskQueues, readGovernanceDirectionLockForTask, readTaskQueue, resolveQueueSourcePlan, resolveQueueTargetRepo, sanitizeTaskDirectionAllowedFiles, sha256, uniqueInOrder, writeJson, writeTaskQueue } from './task-direction/support.js';
export { isPlanningMirrorPath, isTaskDirectionPathCandidate, sanitizeTaskDirectionAllowedFiles } from './task-direction/support.js';
export { buildAllowedFilesForTask, buildTaskSelfAllowPaths, diagnoseTaskDirectionLockAllowedFiles, getCanonicalAllowedFilesForTask, partitionTaskScope } from './task-direction/scope-policy.js';
export function createOrRefreshTaskQueue(input) {
    const sourcePrompt = input.sourcePrompt.trim();
    const requestedTaskIds = input.taskIds && input.taskIds.length > 0
        ? uniqueInOrder(input.taskIds)
        : uniqueInOrder(input.tasks.map((task) => task.workItemId));
    const taskIds = orderTaskIdsByDependencies(input.tasks, requestedTaskIds).filter((taskId) => !isLedgerTerminalQueueTask(input.cwd, taskId));
    const queueId = buildQueueId(sourcePrompt, taskIds);
    const now = new Date().toISOString();
    const existing = readTaskQueue(input.cwd, queueId);
    const activeExisting = existing?.status === 'active' ? existing : null;
    const currentIndex = activeExisting
        ? Math.min(activeExisting.currentIndex, Math.max(0, taskIds.length - 1))
        : 0;
    const record = {
        schemaId: 'atm.taskQueue.v1',
        specVersion: '0.1.0',
        queueId,
        batchId: activeExisting?.batchId ?? input.batchId ?? null,
        scopeKey: activeExisting?.scopeKey ?? input.scopeKey ?? deriveQueueScopeKey(input.tasks, taskIds),
        sourcePrompt,
        sourcePromptHash: sha256(sourcePrompt),
        sourcePlanPath: resolveQueueSourcePlan(input.tasks),
        targetRepo: resolveQueueTargetRepo(input.tasks),
        taskIds,
        tasks: taskIds.map((taskId) => input.tasks.find((task) => task.workItemId === taskId)).filter((task) => Boolean(task)),
        currentIndex,
        status: taskIds.length === 0 ? 'completed' : 'active',
        createdByActor: activeExisting?.createdByActor ?? input.actorId ?? null,
        createdAt: activeExisting?.createdAt ?? now,
        updatedAt: now
    };
    writeTaskQueue(input.cwd, record);
    return record;
}
function orderTaskIdsByDependencies(tasks, requestedTaskIds) {
    const requested = uniqueInOrder(requestedTaskIds);
    if (requested.length <= 1)
        return requested;
    const requestedSet = new Set(requested.map((taskId) => taskId.toLowerCase()));
    const taskById = new Map(tasks.map((task) => [task.workItemId.toLowerCase(), task]));
    const originalIndex = new Map(requested.map((taskId, index) => [taskId.toLowerCase(), index]));
    const indegree = new Map();
    const dependents = new Map();
    for (const taskId of requested) {
        indegree.set(taskId, 0);
        dependents.set(taskId, []);
    }
    for (const taskId of requested) {
        const task = taskById.get(taskId.toLowerCase());
        if (!task)
            continue;
        const inQueueDependencies = uniqueInOrder(task.dependencies)
            .map((dependency) => requested.find((candidate) => candidate.toLowerCase() === dependency.toLowerCase()) ?? null)
            .filter((dependency) => Boolean(dependency));
        for (const dependencyId of inQueueDependencies) {
            indegree.set(taskId, (indegree.get(taskId) ?? 0) + 1);
            dependents.get(dependencyId)?.push(taskId);
        }
    }
    const ready = requested.filter((taskId) => (indegree.get(taskId) ?? 0) === 0);
    const ordered = [];
    const seen = new Set();
    while (ready.length > 0) {
        ready.sort((left, right) => (originalIndex.get(left.toLowerCase()) ?? 0) - (originalIndex.get(right.toLowerCase()) ?? 0));
        const nextTaskId = ready.shift() ?? null;
        if (!nextTaskId || seen.has(nextTaskId))
            continue;
        seen.add(nextTaskId);
        ordered.push(nextTaskId);
        for (const dependentId of dependents.get(nextTaskId) ?? []) {
            const remaining = (indegree.get(dependentId) ?? 0) - 1;
            indegree.set(dependentId, remaining);
            if (remaining === 0) {
                ready.push(dependentId);
            }
        }
    }
    if (ordered.length === requested.length)
        return ordered;
    // Cycles or malformed dependency references should not destroy queue creation.
    return requested;
}
export function findActiveTaskQueue(cwd, sourcePrompt, selector = {}) {
    const promptHash = sourcePrompt?.trim() ? sha256(sourcePrompt.trim()) : null;
    const queues = listTaskQueues(cwd)
        .filter((queue) => queue.status === 'active')
        .map((queue) => normalizeTaskQueueForTerminalLedgerTasks(cwd, queue))
        .filter((queue) => queue.status === 'active');
    if (selector.queueId)
        return queues.find((queue) => queue.queueId === selector.queueId) ?? null;
    if (selector.batchId)
        return queues.find((queue) => queue.batchId === selector.batchId) ?? null;
    if (selector.scopeKey)
        return queues.find((queue) => queue.scopeKey === selector.scopeKey) ?? null;
    if (selector.taskId)
        return queues.find((queue) => queue.taskIds.includes(selector.taskId ?? '')) ?? null;
    if (promptHash) {
        const exact = queues.find((queue) => queue.sourcePromptHash === promptHash);
        return exact ?? null;
    }
    return queues.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}
export function abandonTaskQueue(input) {
    const record = readTaskQueue(input.cwd, input.queueId);
    if (!record) {
        throw new CliError('ATM_TASK_QUEUE_NOT_FOUND', `Task queue not found: ${input.queueId}`, {
            exitCode: 2,
            details: { queueId: input.queueId }
        });
    }
    const now = new Date().toISOString();
    const abandoned = {
        ...record,
        status: 'abandoned',
        updatedAt: now,
        abandonedByActor: input.actorId,
        abandonedAt: now,
        ...(input.reason ? { abandonReason: input.reason } : {})
    };
    writeTaskQueue(input.cwd, abandoned);
    return abandoned;
}
export function advanceTaskQueueAfterClose(cwd, taskId, selector = {}) {
    return advanceTaskQueueHead(cwd, taskId, selector);
}
export function advanceTaskQueueHead(cwd, taskId, selector = {}) {
    const queue = findActiveTaskQueue(cwd, null, { ...selector, taskId });
    if (!queue)
        return null;
    const currentTaskId = queue.taskIds[queue.currentIndex] ?? null;
    if (currentTaskId !== taskId)
        return queue;
    const nextIndex = findNextOpenQueueIndex(cwd, queue, queue.currentIndex + 1);
    const now = new Date().toISOString();
    const updated = {
        ...queue,
        currentIndex: Math.min(nextIndex, Math.max(0, queue.taskIds.length - 1)),
        status: nextIndex >= queue.taskIds.length ? 'completed' : 'active',
        updatedAt: now
    };
    writeTaskQueue(cwd, updated);
    return updated;
}
function findNextOpenQueueIndex(cwd, queue, startIndex) {
    for (let index = startIndex; index < queue.taskIds.length; index += 1) {
        const candidateTaskId = queue.taskIds[index];
        if (!candidateTaskId || isLedgerTerminalQueueTask(cwd, candidateTaskId))
            continue;
        return index;
    }
    return queue.taskIds.length;
}
function normalizeTaskQueueForTerminalLedgerTasks(cwd, queue) {
    const nextOpenIndex = findNextOpenQueueIndex(cwd, queue, queue.currentIndex);
    if (nextOpenIndex === queue.currentIndex)
        return queue;
    const now = new Date().toISOString();
    const updated = {
        ...queue,
        currentIndex: Math.min(nextOpenIndex, Math.max(0, queue.taskIds.length - 1)),
        status: nextOpenIndex >= queue.taskIds.length ? 'completed' : 'active',
        updatedAt: now
    };
    writeTaskQueue(cwd, updated);
    return updated;
}
function isLedgerTerminalQueueTask(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return false;
    try {
        const parsed = JSON.parse(readFileSync(taskPath, 'utf8'));
        const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
        return status === 'done'
            || status === 'abandoned'
            || typeof parsed.closedAt === 'string'
            || typeof parsed.closedByActor === 'string';
    }
    catch {
        return false;
    }
}
export function restoreTaskQueueHead(cwd, taskId, selector = {}) {
    const queue = findActiveTaskQueue(cwd, null, { ...selector, taskId });
    if (!queue)
        return null;
    const targetIndex = queue.taskIds.indexOf(taskId);
    if (targetIndex < 0)
        return null;
    const now = new Date().toISOString();
    const updated = {
        ...queue,
        currentIndex: targetIndex,
        status: 'active',
        updatedAt: now
    };
    writeTaskQueue(cwd, updated);
    return updated;
}
export function buildTaskQueueStatus(cwd) {
    const activeQueue = findActiveTaskQueue(cwd);
    return {
        activeQueue,
        queueHeadTaskId: activeQueue ? activeQueue.taskIds[activeQueue.currentIndex] ?? null : null
    };
}
export function writeTaskDirectionLock(input) {
    const queueIndex = input.queue ? input.queue.taskIds.indexOf(input.taskId) : -1;
    // Keep task-owned ledger, evidence, and event paths writable throughout closeout.
    const mergedAllowedFiles = sanitizeTaskDirectionAllowedFiles([
        ...input.allowedFiles,
        ...buildTaskSelfAllowPaths(input.taskId)
    ]);
    const lock = {
        schemaId: 'atm.taskDirectionLock.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        batchId: input.batchId ?? input.queue?.batchId ?? null,
        scopeKey: input.scopeKey ?? input.queue?.scopeKey ?? null,
        queueId: input.queue?.queueId ?? null,
        queueIndex: queueIndex >= 0 ? queueIndex : null,
        allowedFiles: mergedAllowedFiles,
        planningReadOnlyPaths: sanitizeTaskDirectionAllowedFiles(input.planningReadOnlyPaths ?? []),
        planningMirrorPaths: sanitizeTaskDirectionAllowedFiles(input.planningMirrorPaths ?? []),
        allowPlanningMirror: input.allowPlanningMirror === true,
        promptHash: input.prompt?.trim() ? sha256(input.prompt.trim()) : input.queue?.sourcePromptHash ?? null,
        actorId: input.actorId,
        sessionId: input.sessionId?.trim() || null,
        ...(input.laneSession ? { laneSession: input.laneSession } : {}),
        createdAt: new Date().toISOString(),
        status: 'active'
    };
    const lockPath = path.join(input.cwd, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
    if (existsSync(lockPath)) {
        try {
            const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
            const { released, releasedAt, releasedBy, ...activeLock } = existing;
            writeJson(lockPath, {
                ...activeLock,
                files: [...lock.allowedFiles],
                status: 'active',
                taskDirectionLock: lock
            });
            return lock;
        }
        catch {
            // Fall through to sidecar if the governance lock is not parseable.
        }
    }
    const sidecarPath = path.join(input.cwd, '.atm', 'runtime', 'task-direction-locks', `${input.taskId}.json`);
    mkdirSync(path.dirname(sidecarPath), { recursive: true });
    writeJson(sidecarPath, lock);
    return lock;
}
export { readActiveTaskDirectionLocks };
export function assertTaskCloseAllowedByDirection(cwd, taskId, actorId, options = {}) {
    const activeQueue = findActiveTaskQueue(cwd, null, { taskId });
    if (activeQueue) {
        const currentTaskId = activeQueue.taskIds[activeQueue.currentIndex] ?? null;
        if (currentTaskId && currentTaskId !== taskId) {
            throw new CliError('ATM_TASK_QUEUE_HEAD_REQUIRED', `Task ${taskId} cannot close before queue head ${currentTaskId}.`, {
                exitCode: 1,
                details: { taskId, queueId: activeQueue.queueId, queueHeadTaskId: currentTaskId }
            });
        }
    }
    const matchingLock = readGovernanceDirectionLockForTask(cwd, taskId);
    if (!matchingLock) {
        if (options.allowHistoricalCloseback) {
            return;
        }
        const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
        if (existsSync(sidecarPath)) {
            throw new CliError('ATM_TASK_CLOSE_INVALID_DIRECTION_LOCK_SOURCE', `Task ${taskId} cannot close as done from a standalone direction lock sidecar.`, {
                exitCode: 1,
                details: {
                    taskId,
                    sidecarPath: relativePathFrom(cwd, sidecarPath),
                    requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${taskId}" --json`
                }
            });
        }
        throw new CliError('ATM_TASK_DIRECTION_LOCK_REQUIRED', `Task ${taskId} cannot close as done without an active task direction lock.`, {
            exitCode: 1,
            details: { taskId, requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${taskId}" --json` }
        });
    }
    if (matchingLock.actorId !== actorId) {
        throw new CliError('ATM_TASK_DIRECTION_LOCK_OWNER_MISMATCH', `Task ${taskId} direction lock belongs to ${matchingLock.actorId}, not ${actorId}.`, {
            exitCode: 1,
            details: { taskId, actorId, lockActorId: matchingLock.actorId }
        });
    }
}
export function toProjectPath(cwd, absolutePath) {
    return relativePathFrom(cwd, absolutePath).replace(/\\/g, '/');
}

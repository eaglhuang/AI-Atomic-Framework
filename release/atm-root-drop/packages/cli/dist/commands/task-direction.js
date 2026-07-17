import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, relativePathFrom } from './shared.js';
import { isExternalPlanningStoredPath, normalizeStoredPlanningPathForIdentity, resolveStoredPlanningPath } from './planning-repo-root.js';
import { isPathAllowedByScope } from './work-channels.js';
import { buildQueueId, dedupeDirectionLocks, derivePlanningMirrorGuardPaths, deriveQueueScopeKey, isExternalPlanningPath, isPlanningMirrorPath, isTaskDirectionLock, listTaskQueues, normalizeRelativePath, readGovernanceDirectionLockForTask, readTaskQueue, resolveQueueSourcePlan, resolveQueueTargetRepo, sanitizeTaskDirectionAllowedFiles, sha256, uniqueInOrder, uniqueSorted, writeJson, writeTaskQueue } from './task-direction/support.js';
export { isPlanningMirrorPath, isTaskDirectionPathCandidate, sanitizeTaskDirectionAllowedFiles } from './task-direction/support.js';
export function createOrRefreshTaskQueue(input) {
    const sourcePrompt = input.sourcePrompt.trim();
    const requestedTaskIds = input.taskIds && input.taskIds.length > 0
        ? uniqueInOrder(input.taskIds)
        : uniqueInOrder(input.tasks.map((task) => task.workItemId));
    const taskIds = orderTaskIdsByDependencies(input.tasks, requestedTaskIds);
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
        status: 'active',
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
    const queues = listTaskQueues(cwd).filter((queue) => queue.status === 'active');
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
    const nextIndex = queue.currentIndex + 1;
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
    // TASK-AAO-0058：claim 時自動將任務自身治理路徑隱式 self-allow，
    // 讓 agent 在 evidence 收集、checkpoint 或 close 時不受 ScopeLock 阻擋。
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
export function getCanonicalAllowedFilesForTask(cwd, taskId) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    if (existsSync(lockPath)) {
        try {
            const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
            const released = parsed.released === true || parsed.status === 'released';
            const embedded = parsed.taskDirectionLock;
            if (!released && isTaskDirectionLock(embedded))
                return embedded.allowedFiles;
        }
        catch {
            // Fall through to sidecar.
        }
    }
    const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
    if (existsSync(sidecarPath)) {
        try {
            const parsed = JSON.parse(readFileSync(sidecarPath, 'utf8'));
            if (isTaskDirectionLock(parsed))
                return parsed.allowedFiles;
        }
        catch {
            // Ignore malformed runtime files.
        }
    }
    return null;
}
export function diagnoseTaskDirectionLockAllowedFiles(cwd, taskId) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    let canonicalAllowedFiles = null;
    let governanceLockFiles = null;
    let hasGovernanceLock = false;
    if (existsSync(lockPath)) {
        try {
            const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
            const released = parsed.released === true || parsed.status === 'released';
            if (!released) {
                hasGovernanceLock = true;
                const embedded = parsed.taskDirectionLock;
                if (isTaskDirectionLock(embedded))
                    canonicalAllowedFiles = embedded.allowedFiles;
                if (Array.isArray(parsed.files)) {
                    governanceLockFiles = uniqueSorted(parsed.files.filter((entry) => typeof entry === 'string').map(normalizeRelativePath));
                }
            }
        }
        catch {
            // Ignore malformed runtime files.
        }
    }
    if (!canonicalAllowedFiles) {
        canonicalAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId);
    }
    let claimFiles = null;
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (existsSync(taskPath)) {
        try {
            const parsed = JSON.parse(readFileSync(taskPath, 'utf8'));
            const claim = parsed.claim;
            if (claim && typeof claim === 'object' && Array.isArray(claim.files)) {
                claimFiles = uniqueSorted((claim.files)
                    .filter((entry) => typeof entry === 'string')
                    .map(normalizeRelativePath));
            }
        }
        catch {
            // Ignore malformed ledger files.
        }
    }
    const mismatches = [];
    if (canonicalAllowedFiles && governanceLockFiles) {
        const drift = computeAllowedFilesDrift(canonicalAllowedFiles, governanceLockFiles);
        if (drift.missingFromSource.length > 0 || drift.extraInSource.length > 0) {
            mismatches.push({ source: 'governance-lock-files', ...drift });
        }
    }
    if (canonicalAllowedFiles && claimFiles) {
        const drift = computeAllowedFilesDrift(canonicalAllowedFiles, claimFiles);
        if (drift.missingFromSource.length > 0 || drift.extraInSource.length > 0) {
            mismatches.push({ source: 'claim-files', ...drift });
        }
    }
    return { taskId, hasGovernanceLock, canonicalAllowedFiles, governanceLockFiles, claimFiles, mismatches };
}
function computeAllowedFilesDrift(canonical, source) {
    const canonicalSet = new Set(canonical.map((value) => normalizeRelativePath(value).toLowerCase()));
    const sourceSet = new Set(source.map((value) => normalizeRelativePath(value).toLowerCase()));
    const missingFromSource = [...canonicalSet].filter((value) => !sourceSet.has(value)).sort();
    const extraInSource = [...sourceSet].filter((value) => !canonicalSet.has(value)).sort();
    return { missingFromSource, extraInSource };
}
export function readActiveTaskDirectionLocks(cwd) {
    const locks = [];
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (existsSync(lockRoot)) {
        for (const entry of readdirSync(lockRoot).filter((item) => item.endsWith('.json'))) {
            try {
                const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), 'utf8'));
                const released = parsed.released === true || parsed.status === 'released';
                const embedded = parsed.taskDirectionLock;
                if (!released && isTaskDirectionLock(embedded))
                    locks.push(embedded);
            }
            catch {
                // Ignore malformed runtime files; task audit owns persistent task validation.
            }
        }
    }
    const sidecarRoot = path.join(cwd, '.atm', 'runtime', 'task-direction-locks');
    if (existsSync(sidecarRoot)) {
        for (const entry of readdirSync(sidecarRoot).filter((item) => item.endsWith('.json'))) {
            try {
                const parsed = JSON.parse(readFileSync(path.join(sidecarRoot, entry), 'utf8'));
                if (isTaskDirectionLock(parsed))
                    locks.push(parsed);
            }
            catch {
                // Ignore malformed runtime files.
            }
        }
    }
    return dedupeDirectionLocks(locks);
}
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
export function buildAllowedFilesForTask(task) {
    return partitionTaskScope(task).targetWork.allowedFiles;
}
/**
 * TASK-AAO-0058：回傳任務自身治理路徑（task self-allow）的 canonical 三條路徑。
 * 這些路徑會在 writeTaskDirectionLock 建立鎖時自動併入 allowedFiles，
 * 讓 agent 在 evidence 收集、checkpoint 或 close 時不會被 ScopeLock 阻擋。
 *
 * 覆蓋範圍：
 *   - .atm/history/tasks/<task-id>.json
 *   - .atm/history/evidence/<task-id>.* （含 closure-packet.json）
 *   - .atm/history/task-events/<task-id>/**
 *
 * 不含整個 .atm/history/**，以保持精確邊界。
 */
export function buildTaskSelfAllowPaths(taskId) {
    return [
        `.atm/history/tasks/${taskId}.json`,
        `.atm/history/evidence/${taskId}.*`,
        `.atm/history/task-events/${taskId}/**`
    ];
}
export function partitionTaskScope(task, options) {
    const cwd = options?.cwd ?? null;
    const normalizeScopePath = (value) => {
        if (!value)
            return value;
        return cwd ? normalizeStoredPlanningPathForIdentity(cwd, value) : normalizeRelativePath(value);
    };
    const normalizedScopePaths = task.scopePaths.map(normalizeScopePath);
    const normalizedSourcePlanPath = task.sourcePlanPath ? normalizeScopePath(task.sourcePlanPath) : null;
    const normalizedNearbyPlanPaths = task.nearbyPlanPaths.map(normalizeScopePath);
    const classifyPlanningPath = (value) => {
        if (!value)
            return false;
        if (cwd)
            return isExternalPlanningStoredPath(cwd, value);
        return isExternalPlanningPath(value);
    };
    const resolveToAbsolute = (value) => {
        if (!value)
            return '';
        return cwd ? resolveStoredPlanningPath(cwd, value).absolutePath : path.resolve(value);
    };
    const planningReadOnlyPaths = sanitizeTaskDirectionAllowedFiles([
        task.sourcePlanPath ?? '',
        ...task.nearbyPlanPaths,
        ...task.scopePaths.filter(classifyPlanningPath)
    ].map(resolveToAbsolute));
    const planningMirrorPaths = uniqueSorted(planningReadOnlyPaths.flatMap(derivePlanningMirrorGuardPaths));
    const targetCandidates = sanitizeTaskDirectionAllowedFiles(normalizedScopePaths);
    const allowedFiles = targetCandidates.filter((entry) => {
        if (planningReadOnlyPaths.includes(entry))
            return false;
        if (!task.allowPlanningMirror && isPlanningMirrorPath(entry, planningMirrorPaths))
            return false;
        if (task.outOfScope && isPathAllowedByScope(entry, task.outOfScope)) {
            return false;
        }
        return true;
    });
    if (task.outOfScope && task.outOfScope.length > 0) {
        const intersections = targetCandidates.filter((entry) => isPathAllowedByScope(entry, task.outOfScope));
        if (intersections.length > 0) {
            console.warn(`[ATM-WARNING] Task ${task.workItemId} scope paths intersect with outOfScope: ${intersections.join(', ')}. These files are subtracted from targetAllowedFiles.`);
        }
    }
    return {
        planningContext: {
            readOnlyPaths: planningReadOnlyPaths
        },
        targetWork: {
            allowedFiles,
            planningMirrorPaths,
            allowPlanningMirror: task.allowPlanningMirror
        }
    };
}
export function toProjectPath(cwd, absolutePath) {
    return relativePathFrom(cwd, absolutePath).replace(/\\/g, '/');
}

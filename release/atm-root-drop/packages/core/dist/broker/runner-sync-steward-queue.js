import { RUNNER_SYNC_STEWARD_GENERATOR } from './global-resource-projection.js';
const defaultTtlSeconds = 420;
export function emptyRunnerSyncStewardQueue(now = new Date().toISOString()) {
    return {
        schemaId: 'atm.runnerSyncStewardQueue.v1',
        specVersion: '0.1.0',
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        updatedAt: now,
        groups: []
    };
}
export function enqueueRunnerSyncStewardRequest(queue, request, options = {}) {
    const normalized = normalizeRequestInput(request);
    const taskHealth = options.taskHealthResolver?.(normalized.taskId) ?? 'task-active';
    if (taskHealth !== 'task-active') {
        throw new Error(`ATM_RUNNER_SYNC_ENQUEUE_TASK_INVALID: task ${normalized.taskId} is ${taskHealth}; runner-sync steward enqueue requires an active task.`);
    }
    const base = normalizeQueue(queue, normalized.createdAt);
    const existingIndex = base.groups.findIndex((group) => group.sealedSourceSha === normalized.sealedSourceSha);
    const groups = existingIndex >= 0 ? [...base.groups] : [...base.groups, emptyGroup(normalized)];
    const targetIndex = existingIndex >= 0 ? existingIndex : groups.length - 1;
    const target = groups[targetIndex];
    const withoutCurrentTask = target.requests.filter((entry) => entry.taskId !== normalized.taskId);
    const nextRequests = [...withoutCurrentTask, requestForGroup(normalized, targetIndex + 1)]
        .sort(compareRequests);
    groups[targetIndex] = materializeGroup({
        ...target,
        updatedAt: normalized.heartbeatAt,
        requests: nextRequests
    }, targetIndex, taskHealthForRequest(options));
    const materialized = materializeQueue({ ...base, updatedAt: normalized.heartbeatAt, groups }, taskHealthForRequest(options));
    const group = materialized.groups[targetIndex];
    const status = group.queuePosition === 1
        ? 'queue-head'
        : existingIndex >= 0
            ? 'coalesced-waiter'
            : 'waiting-different-source';
    return {
        schemaId: 'atm.runnerSyncStewardQueueResult.v1',
        ok: true,
        status,
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        stewardWorkId: group.stewardWorkId,
        sealedSourceSha: group.sealedSourceSha,
        queuePosition: group.queuePosition,
        queueHeadHealth: group.queueHeadHealth ?? 'task-active',
        waitingTasks: group.waitingTasks,
        requestedSurfaces: group.requestedSurfaces,
        suggestedNextAction: group.suggestedNextAction,
        queue: materialized
    };
}
export function cleanupRunnerSyncStewardQueue(queue, now = new Date().toISOString(), options = {}) {
    const base = normalizeQueue(queue, now);
    const staleReleases = [];
    const groups = base.groups.flatMap((group, groupIndex) => {
        const live = group.requests.filter((request) => {
            const expired = isExpired(request, now);
            const health = expired ? 'task-active' : resolveTaskHealth(request, options);
            const releaseReason = expired ? 'ttl-expired' : staleReleaseReasonFromHealth(health);
            if (releaseReason) {
                staleReleases.push({
                    taskId: request.taskId,
                    actorId: request.actorId,
                    sealedSourceSha: request.sealedSourceSha,
                    stewardWorkId: group.stewardWorkId,
                    queuePosition: groupIndex + 1,
                    expiredAt: request.expiresAt,
                    reason: releaseReason,
                    safeRetryCommand: buildRetryCommand(request)
                });
            }
            return !releaseReason;
        });
        return live.length === 0 ? [] : [{ ...group, requests: live, updatedAt: now }];
    });
    return {
        schemaId: 'atm.runnerSyncStewardCleanupResult.v1',
        ok: true,
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        staleReleases,
        queue: materializeQueue({ ...base, updatedAt: now, groups }, options.taskHealthResolver)
    };
}
export function releaseRunnerSyncStewardQueue(queue, input) {
    const releasedAt = validIso(input.releasedAt) ? input.releasedAt : new Date().toISOString();
    const taskId = String(input.taskId ?? '').trim();
    const stewardWorkId = String(input.stewardWorkId ?? '').trim();
    const receiptRef = normalizeOptional(input.receiptRef);
    const receiptDigest = normalizeOptional(input.receiptDigest);
    if (!taskId || !stewardWorkId) {
        throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_INVALID: task and steward work id are required.');
    }
    if (!receiptRef && !receiptDigest) {
        throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_REQUIRED: release requires --receipt-ref or --receipt-digest.');
    }
    const base = materializeQueue(normalizeQueue(queue, releasedAt));
    const groupIndex = base.groups.findIndex((group) => group.stewardWorkId === stewardWorkId);
    if (groupIndex < 0) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_NOT_FOUND: steward work ${stewardWorkId} is not queued.`);
    }
    const group = base.groups[groupIndex];
    if (group.queuePosition !== 1) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_NOT_QUEUE_HEAD: steward work ${stewardWorkId} is at queue position ${group.queuePosition}.`);
    }
    const ownerRequest = group.requests.find((request) => request.taskId === taskId);
    if (!ownerRequest) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_OWNER_MISMATCH: task ${taskId} is not waiting on ${stewardWorkId}.`);
    }
    const remainingGroups = base.groups.filter((candidate) => candidate.stewardWorkId !== stewardWorkId);
    const nextQueue = materializeQueue({ ...base, updatedAt: releasedAt, groups: remainingGroups });
    const nextGroup = nextQueue.groups[0] ?? null;
    const next = nextGroup ? groupToResult(nextQueue, nextGroup) : null;
    const released = {
        taskId,
        actorId: ownerRequest.actorId,
        sealedSourceSha: group.sealedSourceSha,
        stewardWorkId: group.stewardWorkId,
        queuePosition: group.queuePosition,
        waitingTasks: group.waitingTasks,
        requestedSurfaces: group.requestedSurfaces,
        receiptRef,
        receiptDigest,
        releasedAt
    };
    return {
        schemaId: 'atm.runnerSyncStewardReleaseResult.v1',
        ok: true,
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        released,
        queue: nextQueue,
        next,
        suggestedNextAction: next
            ? `Runner-sync steward advanced to ${next.stewardWorkId} at queue position ${next.queuePosition}. ${next.suggestedNextAction}`
            : `Runner-sync steward queue is empty after releasing ${stewardWorkId}.`
    };
}
export function explainRunnerSyncStewardPosition(queue, taskId, now = new Date().toISOString(), options = {}) {
    const base = materializeQueue(normalizeQueue(queue, now), options.taskHealthResolver);
    const group = base.groups.find((candidate) => candidate.requests.some((request) => request.taskId === taskId));
    if (!group)
        return null;
    return groupToResult(base, group);
}
function groupToResult(queue, group) {
    const status = group.queuePosition === 1 ? 'queue-head' : 'coalesced-waiter';
    return {
        schemaId: 'atm.runnerSyncStewardQueueResult.v1',
        ok: true,
        status,
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        stewardWorkId: group.stewardWorkId,
        sealedSourceSha: group.sealedSourceSha,
        queuePosition: group.queuePosition,
        queueHeadHealth: group.queueHeadHealth ?? 'task-active',
        waitingTasks: group.waitingTasks,
        requestedSurfaces: group.requestedSurfaces,
        suggestedNextAction: group.suggestedNextAction,
        queue
    };
}
function normalizeQueue(queue, now) {
    if (!queue || queue.schemaId !== 'atm.runnerSyncStewardQueue.v1') {
        return emptyRunnerSyncStewardQueue(now);
    }
    return materializeQueue({
        schemaId: 'atm.runnerSyncStewardQueue.v1',
        specVersion: '0.1.0',
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        updatedAt: queue.updatedAt || now,
        groups: Array.isArray(queue.groups) ? queue.groups : []
    });
}
function materializeQueue(queue, taskHealthResolver) {
    const groups = [...queue.groups]
        .filter((group) => group.requests.length > 0)
        .sort(compareGroups)
        .map((group, index) => materializeGroup(group, index, taskHealthResolver));
    return {
        ...queue,
        stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
        groups
    };
}
function emptyGroup(request) {
    return {
        stewardWorkId: stewardWorkIdFor(request.sealedSourceSha),
        sealedSourceSha: request.sealedSourceSha,
        queuePosition: 1,
        status: 'queue-head',
        queueHeadHealth: 'task-active',
        createdAt: request.createdAt,
        updatedAt: request.heartbeatAt,
        requestedSurfaces: request.requestedSurfaces,
        waitingTasks: [],
        suggestedNextAction: '',
        requests: []
    };
}
function materializeGroup(group, groupIndex, taskHealthResolver) {
    const queuePosition = groupIndex + 1;
    const requestedSurfaces = sortedUnique(group.requests.flatMap((request) => request.requestedSurfaces));
    const waitingTasks = sortedUnique(group.requests.map((request) => request.taskId));
    const status = queuePosition === 1 ? 'queue-head' : 'waiting';
    const suggestedNextAction = status === 'queue-head'
        ? `Run one runner-sync build for ${group.sealedSourceSha}, publish the steward receipt, then release ${group.stewardWorkId}.`
        : `Wait for runner-sync queue position ${queuePosition}; retry broker runner-sync status --task <task-id> --json before starting a build.`;
    return {
        ...group,
        queuePosition,
        status,
        queueHeadHealth: resolveQueueHeadHealth(group.requests, taskHealthResolver),
        requestedSurfaces,
        waitingTasks,
        suggestedNextAction,
        requests: group.requests.map((request) => ({
            ...request,
            queuePosition,
            suggestedNextAction
        })).sort(compareRequests)
    };
}
function taskHealthForRequest(options) {
    return options.taskHealthResolver
        ? (request) => options.taskHealthResolver?.(request.taskId) ?? 'task-active'
        : undefined;
}
function resolveQueueHeadHealth(requests, taskHealthResolver) {
    const owner = requests[0] ?? null;
    return owner ? resolveTaskHealth(owner, { taskHealthResolver }) : 'task-active';
}
function normalizeRequestInput(request) {
    const createdAt = validIso(request.createdAt) ? request.createdAt : new Date().toISOString();
    const heartbeatAt = validIso(request.heartbeatAt) ? request.heartbeatAt : createdAt;
    const ttlSeconds = Number.isFinite(request.ttlSeconds) && (request.ttlSeconds ?? 0) > 0
        ? Math.trunc(request.ttlSeconds)
        : defaultTtlSeconds;
    const normalized = {
        taskId: String(request.taskId ?? '').trim(),
        actorId: String(request.actorId ?? '').trim(),
        sealedSourceSha: String(request.sealedSourceSha ?? '').trim(),
        requestedSurfaces: sortedUnique(request.requestedSurfaces.map(normalizePath).filter(Boolean)),
        createdAt,
        heartbeatAt,
        ttlSeconds
    };
    if (!normalized.taskId || !normalized.actorId || !normalized.sealedSourceSha || normalized.requestedSurfaces.length === 0) {
        throw new Error('ATM_RUNNER_SYNC_STEWARD_REQUEST_INVALID: task, actor, sealed source SHA, and at least one surface are required.');
    }
    return normalized;
}
function requestForGroup(request, queuePosition) {
    const expiresAt = new Date(Date.parse(request.heartbeatAt) + request.ttlSeconds * 1000).toISOString();
    return {
        ...request,
        expiresAt,
        queuePosition,
        suggestedNextAction: ''
    };
}
function isExpired(request, now) {
    const expiresAt = Date.parse(request.expiresAt);
    const nowMs = Date.parse(now);
    return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt <= nowMs;
}
function resolveTaskHealth(request, options) {
    if (options.taskHealthResolver) {
        return options.taskHealthResolver(request);
    }
    return options.shouldReleaseRequest?.(request) === true ? 'task-missing' : 'task-active';
}
function staleReleaseReasonFromHealth(health) {
    if (health === 'task-missing')
        return 'orphan-task-missing';
    if (health === 'task-terminal')
        return 'orphan-task-terminal';
    return null;
}
function buildRetryCommand(request) {
    const surfaces = request.requestedSurfaces.map((surface) => ` --surface ${quoteArg(surface)}`).join('');
    return `node atm.mjs broker runner-sync enqueue --task ${quoteArg(request.taskId)} --actor ${quoteArg(request.actorId)} --sealed-source-sha ${quoteArg(request.sealedSourceSha)}${surfaces} --json`;
}
function stewardWorkIdFor(sealedSourceSha) {
    return `runner-sync-${hash32(sealedSourceSha)}`;
}
function compareGroups(left, right) {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0)
        return createdOrder;
    return left.sealedSourceSha.localeCompare(right.sealedSourceSha);
}
function compareRequests(left, right) {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0)
        return createdOrder;
    return left.taskId.localeCompare(right.taskId);
}
function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function normalizePath(value) {
    return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeOptional(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
function validIso(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function hash32(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function quoteArg(value) {
    return JSON.stringify(value);
}

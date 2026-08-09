import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveRunnerSyncLeaseHealth } from './runner-sync-lease-health.js';
import { sanitizeIdentityValue } from '../shared/identity-normalization.js';
export function inspectRunnerSyncQueueHeadOwnership(input, steward) {
    if (!steward) {
        return {
            ok: false,
            stewardWorkId: null,
            queuePosition: null,
            queueHeadHealth: 'task-active',
            waitingTasks: [],
            ownerActorIds: [],
            reason: 'runner sync requires a broker runner-sync queue-head reservation before build or internal-release sync',
            cleanupCommand: null
        };
    }
    const ownerActorIds = normalizeOwnerActorIds(steward.requests);
    const actorOwnsHead = ownerActorIds.length === 0 || ownerActorIds.includes(input.stewardActorId);
    const queueHeadHealth = resolveQueueHeadHealth(input.cwd, steward.requests);
    const cleanupCommand = queueHeadHealth === 'task-active'
        ? null
        : 'node atm.mjs broker runner-sync cleanup --json';
    const ok = steward.queuePosition === 1 && actorOwnsHead && queueHeadHealth === 'task-active';
    return {
        ok,
        stewardWorkId: steward.stewardWorkId,
        queuePosition: steward.queuePosition,
        queueHeadHealth,
        waitingTasks: normalizeStringArray(steward.waitingTasks),
        ownerActorIds,
        reason: ok
            ? null
            : queueHeadHealth !== 'task-active'
                ? `runner sync steward ${steward.stewardWorkId} queue head is orphaned (${queueHeadHealth}); run ${cleanupCommand} before build or sync`
                : steward.queuePosition !== 1
                    ? `runner sync steward ${steward.stewardWorkId} is queued at position ${steward.queuePosition}; wait for queue head before build or sync`
                    : `runner sync steward ${steward.stewardWorkId} is owned by ${ownerActorIds.join(', ') || 'unknown actor'}, not ${input.stewardActorId}`,
        cleanupCommand
    };
}
export function readRunnerSyncStewardForSealedSource(cwd, sealedSourceSha) {
    const sealedSource = String(sealedSourceSha ?? '').trim();
    if (!sealedSource)
        return null;
    const queuePath = path.join(cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json');
    if (!existsSync(queuePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(queuePath, 'utf8'));
        const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
        for (const group of groups) {
            if (!group || typeof group !== 'object')
                continue;
            const record = group;
            if (record.sealedSourceSha !== sealedSource)
                continue;
            if (typeof record.stewardWorkId !== 'string' || typeof record.queuePosition !== 'number')
                return null;
            return {
                stewardWorkId: record.stewardWorkId,
                queuePosition: record.queuePosition,
                suggestedNextAction: typeof record.suggestedNextAction === 'string' ? record.suggestedNextAction : '',
                requestedSurfaces: normalizeStringArray(record.requestedSurfaces),
                waitingTasks: normalizeStringArray(record.waitingTasks),
                requests: normalizeStewardRequests(record.requests)
            };
        }
    }
    catch {
        return null;
    }
    return null;
}
export function normalizeInputRunnerSyncSteward(value) {
    if (!value)
        return null;
    return {
        stewardWorkId: value.stewardWorkId,
        queuePosition: value.queuePosition,
        suggestedNextAction: value.suggestedNextAction,
        requestedSurfaces: normalizeStringArray(value.requestedSurfaces),
        waitingTasks: normalizeStringArray(value.waitingTasks),
        requests: normalizeStewardRequests(value.requests)
    };
}
function normalizeOwnerActorIds(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .map((entry) => entry && typeof entry === 'object' ? String(entry.actorId ?? '').trim() : '')
            .filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function normalizeStewardRequests(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object')
            return [];
        const record = entry;
        const taskId = String(record.taskId ?? '').trim();
        const actorId = String(record.actorId ?? '').trim();
        if (!taskId || !actorId)
            return [];
        return [{
                taskId,
                actorId,
                requestedSurfaces: normalizeStringArray(record.requestedSurfaces)
            }];
    });
}
export function resolveActiveClaimOwnerActorId(cwd) {
    const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(tasksDir))
        return null;
    for (const entry of readdirSync(tasksDir)) {
        if (!entry.endsWith('.json'))
            continue;
        try {
            const task = JSON.parse(readFileSync(path.join(tasksDir, entry), 'utf8'));
            const claim = task.claim && typeof task.claim === 'object' ? task.claim : null;
            if (!claim || claim.state !== 'active')
                continue;
            const actorId = sanitizeIdentityValue(claim.actorId);
            if (actorId)
                return actorId;
        }
        catch {
            continue;
        }
    }
    return null;
}
export function resolveActiveLaneSessionId(cwd, stewardActorId) {
    const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(tasksDir))
        return null;
    for (const entry of readdirSync(tasksDir)) {
        if (!entry.endsWith('.json'))
            continue;
        try {
            const task = JSON.parse(readFileSync(path.join(tasksDir, entry), 'utf8'));
            const claim = task.claim && typeof task.claim === 'object' ? task.claim : null;
            if (!claim || claim.state !== 'active')
                continue;
            if (sanitizeIdentityValue(claim.actorId) !== stewardActorId)
                continue;
            const laneSession = claim.laneSession && typeof claim.laneSession === 'object'
                ? claim.laneSession
                : null;
            const laneSessionId = sanitizeIdentityValue(laneSession?.laneSessionId);
            if (laneSessionId)
                return laneSessionId;
        }
        catch {
            continue;
        }
    }
    return null;
}
function resolveQueueHeadHealth(cwd, requests) {
    if (!Array.isArray(requests) || requests.length === 0)
        return 'task-active';
    const taskId = String(requests[0]?.taskId ?? '').trim();
    if (!taskId)
        return 'task-active';
    return resolveRunnerSyncLeaseHealth(cwd, taskId);
}
function resolveFrameworkTempRunnerSyncTaskHealth(cwd, taskId) {
    const normalizedTaskId = String(taskId ?? '').trim();
    if (!normalizedTaskId.startsWith('ATM-FRAMEWORK-TEMP-')) {
        return null;
    }
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${normalizedTaskId}.lock.json`);
    if (!existsSync(lockPath)) {
        return 'task-missing';
    }
    try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        const workItemId = typeof lock.workItemId === 'string' ? lock.workItemId.trim() : '';
        const leaseId = typeof lock.leaseId === 'string' ? lock.leaseId.trim() : '';
        const heartbeatAt = typeof lock.heartbeatAt === 'string' ? lock.heartbeatAt : null;
        const released = lock.released === true || String(lock.status ?? '').trim().toLowerCase() === 'released';
        const ttlSeconds = typeof lock.ttlSeconds === 'number' && Number.isFinite(lock.ttlSeconds)
            ? lock.ttlSeconds
            : 0;
        if (workItemId !== normalizedTaskId || !leaseId || !heartbeatAt || ttlSeconds <= 0) {
            return 'task-missing';
        }
        return released ? 'task-terminal' : 'task-active';
    }
    catch {
        return 'task-missing';
    }
}

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function evaluateBrokerQueueAdmission(input) {
    const allowedFiles = uniquePaths(input.allowedFiles);
    const queues = readQueues(input.cwd);
    if (!queues.ok)
        return invalid(input.taskId, allowedFiles, queues.reason);
    const relevant = queues.value.filter((queue) => queue.entries.some((entry) => entry.taskId === input.taskId));
    if (relevant.length === 0)
        return {
            schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'not-queued', allowedFiles,
            queuedSharedPaths: [], waitingOn: [], reason: 'No canonical shared-surface queue entry exists for this claim.'
        };
    const overlapping = new Set(uniquePaths(input.overlappingFiles));
    const waitingOn = relevant.flatMap((queue) => {
        const position = queue.entries.findIndex((entry) => entry.taskId === input.taskId) + 1;
        const head = queue.entries[0];
        return head && head.taskId !== input.taskId ? [{ surfacePath: queue.surfacePath, queueHeadTaskId: head.taskId, position }] : [];
    });
    const queuedSharedPaths = uniquePaths(waitingOn.map((entry) => entry.surfacePath).filter((entry) => overlapping.has(entry) || allowedFiles.includes(entry)));
    if (waitingOn.length === 0)
        return {
            schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'queue-head', allowedFiles,
            queuedSharedPaths: [], waitingOn: [], reason: 'Task is head of every canonical shared-surface queue it holds.'
        };
    const privateFiles = allowedFiles.filter((file) => !queuedSharedPaths.includes(file));
    if (privateFiles.length > 0)
        return {
            schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'queued-private-work', allowedFiles: privateFiles,
            queuedSharedPaths, waitingOn, reason: 'Shared paths remain queued; the task may claim only its disjoint private paths.'
        };
    return {
        schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'queued-blocked', allowedFiles: [],
        queuedSharedPaths, waitingOn, reason: 'Every writable path for this task is behind a canonical shared-surface queue head.'
    };
}
/**
 * TASK-TEAM-0078 — project a team plan/start write scope through the
 * canonical shared-surface queue admission. `queued-private-work` restricts
 * the role write scope to the disjoint private paths; `queued-blocked` and
 * `invalid` reject the run. The projection never widens the input scope.
 */
export function restrictTeamWriteScopeForQueueAdmission(admission, writePaths) {
    const normalized = uniquePaths(writePaths);
    if (admission.status === 'queued-blocked' || admission.status === 'invalid') {
        return {
            schemaId: 'atm.teamQueueScopeDecision.v1',
            verdict: 'rejected',
            writePaths: [],
            queuedSharedPaths: admission.queuedSharedPaths,
            reason: admission.reason
        };
    }
    if (admission.status === 'queued-private-work') {
        const allowed = new Set(admission.allowedFiles);
        return {
            schemaId: 'atm.teamQueueScopeDecision.v1',
            verdict: 'restricted-private-work',
            writePaths: normalized.filter((entry) => allowed.has(entry)),
            queuedSharedPaths: admission.queuedSharedPaths,
            reason: admission.reason
        };
    }
    return {
        schemaId: 'atm.teamQueueScopeDecision.v1',
        verdict: 'unrestricted',
        writePaths: normalized,
        queuedSharedPaths: [],
        reason: admission.reason
    };
}
function readQueues(cwd) {
    const filePath = path.join(cwd, '.atm', 'runtime', 'broker-shared-surface-queues.json');
    if (!existsSync(filePath))
        return { ok: true, value: [] };
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed.queues) || !parsed.queues.every(isQueue))
            return { ok: false, reason: 'Canonical shared-surface queue document is malformed.' };
        return { ok: true, value: parsed.queues };
    }
    catch {
        return { ok: false, reason: 'Canonical shared-surface queue document cannot be read.' };
    }
}
function isQueue(value) {
    return Boolean(value) && typeof value === 'object' && value.schemaId === 'atm.brokerSharedSurfaceQueue.v1'
        && typeof value.surfacePath === 'string' && Array.isArray(value.entries);
}
function invalid(taskId, allowedFiles, reason) {
    return { schemaId: 'atm.brokerQueueAdmission.v1', taskId, status: 'invalid', allowedFiles, queuedSharedPaths: [], waitingOn: [], reason };
}
function uniquePaths(values) {
    return [...new Set(values.map((value) => String(value).trim().replace(/\\/g, '/')).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

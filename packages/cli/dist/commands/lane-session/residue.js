import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectReferencedLaneSession } from './resolve.js';
export function analyzeLaneSessionResidue(cwd, filePath, readTaskStatus) {
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!/^\.atm\/runtime\/lane-sessions\/[^/]+\.json$/i.test(normalizedPath))
        return null;
    const laneId = path.basename(normalizedPath, '.json');
    const record = readLaneSessionRecord(cwd, normalizedPath, laneId);
    const inspection = record ? inspectReferencedLaneSession({ cwd, laneSessionId: laneId }) : null;
    const session = inspection?.session ?? null;
    if (!session || !inspection) {
        return {
            finding: {
                path: normalizedPath,
                verdict: 'manual-review',
                reason: 'lane-session runtime file is malformed or its schema/id does not match the path; preserve it for manual review.',
                ownerTaskId: record?.taskId ?? null,
                cleanupAction: null
            },
            owner: { state: 'unknown', actorId: null }
        };
    }
    const ownerTaskId = session.taskId?.toUpperCase() ?? null;
    const taskStatus = ownerTaskId ? readTaskStatus(ownerTaskId) : null;
    const activeTask = Boolean(taskStatus && !['abandoned', 'cancelled', 'canceled', 'closed', 'done', 'released'].includes(taskStatus.toLowerCase()));
    const ended = inspection.availability === 'released' || inspection.availability === 'expired';
    const taskOwnershipResolved = !ownerTaskId || Boolean(taskStatus);
    const safeToRemove = ended && taskOwnershipResolved && !activeTask;
    const reason = safeToRemove
        ? 'Lane session is released or TTL-expired without an active task owner; its runtime authority is disposable.'
        : !taskOwnershipResolved
            ? `Lane session task ${ownerTaskId} is missing or unreadable; preserve it for owner reconciliation.`
            : activeTask
                ? `Lane session belongs to non-terminal task ${ownerTaskId}; preserve it for owner reconciliation.`
                : 'Lane session is still within its active lifetime; preserve it.';
    const ownerState = inspection.availability === 'available'
        ? 'active'
        : inspection.availability === 'released'
            ? 'released'
            : inspection.availability === 'expired'
                ? 'expired'
                : 'unknown';
    return {
        finding: {
            path: normalizedPath,
            verdict: safeToRemove ? 'auto-clean-safe' : 'manual-review',
            reason,
            ownerTaskId,
            cleanupAction: safeToRemove ? 'remove' : null
        },
        owner: { state: ownerState, actorId: session.actorId }
    };
}
function readLaneSessionRecord(cwd, filePath, laneId) {
    try {
        const raw = JSON.parse(readFileSync(path.join(cwd, filePath), 'utf8'));
        if (raw.schemaId !== 'atm.laneSession.v1'
            || raw.laneId !== laneId
            || typeof raw.actorId !== 'string'
            || !raw.actorId.trim()
            || typeof raw.status !== 'string'
            || !['active', 'handoff', 'adopted', 'released', 'expired'].includes(raw.status)
            || typeof raw.expiresAt !== 'string'
            || !Number.isFinite(Date.parse(raw.expiresAt)))
            return null;
        return { taskId: typeof raw.taskId === 'string' && raw.taskId.trim() ? raw.taskId.trim().toUpperCase() : null };
    }
    catch {
        return null;
    }
}

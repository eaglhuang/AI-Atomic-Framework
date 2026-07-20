import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
export function parseClaimRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const candidate = value;
    const actorId = typeof candidate.actorId === 'string' ? candidate.actorId.trim() : '';
    const leaseId = typeof candidate.leaseId === 'string' ? candidate.leaseId.trim() : '';
    const claimedAt = typeof candidate.claimedAt === 'string' ? candidate.claimedAt.trim() : '';
    const heartbeatAt = typeof candidate.heartbeatAt === 'string' ? candidate.heartbeatAt.trim() : claimedAt;
    const ttlSeconds = Number.isFinite(candidate.ttlSeconds) ? Number(candidate.ttlSeconds) : 1800;
    const files = Array.isArray(candidate.files)
        ? candidate.files.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => normalizeRelativePath(entry))
        : [];
    const stateRaw = typeof candidate.state === 'string' ? candidate.state.trim() : 'active';
    const state = stateRaw === 'released' || stateRaw === 'handoff' || stateRaw === 'taken_over' ? stateRaw : 'active';
    if (!actorId || !leaseId || !claimedAt || files.length === 0) {
        return null;
    }
    const handoffTo = typeof candidate.handoffTo === 'string' && candidate.handoffTo.trim().length > 0 ? candidate.handoffTo.trim() : undefined;
    const reason = typeof candidate.reason === 'string' && candidate.reason.trim().length > 0 ? candidate.reason.trim() : undefined;
    const laneSession = parseClaimLaneSession(candidate.laneSession);
    return {
        actorId,
        leaseId,
        claimedAt,
        heartbeatAt,
        ttlSeconds: ttlSeconds > 0 ? ttlSeconds : 1800,
        files,
        state,
        ...(handoffTo ? { handoffTo } : {}),
        ...(reason ? { reason } : {}),
        ...(laneSession ? { laneSession } : {})
    };
}
export function createClaimRecord(input) {
    const leaseSeed = `${input.taskId}|${input.actorId}|${input.timestamp}|${input.files.join(',')}`;
    return {
        actorId: input.actorId,
        leaseId: `lease-${createHash('sha256').update(leaseSeed).digest('hex').slice(0, 12)}`,
        claimedAt: input.timestamp,
        heartbeatAt: input.timestamp,
        ttlSeconds: input.ttlSeconds > 0 ? input.ttlSeconds : 1800,
        files: Array.from(new Set(input.files.map((entry) => normalizeRelativePath(entry)).filter(Boolean))),
        state: 'active'
    };
}
function parseClaimLaneSession(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const laneSessionId = typeof record.laneSessionId === 'string' ? record.laneSessionId.trim() : '';
    const status = typeof record.status === 'string' ? record.status.trim() : '';
    const source = typeof record.source === 'string' ? record.source.trim() : '';
    const exportHint = typeof record.exportHint === 'string' ? record.exportHint.trim() : '';
    if (!laneSessionId || !status || !source || !exportHint)
        return null;
    return { laneSessionId, status, source, exportHint };
}
export function isClaimExpired(claim, nowIso) {
    const heartbeatEpoch = Date.parse(claim.heartbeatAt);
    const nowEpoch = Date.parse(nowIso);
    if (!Number.isFinite(heartbeatEpoch) || !Number.isFinite(nowEpoch)) {
        return false;
    }
    return nowEpoch > heartbeatEpoch + claim.ttlSeconds * 1000;
}
export function listRuntimeLockTaskIds(cwd) {
    const ids = new Set();
    for (const root of [
        path.join(cwd, '.atm', 'runtime', 'locks'),
        path.join(cwd, '.atm', 'runtime', 'task-direction-locks')
    ]) {
        if (!existsSync(root))
            continue;
        for (const entry of readdirSync(root)) {
            if (entry.endsWith('.lock.json'))
                ids.add(entry.replace(/\.lock\.json$/, ''));
            if (entry.endsWith('.json'))
                ids.add(entry.replace(/\.json$/, ''));
        }
    }
    return [...ids].sort((left, right) => left.localeCompare(right));
}

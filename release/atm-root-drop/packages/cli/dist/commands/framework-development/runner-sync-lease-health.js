import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
function isLiveLease(record, now) {
    const heartbeatAt = Date.parse(String(record.heartbeatAt ?? ''));
    const ttlSeconds = Number(record.ttlSeconds);
    return Number.isFinite(heartbeatAt) && Number.isFinite(ttlSeconds) && ttlSeconds > 0 && heartbeatAt + ttlSeconds * 1000 > now;
}
export function resolveRunnerSyncLeaseHealth(cwd, taskId, now = Date.now()) {
    const id = String(taskId ?? '').trim();
    const isTemporary = id.startsWith('ATM-FRAMEWORK-TEMP-');
    const recordPath = isTemporary
        ? path.join(cwd, '.atm', 'runtime', 'locks', `${id}.lock.json`)
        : path.join(cwd, '.atm', 'history', 'tasks', `${id}.json`);
    if (!existsSync(recordPath))
        return 'task-missing';
    try {
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        if (isTemporary) {
            if (record.workItemId !== id)
                return 'task-missing';
            if (record.released === true || String(record.status ?? '').trim().toLowerCase() === 'released')
                return 'task-terminal';
            return isLiveLease(record, now) ? 'task-active' : 'task-lease-expired';
        }
        const status = String(record.status ?? '').trim().toLowerCase();
        if (status === 'done' || status === 'verified' || status === 'abandoned')
            return 'task-terminal';
        const claim = record.claim && typeof record.claim === 'object' ? record.claim : {};
        if (!claim.state)
            return 'task-active';
        return claim.state === 'active' && isLiveLease(claim, now) ? 'task-active' : 'task-lease-expired';
    }
    catch {
        return 'task-missing';
    }
}

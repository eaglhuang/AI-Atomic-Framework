import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathMatchesWriteScope } from '../../../../core/dist/broker/write-scope-policy.js';
export function readFrameworkTempLockProjection(cwd, now = Date.now()) {
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (!existsSync(lockRoot))
        return [];
    return readdirSync(lockRoot)
        .filter((entry) => entry.endsWith('.lock.json'))
        .flatMap((entry) => {
        try {
            const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), 'utf8'));
            if (String(parsed.status ?? '').trim().toLowerCase() === 'released')
                return [];
            const workItemId = text(parsed.workItemId);
            const actorId = text(parsed.actorId ?? parsed.lockedBy);
            if (!workItemId || !actorId)
                return [];
            const heartbeatAt = text(parsed.heartbeatAt ?? parsed.lockedAt);
            const ttlSeconds = number(parsed.ttlSeconds);
            const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
            return [{
                    workItemId,
                    actorId,
                    heartbeatAt,
                    ttlSeconds,
                    leaseFresh: heartbeatAt && ttlSeconds !== null && Number.isFinite(heartbeatMs)
                        ? now - heartbeatMs <= ttlSeconds * 1000
                        : null,
                    disposition: heartbeatAt && ttlSeconds !== null && Number.isFinite(heartbeatMs) && now - heartbeatMs <= ttlSeconds * 1000
                        ? 'foreign-live'
                        : 'stale-recovery-input',
                    linkedTaskId: text(parsed.linkedTaskId ?? parsed.taskId),
                    laneSessionId: text(parsed.laneSessionId),
                    laneProvenance: text(parsed.laneSessionId) ? 'recorded' : 'unrecorded-legacy',
                    files: uniqueStrings(Array.isArray(parsed.files) ? parsed.files : [])
                }];
        }
        catch {
            return [];
        }
    });
}
export function frameworkTempLockOwnsPath(locks, filePath) {
    return locks.find((lock) => lock.files.some((entry) => pathMatchesWriteScope(filePath, entry))) ?? null;
}
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function number(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === 'string').map(normalizePath).filter(Boolean))].sort();
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

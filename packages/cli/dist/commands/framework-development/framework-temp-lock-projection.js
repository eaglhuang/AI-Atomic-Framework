import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathMatchesWriteScope } from '../../../../core/dist/broker/write-scope-policy.js';
export function readFrameworkTempLockProjection(cwd, now = Date.now()) {
    return inspectFrameworkTempLockProjection(cwd, now).locks;
}
export function inspectFrameworkTempLockProjection(cwd, now = Date.now()) {
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (!existsSync(lockRoot)) {
        return {
            lockRootExists: false,
            discoveredLockFileCount: 0,
            readableLockFileCount: 0,
            unreadableLockFiles: [],
            locks: []
        };
    }
    const entries = readdirSync(lockRoot).filter((entry) => entry.endsWith('.lock.json'));
    const unreadableLockFiles = [];
    const locks = entries.flatMap((entry) => {
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
            unreadableLockFiles.push(entry);
            return [];
        }
    });
    return {
        lockRootExists: true,
        discoveredLockFileCount: entries.length,
        readableLockFileCount: entries.length - unreadableLockFiles.length,
        unreadableLockFiles: unreadableLockFiles.sort(),
        locks
    };
}
export function frameworkTempLockOwnsPath(locks, filePath) {
    return locks.find((lock) => lock.files.some((entry) => pathMatchesWriteScope(filePath, entry))) ?? null;
}
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function number(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === 'string').map(normalizePath).filter(Boolean))].sort();
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

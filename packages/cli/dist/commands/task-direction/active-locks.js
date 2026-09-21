import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isClaimExpired, parseClaimRecord } from '../tasks/task-ledger-readers.js';
import { dedupeDirectionLocks, isTaskDirectionLock } from './support.js';
/**
 * Projects durable direction records into currently enforceable write locks.
 * A lock without its live matching claim is recovery residue, never a writer.
 */
export function readActiveTaskDirectionLocks(cwd) {
    const locks = [];
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (existsSync(lockRoot))
        for (const entry of readdirSync(lockRoot).filter((item) => item.endsWith('.json'))) {
            try {
                const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), 'utf8'));
                const lock = parsed.taskDirectionLock;
                if (parsed.released === true || parsed.status === 'released' || !isTaskDirectionLock(lock))
                    continue;
                const authority = resolveLiveTaskDirectionAuthority(cwd, lock);
                if (authority)
                    locks.push(authority);
                else if (isActiveEmbeddedDirectionLock(parsed, lock))
                    locks.push(lock);
            }
            catch { /* malformed runtime records are not active locks */ }
        }
    const sidecarRoot = path.join(cwd, '.atm', 'runtime', 'task-direction-locks');
    if (existsSync(sidecarRoot))
        for (const entry of readdirSync(sidecarRoot).filter((item) => item.endsWith('.json'))) {
            try {
                const lock = JSON.parse(readFileSync(path.join(sidecarRoot, entry), 'utf8'));
                if (!isTaskDirectionLock(lock))
                    continue;
                const authority = resolveLiveTaskDirectionAuthority(cwd, lock);
                if (authority)
                    locks.push(authority);
            }
            catch { /* malformed runtime records are not active locks */ }
        }
    // Runtime lock files are projections, not a second source of authority. A
    // generic scope lock may legitimately replace a projection; retain the
    // durable direction lock whenever its ledger claim is still live.
    const taskRoot = path.join(cwd, '.atm', 'history', 'tasks');
    if (existsSync(taskRoot))
        for (const entry of readdirSync(taskRoot).filter((item) => item.endsWith('.json'))) {
            try {
                const task = JSON.parse(readFileSync(path.join(taskRoot, entry), 'utf8'));
                if (!isTaskDirectionLock(task.taskDirectionLock))
                    continue;
                const authority = resolveLiveTaskDirectionAuthority(cwd, task.taskDirectionLock);
                if (authority)
                    locks.push(authority);
            }
            catch { /* malformed ledger records are never active locks */ }
        }
    return dedupeDirectionLocks(locks);
}
/**
 * The task ledger claim is the authority source; runtime direction locks are
 * durable projections. Return one normalized snapshot so every consumer sees
 * the same actor, liveness, and lane fact instead of reconstructing it.
 */
function resolveLiveTaskDirectionAuthority(cwd, lock) {
    try {
        const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${lock.taskId}.json`);
        if (!existsSync(taskPath))
            return null;
        const claim = parseClaimRecord(JSON.parse(readFileSync(taskPath, 'utf8')).claim);
        if (!claim || claim.state !== 'active' || isClaimExpired(claim, new Date().toISOString()) || claim.actorId !== lock.actorId)
            return null;
        const lockLaneId = lock.laneSession?.laneSessionId;
        const claimLaneId = claim.laneSession?.laneSessionId;
        if (lockLaneId && claimLaneId && lockLaneId !== claimLaneId)
            return null;
        return lockLaneId || !claim.laneSession ? lock : { ...lock, laneSession: claim.laneSession };
    }
    catch {
        return null;
    }
}
function isActiveEmbeddedDirectionLock(record, lock) {
    if (record.status !== 'active')
        return false;
    const actorId = typeof record.actorId === 'string'
        ? record.actorId
        : typeof record.lockedBy === 'string'
            ? record.lockedBy
            : null;
    if (actorId !== lock.actorId)
        return false;
    const outerFiles = Array.isArray(record.files)
        ? record.files.filter((entry) => typeof entry === 'string')
        : [];
    if (outerFiles.length === 0)
        return true;
    const allowed = new Set(lock.allowedFiles.map((entry) => entry.replace(/\\/g, '/').toLowerCase()));
    return outerFiles.every((entry) => allowed.has(entry.replace(/\\/g, '/').toLowerCase()));
}

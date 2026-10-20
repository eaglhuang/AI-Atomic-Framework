import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
/**
 * Liveness of the process that holds a task's close transaction (#373).
 *
 * The close-window staged-index lock records no owner process; the per-task
 * close mutex lease does (`ownerPid`, `expiresAt`). A holder is alive when its
 * pid still runs, or when it left no pid and its lease has not expired, or when
 * the lock is younger than the stale threshold. Anything else is a dead holder
 * whose close can only be finished or aborted by the governed recovery lane.
 */
export const CLOSE_RECOVERY_DEFAULT_STALE_AFTER_MS = 120_000;
export function closeHolderMutexPath(cwd, taskId) {
    return path.join(cwd, '.atm', 'runtime', 'close-transactions', `${taskId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.lock.json`);
}
export function isProcessAlive(pid) {
    if (pid === process.pid)
        return true;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
function readLease(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
function leasePid(lease) {
    if (typeof lease?.ownerPid === 'number' && Number.isInteger(lease.ownerPid) && lease.ownerPid > 0)
        return lease.ownerPid;
    const match = String(lease?.leaseId ?? '').match(/-(\d+)$/);
    const pid = match ? Number(match[1]) : NaN;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}
export function resolveCloseRecoveryStaleAfterMs(value) {
    const raw = value ?? process.env.ATM_CLOSE_RECOVERY_STALE_AFTER_MS;
    const parsed = Number(raw);
    return raw !== undefined && raw !== null && raw !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : CLOSE_RECOVERY_DEFAULT_STALE_AFTER_MS;
}
export function inspectCloseHolderLiveness(input) {
    const nowMs = input.nowMs ?? Date.now();
    const staleAfterMs = input.staleAfterMs ?? resolveCloseRecoveryStaleAfterMs();
    const mutexPath = closeHolderMutexPath(input.cwd, input.taskId);
    const lease = readLease(mutexPath);
    const ownerPid = leasePid(lease);
    const ownerPidAlive = ownerPid === null ? null : (input.isAlive ?? isProcessAlive)(ownerPid);
    const leaseExpiresAt = typeof lease?.expiresAt === 'string' ? lease.expiresAt : null;
    const expiresMs = leaseExpiresAt ? Date.parse(leaseExpiresAt) : NaN;
    const acquiredMs = input.lockAcquiredAt ? Date.parse(input.lockAcquiredAt) : NaN;
    const lockAgeMs = Number.isFinite(acquiredMs) ? Math.max(0, nowMs - acquiredMs) : null;
    const base = { taskId: input.taskId, mutexPath, ownerPid, ownerPidAlive, leaseExpiresAt, lockAcquiredAt: input.lockAcquiredAt ?? null, lockAgeMs, staleAfterMs };
    if (ownerPidAlive === true)
        return { ...base, alive: true, reason: 'owner-pid-alive' };
    if (lease && ownerPid === null && Number.isFinite(expiresMs) && expiresMs > nowMs)
        return { ...base, alive: true, reason: 'lease-unexpired' };
    if (ownerPidAlive === false)
        return { ...base, alive: false, reason: 'owner-pid-gone' };
    if (lockAgeMs !== null && lockAgeMs < staleAfterMs)
        return { ...base, alive: true, reason: 'lock-younger-than-threshold' };
    return { ...base, alive: false, reason: lease ? 'lease-expired' : 'no-lease' };
}
export function closeRecoveryCommand(taskId, mode = 'recover') {
    return `node atm.mjs taskflow close --task ${taskId} --actor <actor-id> --${mode} --json`;
}

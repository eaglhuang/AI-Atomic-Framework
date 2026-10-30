import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from '../../_vendor/core/dist/broker/steward-kernel-lock.js';
import { inspectCloseHolderLiveness } from '../tasks/close-holder-liveness.js';
import { writeCloseAtomic } from './close-attempt.js';
export const GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS = 420_000;
export const CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS = 30_000;
export const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS = GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS + CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS;
export const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_REASON = 'covers governed git commit timeout plus close transaction safety margin';
const held = new Map();
const active = new AsyncLocalStorage();
export function closeTransactionMutexPath(repoRoot, taskId) {
    return path.join(repoRoot, '.atm/runtime/close-transactions', `${taskId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.lock.json`);
}
function kernelDirectory(lockPath) { return `${lockPath}.kernel`; }
function readLease(lockPath) {
    try {
        return JSON.parse(readFileSync(lockPath, 'utf8'));
    }
    catch {
        return null;
    }
}
function lostLease(lease) {
    return new Error(`ATM_CLOSE_LEASE_LOST: close ${lease.taskId} no longer owns ${lease.leaseId}; stop writes and recover the attempt`);
}
export function acquireCloseTransactionMutex(options) {
    const nowMs = options.nowMs ?? Date.now();
    const ttlMs = Math.max(1_000, Math.floor(options.ttlMs ?? DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS));
    const lockPath = closeTransactionMutexPath(options.repoRoot, options.taskId);
    mkdirSync(path.dirname(lockPath), { recursive: true });
    if (held.has(lockPath))
        throw new Error(`ATM close transaction mutex is already held for ${options.taskId}; lock=${lockPath}`);
    // Serialize reclamation, heartbeat and release with the existing OS-backed
    // lock. It survives caller death and the OS releases it after SIGKILL.
    try {
        acquireKernelAdvisoryLock(kernelDirectory(lockPath), 0, 1, lockPath);
    }
    catch {
        throw new Error(`ATM close transaction mutex is already held for ${options.taskId}; lock=${lockPath}`);
    }
    try {
        if (existsSync(lockPath)) {
            const current = readLease(lockPath);
            const holder = inspectCloseHolderLiveness({ cwd: options.repoRoot, taskId: options.taskId, nowMs, lockAcquiredAt: current?.acquiredAt });
            // Recovery and acquisition use exactly the same liveness rule: an
            // expired heartbeat is never evidence that a live PID has died.
            if (!current || holder.alive)
                throw new Error(`ATM close transaction mutex is already held for ${options.taskId}; lock=${lockPath}`);
            rmSync(lockPath);
        }
        const lease = {
            schemaId: 'atm.closeTransactionMutexLease.v1', taskId: options.taskId, actorId: options.actorId,
            leaseId: `close-${options.taskId}-${randomUUID()}-${process.pid}`, ownerPid: process.pid,
            acquiredAt: new Date(nowMs).toISOString(), heartbeatAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + ttlMs).toISOString(),
            ttlMs, ttlReason: DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_REASON, lockPath
        };
        writeCloseAtomic(lockPath, `${JSON.stringify(lease, null, 2)}\n`);
        held.set(lockPath, lease.leaseId);
        return lease;
    }
    catch (error) {
        releaseKernelAdvisoryLock(kernelDirectory(lockPath));
        throw error;
    }
}
export function assertCloseTransactionMutexOwned(lease) {
    if (held.get(lease.lockPath) !== lease.leaseId || readLease(lease.lockPath)?.leaseId !== lease.leaseId)
        throw lostLease(lease);
}
export function renewCloseTransactionMutex(lease, nowMs = Date.now()) {
    assertCloseTransactionMutexOwned(lease);
    const renewed = { ...lease, heartbeatAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + lease.ttlMs).toISOString() };
    writeCloseAtomic(lease.lockPath, `${JSON.stringify(renewed, null, 2)}\n`);
    return renewed;
}
/** No-op for unrelated commands; every mutation in a close context is fenced. */
export function assertActiveCloseLease() {
    const context = active.getStore();
    if (!context)
        return;
    if (context.lost)
        throw context.lost;
    try {
        assertCloseTransactionMutexOwned(context.lease);
        context.assertAuthority?.();
        const current = readLease(context.lease.lockPath);
        if (Date.parse(current.expiresAt) - Date.now() < current.ttlMs / 3)
            context.lease = renewCloseTransactionMutex(current);
    }
    catch (error) {
        context.lost = error instanceof Error ? error : lostLease(context.lease);
        throw context.lost;
    }
}
export function activeCloseLeaseIsOwned() {
    if (!active.getStore())
        return true;
    try {
        assertActiveCloseLease();
        return true;
    }
    catch {
        return false;
    }
}
export function releaseCloseTransactionMutex(lease) {
    // A stale finally block can neither unlink a replacement token nor release
    // the kernel lock belonging to a later acquisition in the same process.
    if (held.get(lease.lockPath) !== lease.leaseId)
        return;
    try {
        if (readLease(lease.lockPath)?.leaseId === lease.leaseId)
            rmSync(lease.lockPath, { force: true });
    }
    finally {
        held.delete(lease.lockPath);
        releaseKernelAdvisoryLock(kernelDirectory(lease.lockPath));
    }
}
export async function withCloseTransactionMutex(options, action) {
    const inherited = active.getStore();
    if (inherited && inherited.lease.lockPath === closeTransactionMutexPath(options.repoRoot, options.taskId)) {
        assertActiveCloseLease();
        if (inherited.lease.actorId !== options.actorId)
            throw new Error('ATM_CLOSE_LEASE_LOST: nested close actor differs from holder');
        return action(inherited.lease);
    }
    const lease = acquireCloseTransactionMutex(options);
    const context = { lease, lost: null, assertAuthority: options.assertAuthority };
    return active.run(context, async () => {
        const heartbeat = setInterval(() => {
            try {
                assertActiveCloseLease();
                context.lease = renewCloseTransactionMutex(context.lease);
            }
            catch (error) {
                context.lost = error instanceof Error ? error : lostLease(lease);
            }
        }, Math.min(10_000, Math.max(100, Math.floor(lease.ttlMs / 3))));
        heartbeat.unref();
        try {
            assertActiveCloseLease();
            const result = await action(lease);
            assertActiveCloseLease();
            return result;
        }
        finally {
            clearInterval(heartbeat);
            releaseCloseTransactionMutex(lease);
        }
    });
}

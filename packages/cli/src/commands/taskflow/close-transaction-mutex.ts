import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from '../../../../core/src/broker/steward-kernel-lock.ts';
import { inspectCloseHolderLiveness } from '../tasks/close-holder-liveness.ts';
import { writeCloseAtomic } from './close-attempt.ts';

export interface CloseTransactionMutexLease {
  readonly schemaId: 'atm.closeTransactionMutexLease.v1';
  readonly taskId: string;
  readonly actorId: string;
  readonly leaseId: string;
  readonly ownerPid?: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
  readonly ttlReason: string;
  readonly lockPath: string;
  readonly heartbeatAt?: string;
}
export interface AcquireCloseTransactionMutexOptions {
  readonly repoRoot: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly ttlMs?: number;
  readonly nowMs?: number;
  readonly assertAuthority?: () => void;
}
export const GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS = 420_000;
export const CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS = 30_000;
export const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS = GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS + CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS;
export const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_REASON = 'covers governed git commit timeout plus close transaction safety margin';
const held = new Map<string, string>();
interface LeaseContext { lease: CloseTransactionMutexLease; lost: Error | null; assertAuthority?: () => void }
const active = new AsyncLocalStorage<LeaseContext>();
export function closeTransactionMutexPath(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, '.atm/runtime/close-transactions', `${taskId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.lock.json`);
}
function kernelDirectory(lockPath: string): string { return `${lockPath}.kernel`; }
function readLease(lockPath: string): CloseTransactionMutexLease | null {
  try { return JSON.parse(readFileSync(lockPath, 'utf8')) as CloseTransactionMutexLease; } catch { return null; }
}
function lostLease(lease: CloseTransactionMutexLease): Error {
  return new Error(`ATM_CLOSE_LEASE_LOST: close ${lease.taskId} no longer owns ${lease.leaseId}; stop writes and recover the attempt`);
}
export function acquireCloseTransactionMutex(options: AcquireCloseTransactionMutexOptions): CloseTransactionMutexLease {
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = Math.max(1_000, Math.floor(options.ttlMs ?? DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS));
  const lockPath = closeTransactionMutexPath(options.repoRoot, options.taskId);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  if (held.has(lockPath)) throw new Error(`ATM close transaction mutex is already held for ${options.taskId}; lock=${lockPath}`);
  // Serialize reclamation, heartbeat and release with the existing OS-backed
  // lock. It survives caller death and the OS releases it after SIGKILL.
  try { acquireKernelAdvisoryLock(kernelDirectory(lockPath), 0, 1, lockPath); }
  catch { throw new Error(`ATM close transaction mutex is already held for ${options.taskId}; lock=${lockPath}`); }
  try {
    if (existsSync(lockPath)) {
      const current = readLease(lockPath);
      const holder = inspectCloseHolderLiveness({ cwd: options.repoRoot, taskId: options.taskId, nowMs, lockAcquiredAt: current?.acquiredAt });
      // Recovery and acquisition use exactly the same liveness rule: an
      // expired heartbeat is never evidence that a live PID has died.
      if (!current || holder.alive) throw new Error(`ATM close transaction mutex is already held for ${options.taskId}; lock=${lockPath}`);
      rmSync(lockPath);
    }
    const lease: CloseTransactionMutexLease = {
      schemaId: 'atm.closeTransactionMutexLease.v1', taskId: options.taskId, actorId: options.actorId,
      leaseId: `close-${options.taskId}-${randomUUID()}-${process.pid}`, ownerPid: process.pid,
      acquiredAt: new Date(nowMs).toISOString(), heartbeatAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + ttlMs).toISOString(),
      ttlMs, ttlReason: DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_REASON, lockPath
    };
    const fd = openSync(lockPath, 'wx', 0o600);
    try { writeFileSync(fd, `${JSON.stringify(lease, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    held.set(lockPath, lease.leaseId);
    return lease;
  } catch (error) { releaseKernelAdvisoryLock(kernelDirectory(lockPath)); throw error; }
}
export function assertCloseTransactionMutexOwned(lease: CloseTransactionMutexLease): void {
  if (held.get(lease.lockPath) !== lease.leaseId || readLease(lease.lockPath)?.leaseId !== lease.leaseId) throw lostLease(lease);
}
export function renewCloseTransactionMutex(lease: CloseTransactionMutexLease, nowMs = Date.now()): CloseTransactionMutexLease {
  assertCloseTransactionMutexOwned(lease);
  const renewed = { ...lease, heartbeatAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + lease.ttlMs).toISOString() };
  writeCloseAtomic(lease.lockPath, `${JSON.stringify(renewed, null, 2)}\n`);
  return renewed;
}
/** No-op for unrelated commands; every mutation in a close context is fenced. */
export function assertActiveCloseLease(): void {
  const context = active.getStore();
  if (!context) return;
  if (context.lost) throw context.lost;
  try {
    assertCloseTransactionMutexOwned(context.lease);
    context.assertAuthority?.();
    const current = readLease(context.lease.lockPath)!;
    if (Date.parse(current.expiresAt) - Date.now() < current.ttlMs / 3) context.lease = renewCloseTransactionMutex(current);
  } catch (error) {
    context.lost = error instanceof Error ? error : lostLease(context.lease);
    throw context.lost;
  }
}
export function activeCloseLeaseIsOwned(): boolean {
  if (!active.getStore()) return true;
  try { assertActiveCloseLease(); return true; } catch { return false; }
}
export function releaseCloseTransactionMutex(lease: CloseTransactionMutexLease): void {
  // A stale finally block can neither unlink a replacement token nor release
  // the kernel lock belonging to a later acquisition in the same process.
  if (held.get(lease.lockPath) !== lease.leaseId) return;
  try { if (readLease(lease.lockPath)?.leaseId === lease.leaseId) rmSync(lease.lockPath, { force: true }); }
  finally { held.delete(lease.lockPath); releaseKernelAdvisoryLock(kernelDirectory(lease.lockPath)); }
}
export async function withCloseTransactionMutex<T>(options: AcquireCloseTransactionMutexOptions, action: (lease: CloseTransactionMutexLease) => Promise<T> | T): Promise<T> {
  const inherited = active.getStore();
  if (inherited && inherited.lease.lockPath === closeTransactionMutexPath(options.repoRoot, options.taskId)) {
    assertActiveCloseLease();
    if (inherited.lease.actorId !== options.actorId) throw new Error('ATM_CLOSE_LEASE_LOST: nested close actor differs from holder');
    return action(inherited.lease);
  }
  const lease = acquireCloseTransactionMutex(options);
  const context: LeaseContext = { lease, lost: null, assertAuthority: options.assertAuthority };
  return active.run(context, async () => {
    const heartbeat = setInterval(() => {
      try { assertActiveCloseLease(); context.lease = renewCloseTransactionMutex(context.lease); }
      catch (error) { context.lost = error instanceof Error ? error : lostLease(lease); }
    }, Math.min(10_000, Math.max(100, Math.floor(lease.ttlMs / 3))));
    heartbeat.unref();
    try { assertActiveCloseLease(); const result = await action(lease); assertActiveCloseLease(); return result; }
    finally { clearInterval(heartbeat); releaseCloseTransactionMutex(lease); }
  });
}

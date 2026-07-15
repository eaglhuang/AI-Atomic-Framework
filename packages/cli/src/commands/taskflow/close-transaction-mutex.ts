import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface CloseTransactionMutexLease {
  readonly schemaId: 'atm.closeTransactionMutexLease.v1';
  readonly taskId: string;
  readonly actorId: string;
  readonly leaseId: string;
  readonly ownerPid?: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly lockPath: string;
}

export interface AcquireCloseTransactionMutexOptions {
  readonly repoRoot: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly ttlMs?: number;
  readonly nowMs?: number;
}

export const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS = 120_000;

export function closeTransactionMutexPath(repoRoot: string, taskId: string): string {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9_.-]+/g, '_');
  return path.join(repoRoot, '.atm', 'runtime', 'close-transactions', `${safeTaskId}.lock.json`);
}

export function acquireCloseTransactionMutex(options: AcquireCloseTransactionMutexOptions): CloseTransactionMutexLease {
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = Math.max(1_000, Math.floor(options.ttlMs ?? DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS));
  const lockPath = closeTransactionMutexPath(options.repoRoot, options.taskId);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  removeExpiredCloseTransactionMutex(lockPath, nowMs);

  const lease: CloseTransactionMutexLease = {
    schemaId: 'atm.closeTransactionMutexLease.v1',
    taskId: options.taskId,
    actorId: options.actorId,
    leaseId: `close-${options.taskId}-${nowMs}-${process.pid}`,
    ownerPid: process.pid,
    acquiredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    lockPath
  };

  let fd: number | null = null;
  try {
    fd = openSync(lockPath, 'wx');
    writeFileSync(fd, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
    closeSync(fd);
    fd = null;
    return lease;
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    const owner = readCloseTransactionMutex(lockPath);
    const ownerText = owner
      ? `${owner.taskId} by ${owner.actorId}, expires ${owner.expiresAt}`
      : 'unknown owner';
    throw new Error(`ATM close transaction mutex is already held for ${ownerText}; lock=${lockPath}`);
  }
}

export function releaseCloseTransactionMutex(lease: CloseTransactionMutexLease): void {
  const current = readCloseTransactionMutex(lease.lockPath);
  if (current?.leaseId !== lease.leaseId) {
    return;
  }
  rmSync(lease.lockPath, { force: true });
}

export async function withCloseTransactionMutex<T>(
  options: AcquireCloseTransactionMutexOptions,
  action: (lease: CloseTransactionMutexLease) => Promise<T> | T
): Promise<T> {
  const lease = acquireCloseTransactionMutex(options);
  try {
    return await action(lease);
  } finally {
    releaseCloseTransactionMutex(lease);
  }
}

function removeExpiredCloseTransactionMutex(lockPath: string, nowMs: number): void {
  if (!existsSync(lockPath)) {
    return;
  }
  const current = readCloseTransactionMutex(lockPath);
  const expiresAtMs = Date.parse(current?.expiresAt ?? '');
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    rmSync(lockPath, { force: true });
    return;
  }
  const ownerPid = readOwnerPid(current);
  if (ownerPid !== null && !isProcessAlive(ownerPid)) {
    rmSync(lockPath, { force: true });
  }
}

function readCloseTransactionMutex(lockPath: string): CloseTransactionMutexLease | null {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8')) as CloseTransactionMutexLease;
  } catch {
    return null;
  }
}

function readOwnerPid(lease: CloseTransactionMutexLease | null): number | null {
  if (typeof lease?.ownerPid === 'number' && Number.isInteger(lease.ownerPid) && lease.ownerPid > 0) {
    return lease.ownerPid;
  }
  const match = String(lease?.leaseId ?? '').match(/-(\d+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

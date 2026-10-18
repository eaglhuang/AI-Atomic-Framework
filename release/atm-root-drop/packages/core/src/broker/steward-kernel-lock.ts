/**
 * 跨行程、跨 PID namespace 的 canonical commit 鎖。
 * 用 SQLite BEGIN IMMEDIATE 取得 inode 上的核心層建議鎖（Linux fcntl / Windows LockFileEx）。
 * 鎖跟開著的檔案描述子走，持有者死亡（含 SIGKILL）時由核心釋放。
 * pid 與 /proc 啟動時間只寫進 owner 檔當診斷，絕不用來判斷死活或搶鎖。
 * 看不出鎖是否還活著時只等待，逾時回 recovery-required，不刪鎖、不覆寫。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadDatabaseSync } from './sqlite-runtime.ts';

const SQLITE_BUSY = 5;

export class StewardLockTimeoutError extends Error {
  readonly filePath: string;

  constructor(filePath: string, holderPid: number | null, waitMs: number) {
    const holder = holderPid === null ? 'an unknown holder' : `pid ${holderPid}`;
    super(`recovery-required: canonical commit lock for ${filePath} stayed held for ${waitMs}ms by ${holder}. Retry the steward apply after that owner finishes; do not overwrite the file.`);
    this.name = 'StewardLockTimeoutError';
    this.filePath = filePath;
  }
}

const held = new Map<string, DatabaseSync>();

export function acquireKernelAdvisoryLock(lockDir: string, waitMs: number, pollMs: number, filePath: string): void {
  mkdirSync(lockDir, { recursive: true });
  const dbPath = path.join(lockDir, 'lock.sqlite');
  const deadline = Date.now() + Math.max(0, waitMs);
  let db: DatabaseSync | null = null;
  try {
    while (true) {
      if (!db) {
        try {
          db = openLockDatabase(dbPath);
        } catch (error) {
          if (Date.now() >= deadline) throw new StewardLockTimeoutError(filePath, readDiagnosticPid(lockDir), waitMs);
          if (!isSqliteBusy(error)) sleepMs(pollMs);
          else sleepMs(pollMs);
          continue;
        }
      }
      try {
        db.exec('BEGIN IMMEDIATE');
        writeDiagnosticOwner(lockDir);
        held.set(lockDir, db);
        return;
      } catch (error) {
        if (!isSqliteBusy(error)) {
          closeQuiet(db);
          db = null;
        }
        if (Date.now() >= deadline) throw new StewardLockTimeoutError(filePath, readDiagnosticPid(lockDir), waitMs);
        sleepMs(pollMs);
      }
    }
  } catch (error) {
    if (db && !held.has(lockDir)) closeQuiet(db);
    throw error;
  }
}

export function releaseKernelAdvisoryLock(lockDir: string): void {
  const db = held.get(lockDir);
  if (!db) return;
  held.delete(lockDir);
  try {
    db.exec('COMMIT');
  } catch {
    try { db.exec('ROLLBACK'); } catch { /* 交易已結束 */ }
  }
  closeQuiet(db);
}

/**
 * 試著立刻取得這把鎖。取得得到代表沒有活著的持有者（含其他 PID namespace）。
 * 呼叫端會馬上 COMMIT，不會把鎖留著。看不出來時回 null，呼叫端不得把持有者當成已死。
 */
export function kernelAdvisoryLockIsFree(dbPath: string): boolean | null {
  let db: DatabaseSync | null = null;
  try {
    db = openLockDatabase(dbPath);
    db.exec('BEGIN IMMEDIATE');
    try { db.exec('COMMIT'); } catch { /* 空交易 */ }
    closeQuiet(db);
    return true;
  } catch (error) {
    closeQuiet(db);
    if (isSqliteBusy(error)) return false;
    return null;
  }
}

function openLockDatabase(dbPath: string): DatabaseSync {
  const db = new (loadDatabaseSync())(dbPath, { timeout: 0 });
  db.exec('PRAGMA busy_timeout = 0');
  // 這把鎖只靠核心層的檔案鎖。SQLite 檔本身不必耐久，關掉 fsync 以免每次取得都刷盤。
  db.exec('PRAGMA synchronous = OFF');
  db.exec('PRAGMA journal_mode = MEMORY');
  return db;
}

function writeDiagnosticOwner(lockDir: string): void {
  const startToken = readProcessStartToken(process.pid) ?? '';
  writeFileSync(path.join(lockDir, 'owner'), `v3\n${process.pid}\n${startToken}\n`, 'utf8');
}

function readDiagnosticPid(lockDir: string): number | null {
  try {
    const lines = readFileSync(path.join(lockDir, 'owner'), 'utf8').split('\n');
    const pidLine = lines[0] === 'v3' || lines[0] === 'v2' ? lines[1] : lines[0];
    const pid = Number((pidLine ?? '').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readProcessStartToken(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    return stat.slice(close + 1).trim().split(/\s+/)[19] ?? null;
  } catch {
    return null;
  }
}

function closeQuiet(db: DatabaseSync | null): void {
  if (!db) return;
  try { db.close(); } catch { /* 已關閉 */ }
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { errcode?: unknown; message?: unknown };
  if (candidate.errcode === SQLITE_BUSY) return true;
  return typeof candidate.message === 'string' && candidate.message.includes('database is locked');
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

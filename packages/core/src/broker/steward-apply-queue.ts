/**
 * 每個目標檔一條 broker apply 佇列。
 * 佇列只決定先後，正確性仍靠 canonical commit 的核心層建議鎖與 base-hash CAS。
 * 佇列目錄建不起來、或等不到隊伍頭，就改走只有檔案鎖的路徑，不中止寫入。
 * 隊伍頭若已死（建議鎖可取得），才會把它移出；看不出死活就繼續等，不搶位。
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadDatabaseSync } from './sqlite-runtime.ts';
import { defaultStewardCommitLockRoot, stewardCanonicalCommitPolicy } from './steward-commit-guard.ts';
import { kernelAdvisoryLockIsFree } from './steward-kernel-lock.ts';

export function defaultStewardApplyQueueRoot(cwd: string = process.cwd()): string {
  return path.join(path.resolve(cwd), '.atm', 'runtime', 'broker-steward-apply-queue');
}

export interface StewardCommitControls {
  readonly lockRoot: string;
  readonly lockWaitMs: number;
  readonly lockPollMs: number;
  readonly maxRecomposeAttempts: number;
  readonly recomposeBackoffMs: number;
  readonly recomposeJitterMs: number;
  readonly applyQueue: boolean;
  readonly applyQueueRoot: string;
  readonly applyQueueWaitMs: number;
}

/**
 * 顯式參數蓋過環境變數，環境變數蓋過 stewardCanonicalCommitPolicy。
 * 沒有「關掉檔案鎖」的開關；要消融鎖的共享範圍，改 ATM_STEWARD_COMMIT_LOCK_ROOT。
 */
export function resolveStewardCommitControls(input: {
  readonly cwd: string;
  readonly commitLockRoot?: string;
  readonly recomposePolicy?: {
    readonly maxRecomposeAttempts?: number;
    readonly recomposeBackoffMs?: number;
    readonly recomposeJitterMs?: number;
  };
  readonly applyQueue?: boolean;
  readonly applyQueueRoot?: string;
  readonly applyQueueWaitMs?: number;
}): StewardCommitControls {
  const fromEnv = readRecomposeEnv();
  const explicit = input.recomposePolicy;
  const waitRaw = process.env.ATM_STEWARD_APPLY_QUEUE_WAIT_MS;
  return {
    lockRoot: resolveLockRoot(input.cwd, input.commitLockRoot),
    lockWaitMs: stewardCanonicalCommitPolicy.lockWaitMs,
    lockPollMs: stewardCanonicalCommitPolicy.lockPollMs,
    maxRecomposeAttempts: explicit?.maxRecomposeAttempts ?? fromEnv.maxRecomposeAttempts ?? stewardCanonicalCommitPolicy.maxRecomposeAttempts,
    recomposeBackoffMs: explicit?.recomposeBackoffMs ?? fromEnv.recomposeBackoffMs ?? stewardCanonicalCommitPolicy.recomposeBackoffMs,
    recomposeJitterMs: explicit?.recomposeJitterMs ?? fromEnv.recomposeJitterMs ?? stewardCanonicalCommitPolicy.recomposeJitterMs,
    applyQueue: resolveApplyQueueEnabled(input.applyQueue),
    applyQueueRoot: input.applyQueueRoot?.trim()
      ? path.resolve(input.cwd, input.applyQueueRoot)
      : (process.env.ATM_STEWARD_APPLY_QUEUE_ROOT?.trim()
        ? path.resolve(input.cwd, process.env.ATM_STEWARD_APPLY_QUEUE_ROOT)
        : defaultStewardApplyQueueRoot(input.cwd)),
    applyQueueWaitMs: input.applyQueueWaitMs ?? (waitRaw?.trim() ? readNonNegativeInt(Number(waitRaw), 'ATM_STEWARD_APPLY_QUEUE_WAIT_MS') : stewardCanonicalCommitPolicy.applyQueueWaitMs)
  };
}

export function withStewardApplyQueue<T>(input: {
  readonly cwd: string;
  readonly targetPaths: readonly string[];
  readonly enabled: boolean;
  readonly queueRoot?: string;
  readonly waitMs: number;
  readonly pollMs: number;
}, fn: () => T): T {
  if (!input.enabled || input.targetPaths.length === 0) return fn();
  const queueRoot = input.queueRoot ?? defaultStewardApplyQueueRoot(input.cwd);
  let session: QueueSession;
  try {
    session = joinQueues(queueRoot, input.targetPaths, input.waitMs, input.pollMs);
  } catch (error) {
    if (!isQueueUnavailable(error)) throw error;
    return fn();
  }
  if (session.fallback) return fn();
  try {
    return fn();
  } finally {
    session.release();
  }
}

interface HeldTicket {
  readonly queueDir: string;
  readonly id: number;
  readonly nonce: string;
  readonly presencePath: string;
  readonly presence: DatabaseSync;
  readonly db: DatabaseSync;
}

interface QueueSession {
  readonly fallback: boolean;
  release(): void;
}

function joinQueues(queueRoot: string, targetPaths: readonly string[], waitMs: number, pollMs: number): QueueSession {
  const keys = [...new Set(targetPaths.map(queueKey))].sort((left, right) => left.localeCompare(right));
  const tickets: HeldTicket[] = [];
  try {
    for (const key of keys) {
      const ticket = joinOne(path.join(queueRoot, key), waitMs, pollMs);
      if (ticket === 'fallback') {
        releaseAll(tickets);
        return { fallback: true, release() { /* 已放開 */ } };
      }
      tickets.push(ticket);
    }
  } catch (error) {
    releaseAll(tickets);
    throw error;
  }
  return {
    fallback: false,
    release() { releaseAll(tickets); }
  };
}

function joinOne(queueDir: string, waitMs: number, pollMs: number): HeldTicket | 'fallback' {
  mkdirSync(path.join(queueDir, 'p'), { recursive: true });
  const nonce = randomBytes(8).toString('hex');
  const presencePath = path.join(queueDir, 'p', `${nonce}.sqlite`);
  const presence = openDatabase(presencePath);
  presence.exec('BEGIN IMMEDIATE');
  const db = openDatabase(path.join(queueDir, 'queue.sqlite'));
  const deadline = Date.now() + Math.max(0, waitMs);
  let id: number | null = null;
  try {
    id = insertWaiter(db, nonce, deadline, pollMs);
    if (id === null) {
      releasePresence(presence, presencePath);
      closeQuiet(db);
      return 'fallback';
    }
    const ready = waitUntilHead(db, queueDir, id, deadline, pollMs);
    if (!ready) {
      deleteWaiter(db, id);
      releasePresence(presence, presencePath);
      closeQuiet(db);
      return 'fallback';
    }
    return { queueDir, id, nonce, presencePath, presence, db };
  } catch (error) {
    if (id !== null) {
      try { deleteWaiter(db, id); } catch { /* 盡力移出，避免卡住後面的人 */ }
    }
    releasePresence(presence, presencePath);
    closeQuiet(db);
    throw error;
  }
}

function insertWaiter(db: DatabaseSync, nonce: string, deadline: number, pollMs: number): number | null {
  while (true) {
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('CREATE TABLE IF NOT EXISTS waiter (id INTEGER PRIMARY KEY AUTOINCREMENT, nonce TEXT NOT NULL)');
        const info = db.prepare('INSERT INTO waiter (nonce) VALUES (?)').run(nonce);
        db.exec('COMMIT');
        return Number(info.lastInsertRowid);
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* 交易未開始 */ }
        throw error;
      }
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;
      if (Date.now() >= deadline) return null;
      sleepMs(pollMs);
    }
  }
}

function waitUntilHead(db: DatabaseSync, queueDir: string, myId: number, deadline: number, pollMs: number): boolean {
  while (true) {
    const head = readHead(db);
    if (head && Number(head.id) === myId) return true;
    if (head) {
      const presencePath = path.join(queueDir, 'p', `${head.nonce}.sqlite`);
      const free = existsSync(presencePath) ? kernelAdvisoryLockIsFree(presencePath) : true;
      if (free === true) {
        deleteWaiter(db, Number(head.id));
        if (existsSync(presencePath)) rmSync(presencePath, { force: true });
        continue;
      }
    }
    if (Date.now() >= deadline) return false;
    sleepMs(pollMs);
  }
}

function readHead(db: DatabaseSync): { id: number | bigint; nonce: string } | null {
  try {
    const row = db.prepare('SELECT id, nonce FROM waiter ORDER BY id ASC LIMIT 1').get() as { id: number | bigint; nonce: string } | undefined;
    return row ?? null;
  } catch (error) {
    if (isSqliteBusy(error)) return null;
    throw error;
  }
}

function deleteWaiter(db: DatabaseSync, id: number): void {
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    if (isSqliteBusy(error)) return;
    throw error;
  }
  try {
    db.prepare('DELETE FROM waiter WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 交易未開始 */ }
    if (isSqliteBusy(error)) return;
    throw error;
  }
}

function releaseAll(tickets: readonly HeldTicket[]): void {
  for (const ticket of [...tickets].reverse()) {
    try { deleteWaiter(ticket.db, ticket.id); } catch { /* 盡力 */ }
    closeQuiet(ticket.db);
    releasePresence(ticket.presence, ticket.presencePath);
  }
}

function releasePresence(presence: DatabaseSync, presencePath: string): void {
  try { presence.exec('COMMIT'); } catch {
    try { presence.exec('ROLLBACK'); } catch { /* 已結束 */ }
  }
  closeQuiet(presence);
  rmSync(presencePath, { force: true });
}

function queueKey(targetPath: string): string {
  const physical = existsSync(targetPath) ? realpathSync(targetPath) : path.resolve(targetPath);
  return createHash('sha256').update(physical).digest('hex');
}

function openDatabase(dbPath: string): DatabaseSync {
  const db = new (loadDatabaseSync())(dbPath, { timeout: 0 });
  db.exec('PRAGMA busy_timeout = 0');
  // 佇列不是正確性後盾。關掉 fsync，讓沒有競爭的 apply 不必為隊伍票刷盤。
  db.exec('PRAGMA synchronous = OFF');
  db.exec('PRAGMA journal_mode = MEMORY');
  return db;
}

function closeQuiet(db: DatabaseSync | null): void {
  if (!db) return;
  try { db.close(); } catch { /* 已關閉 */ }
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { errcode?: unknown; message?: unknown };
  return candidate.errcode === 5 || (typeof candidate.message === 'string' && candidate.message.includes('database is locked'));
}

function isQueueUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOSPC' || code === 'ENOENT';
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function resolveLockRoot(cwd: string, explicit: string | undefined): string {
  if (explicit?.trim()) return path.resolve(cwd, explicit);
  const env = process.env.ATM_STEWARD_COMMIT_LOCK_ROOT;
  if (env?.trim()) return path.resolve(cwd, env);
  return defaultStewardCommitLockRoot(cwd);
}

function resolveApplyQueueEnabled(explicit: boolean | undefined): boolean {
  if (typeof explicit === 'boolean') return explicit;
  const raw = process.env.ATM_STEWARD_APPLY_QUEUE;
  if (raw === undefined || raw.trim() === '') return stewardCanonicalCommitPolicy.applyQueue === 'on';
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'on' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'off' || value === 'false' || value === 'no') return false;
  throw new Error(`ATM_STEWARD_APPLY_QUEUE must be on or off, received ${raw}`);
}

function readRecomposeEnv(): {
  readonly maxRecomposeAttempts?: number;
  readonly recomposeBackoffMs?: number;
  readonly recomposeJitterMs?: number;
} {
  const raw = process.env.ATM_STEWARD_RECOMPOSE_POLICY;
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ATM_STEWARD_RECOMPOSE_POLICY must be a JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ATM_STEWARD_RECOMPOSE_POLICY must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  return {
    maxRecomposeAttempts: readOptionalInt(record.maxRecomposeAttempts, 'maxRecomposeAttempts'),
    recomposeBackoffMs: readOptionalInt(record.recomposeBackoffMs, 'recomposeBackoffMs'),
    recomposeJitterMs: readOptionalInt(record.recomposeJitterMs, 'recomposeJitterMs')
  };
}

function readOptionalInt(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return readNonNegativeInt(value, `ATM_STEWARD_RECOMPOSE_POLICY.${label}`);
}

function readNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

/**
 * 跨行程的 canonical commit 守衛。
 * 合成與驗證留在鎖外；鎖只包住 base hash 比對與同目錄原子改名。
 * base 不符就回 re-compose，不寫入。暫存檔寫到一半不會改到正式檔。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import path from 'node:path';
import { hashContent } from './adapters/cas.ts';

/**
 * Cross-process canonical commit policy.
 * Compose and validation stay outside this boundary. The lock covers only the
 * base-hash compare and the atomic rename.
 */
export const stewardCanonicalCommitPolicy = {
  schemaId: 'atm.stewardCanonicalCommitPolicy.v1',
  lockWaitMs: 2_000,
  lockPollMs: 5,
  /** Extra compose attempts after the first. Each attempt ends applied, blocked, rolled-back, re-compose, or recovery-required. */
  maxRecomposeAttempts: 4,
  recomposeBackoffMs: 4,
  recomposeJitterMs: 3
} as const;

/** attempt 從 1 起算。backoff 隨次數增加，jitter 含 0。 */
export function stewardRecomposeDelayMs(attempt: number, backoffMs: number, jitterMs: number): number {
  if (attempt <= 0 || backoffMs < 0 || jitterMs < 0) return 0;
  const jitter = jitterMs === 0 ? 0 : randomInt(0, jitterMs + 1);
  return backoffMs * attempt + jitter;
}

export function waitStewardRecomposeBackoff(attempt: number, backoffMs: number, jitterMs: number): void {
  const delay = stewardRecomposeDelayMs(attempt, backoffMs, jitterMs);
  if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
}

export type StewardCommitFault =
  | { readonly kind: 'before-rename' }
  | { readonly kind: 'partial-temp'; readonly byteCount: number };

export interface CanonicalCommitEntry {
  readonly filePath: string;
  readonly targetPath: string;
  readonly expectedBaseHash: string;
  readonly content: string;
  readonly outputHash: string;
}

export interface CanonicalCommitFileReceipt {
  readonly filePath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly outputHash: string;
}

export interface CanonicalCommitResult {
  readonly status: 'applied' | 're-compose' | 'recovery-required' | 'rolled-back';
  readonly reason: string;
  readonly failedFile: string | null;
  readonly restoredFiles: readonly string[];
  readonly files: readonly CanonicalCommitFileReceipt[];
}

/**
 * 鎖放在儲存庫的 ATM 狀態目錄，讓不同 TMPDIR 或容器共用同一份工作樹。
 * 未給 cwd 時用 process.cwd()。
 */
export function defaultStewardCommitLockRoot(cwd: string = process.cwd()): string {
  return path.join(path.resolve(cwd), '.atm', 'runtime', 'steward-commit-locks');
}

export function canonicalCommitLockPath(lockRoot: string, targetPath: string): string {
  const physical = realpathSync(targetPath);
  const key = createHash('sha256').update(physical).digest('hex');
  return path.join(lockRoot, key);
}

/**
 * Commit composed bytes only when every target still matches its compose base.
 * A mismatch returns `re-compose` and does not write. A temp-file failure
 * leaves the canonical file untouched.
 */
export function commitCanonicalFiles(input: {
  readonly entries: readonly CanonicalCommitEntry[];
  readonly cwd?: string;
  readonly lockRoot?: string;
  readonly lockWaitMs?: number;
  readonly lockPollMs?: number;
  readonly failAfterWrites?: number;
  readonly commitFault?: StewardCommitFault;
  /** 測試用。鎖已取得、改名之前呼叫。被殺掉時鎖目錄會留給下一個持有者回收。 */
  readonly whileLocked?: () => void;
}): CanonicalCommitResult {
  const lockRoot = input.lockRoot ?? defaultStewardCommitLockRoot(input.cwd);
  const lockWaitMs = input.lockWaitMs ?? stewardCanonicalCommitPolicy.lockWaitMs;
  const lockPollMs = input.lockPollMs ?? stewardCanonicalCommitPolicy.lockPollMs;
  const entries = [...input.entries].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const held: string[] = [];
  const backups = new Map<string, string>();
  const files: CanonicalCommitFileReceipt[] = [];
  let failedFile: string | null = null;
  try {
    for (const entry of entries) {
      const lockDir = canonicalCommitLockPath(lockRoot, entry.targetPath);
      acquireLock(lockDir, lockWaitMs, lockPollMs, entry.filePath);
      held.push(lockDir);
    }
    for (const entry of entries) {
      const before = readFileSync(entry.targetPath, 'utf8');
      const observed = hashContent(before);
      if (observed !== entry.expectedBaseHash) {
        return {
          status: 're-compose',
          reason: `re-compose: canonical target base hash changed before commit: ${entry.filePath} (expected ${entry.expectedBaseHash}, observed ${observed}). Re-read the file and compose again against the current bytes.`,
          failedFile: entry.filePath,
          restoredFiles: [],
          files: []
        };
      }
      backups.set(entry.filePath, before);
    }
    input.whileLocked?.();
    let writeCount = 0;
    for (const entry of entries) {
      failedFile = entry.filePath;
      if (input.failAfterWrites !== undefined && writeCount >= input.failAfterWrites) {
        throw new Error(`injected apply failure before ${entry.filePath}`);
      }
      if (input.commitFault && writeCount === 0) {
        throwCommitFault(entry, input.commitFault);
      }
      replaceFileAtomically(entry.targetPath, entry.content);
      const after = readFileSync(entry.targetPath, 'utf8');
      const afterHash = hashContent(after);
      if (afterHash !== entry.outputHash) {
        throw new Error(`canonical output hash mismatch after replace: ${entry.filePath}`);
      }
      files.push({
        filePath: entry.filePath,
        beforeHash: entry.expectedBaseHash,
        afterHash,
        outputHash: entry.outputHash
      });
      writeCount += 1;
    }
    return {
      status: 'applied',
      reason: '',
      failedFile: null,
      restoredFiles: [],
      files
    };
  } catch (error) {
    if (error instanceof StewardLockTimeoutError && files.length === 0) {
      return {
        status: 'recovery-required',
        reason: error.message,
        failedFile: error.filePath,
        restoredFiles: [],
        files: []
      };
    }
    const restoredFiles: string[] = [];
    for (const [filePath, content] of [...backups].reverse()) {
      const entry = entries.find((candidate) => candidate.filePath === filePath);
      if (!entry) continue;
      try {
        replaceFileAtomically(entry.targetPath, content);
        restoredFiles.push(filePath);
      } catch (restoreError) {
        return {
          status: 'recovery-required',
          reason: `recovery-required: canonical rollback failed for ${filePath}: ${errorText(restoreError)}. Previous error: ${errorText(error)}.`,
          failedFile: filePath,
          restoredFiles: [...restoredFiles].sort((left, right) => left.localeCompare(right)),
          files
        };
      }
    }
    return {
      status: 'rolled-back',
      reason: errorText(error),
      failedFile,
      restoredFiles: restoredFiles.sort((left, right) => left.localeCompare(right)),
      files
    };
  } finally {
    for (const lockDir of [...held].reverse()) releaseLock(lockDir);
  }
}

class StewardLockTimeoutError extends Error {
  readonly filePath: string;

  constructor(filePath: string, holderPid: number | null, waitMs: number) {
    const holder = holderPid === null ? 'an unknown holder' : `pid ${holderPid}`;
    super(`recovery-required: canonical commit lock for ${filePath} stayed held for ${waitMs}ms by ${holder}. Retry the steward apply after that owner finishes; do not overwrite the file.`);
    this.name = 'StewardLockTimeoutError';
    this.filePath = filePath;
  }
}

interface LockOwner {
  readonly pid: number | null;
  readonly startToken: string | null;
  readonly nonce: string | null;
}

const heldNonces = new Map<string, string>();

function acquireLock(lockDir: string, waitMs: number, pollMs: number, filePath: string): void {
  mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      mkdirSync(lockDir);
      const nonce = randomBytes(8).toString('hex');
      const startToken = readProcessStartToken(process.pid) ?? '';
      try {
        writeFileSync(path.join(lockDir, 'owner'), `v2\n${process.pid}\n${startToken}\n${nonce}\n`, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        rmSync(lockDir, { recursive: true, force: true });
        throw error;
      }
      heldNonces.set(lockDir, nonce);
      return;
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error;
      if (holderIsDead(lockDir, waitMs)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new StewardLockTimeoutError(filePath, readOwner(lockDir).pid, waitMs);
      }
      sleepMs(pollMs);
    }
  }
}

function releaseLock(lockDir: string): void {
  const nonce = heldNonces.get(lockDir);
  const owner = readOwner(lockDir);
  if (!nonce || owner.nonce !== nonce || owner.pid !== process.pid) return;
  heldNonces.delete(lockDir);
  rmSync(lockDir, { recursive: true, force: true });
}

function holderIsDead(lockDir: string, staleIncompleteMs: number): boolean {
  const owner = readOwner(lockDir);
  if (owner.pid === null) {
    try {
      return Date.now() - statSync(lockDir).mtimeMs > staleIncompleteMs;
    } catch {
      return true;
    }
  }
  if (!pidIsAlive(owner.pid)) return true;
  if (!owner.startToken) return false;
  const current = readProcessStartToken(owner.pid);
  return Boolean(current) && current !== owner.startToken;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, 'ESRCH');
  }
}

function readOwner(lockDir: string): LockOwner {
  try {
    const lines = readFileSync(path.join(lockDir, 'owner'), 'utf8').split('\n');
    if (lines[0] === 'v2') {
      return { pid: parsePid(lines[1] ?? ''), startToken: lines[2] || null, nonce: lines[3] || null };
    }
    return { pid: parsePid(lines[0] ?? ''), startToken: null, nonce: null };
  } catch {
    return { pid: null, startToken: null, nonce: null };
  }
}

function parsePid(value: string): number | null {
  const pid = Number(value.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
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

function replaceFileAtomically(targetPath: string, content: string): void {
  const temporary = temporarySibling(targetPath);
  const mode = statSync(targetPath).mode;
  try {
    // Write the sibling to completion, then rename over the target. On POSIX
    // that rename is the concurrent-visibility boundary: readers see the old
    // file or the new file, never a short write with a stale tail. Durability
    // across power loss matches the previous writeFileSync, which also did not
    // fsync; fsync stays off so the uncontended path stays a few syscalls.
    writeFileSync(temporary, content, { encoding: 'utf8', mode: mode & 0o777 });
    renameSync(temporary, targetPath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function throwCommitFault(entry: CanonicalCommitEntry, fault: StewardCommitFault): never {
  const temporary = temporarySibling(entry.targetPath);
  try {
    if (fault.kind === 'partial-temp') {
      const fd = openSync(temporary, 'w');
      try {
        const bytes = Buffer.from(entry.content, 'utf8').subarray(0, Math.max(0, fault.byteCount));
        writeSync(fd, bytes);
      } finally {
        closeSync(fd);
      }
      throw new Error(`injected partial canonical temp write before rename: ${fault.byteCount} bytes`);
    }
    writeFileSync(temporary, entry.content, 'utf8');
    throw new Error(`injected commit fault before atomic rename: ${entry.filePath}`);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function temporarySibling(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString('hex')}.atm-tmp`
  );
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

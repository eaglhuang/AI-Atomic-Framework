/**
 * 即時寫入。不讀預先算好的 merge plan。
 *
 * 同一檔的鎖只包住「讀現況、決定、寫入、git commit」。
 * 第一筆 base 相符的寫入立刻提交。
 * 之後的寫入若改到已經提交的行，在碰檔案之前拒絕，帶回現在的內容，並留下佇列紀錄。
 * 不相交、而且上下文仍對得上現況的寫入，直接套上。
 * 宣告的 base 對不上、又沒有這條路徑自己提交過的不相交紀錄時，當成 stale-base，不寫。
 *
 * 既有的 `broker steward apply --merge-plan-file` 不受影響。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from '../broker/adapters/cas.ts';
import {
  canonicalCommitLockPath,
  defaultStewardCommitLockRoot
} from '../broker/steward-commit-guard.ts';
import {
  acquireKernelAdvisoryLock,
  releaseKernelAdvisoryLock,
  StewardLockTimeoutError
} from '../broker/steward-kernel-lock.ts';
import type { PatchProposal } from '../broker/types.ts';
import {
  UnifiedPatchApplicationError,
  applyUnifiedPatch,
  hunkOldLineIndex,
  parseUnifiedPatchHunks
} from '../broker/unified-patch.ts';

export type LiveWriteDecision = 'accepted' | 'rejected-by-design' | 'kit-error';

export type LiveWriteReasonCode =
  | 'overlapping-write-queued'
  | 'stale-base'
  | 'patch-context-mismatch'
  | 'outside-scope'
  | 'live-write-lock-timeout'
  | 'live-write-commit-failed';

export interface LiveQueuedWrite {
  readonly proposalId: string;
  readonly file: string;
  readonly decision: LiveWriteDecision;
  readonly reasonCode: LiveWriteReasonCode | null;
  readonly verdict: 'applied' | 'blocked';
  readonly queued: boolean;
  readonly currentFileText: string | null;
  readonly currentFileHash: string | null;
  readonly commitSha: string | null;
  readonly detail: string;
}

export interface LiveQueuedWriteResult {
  readonly ok: boolean;
  readonly writes: readonly LiveQueuedWrite[];
  readonly queuePath: string;
  readonly planRequired: false;
}

interface JournalEntry {
  readonly file: string;
  readonly baseHash: string;
  readonly afterHash: string;
  readonly changedLines: readonly number[];
  readonly proposalId: string;
}

const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 5;

export function applyLiveQueuedWrites(input: {
  readonly cwd: string;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles?: readonly string[];
  readonly stewardId?: string;
}): LiveQueuedWriteResult {
  const cwd = path.resolve(input.cwd);
  const scope = new Set((input.scopeFiles ?? []).map((file) => normalize(file)));
  const writes: LiveQueuedWrite[] = [];
  const groups = new Map<string, PatchProposal[]>();
  for (const proposal of input.proposals) {
    const file = normalize(proposal.targetFile);
    const list = groups.get(file) ?? [];
    list.push(proposal);
    groups.set(file, list);
  }
  for (const file of [...groups.keys()].sort((left, right) => left.localeCompare(right))) {
    const proposals = groups.get(file) ?? [];
    if (scope.size > 0 && !scope.has(file)) {
      for (const proposal of proposals) {
        writes.push(rejected(proposal, file, 'outside-scope', false, null, null, '目標檔不在 scope'));
      }
      continue;
    }
    writes.push(...applyFileGroup(cwd, file, proposals));
  }
  return {
    ok: writes.every((write) => write.decision === 'accepted'),
    writes,
    queuePath: queueRelativePath(),
    planRequired: false
  };
}

function applyFileGroup(cwd: string, file: string, proposals: readonly PatchProposal[]): LiveQueuedWrite[] {
  const targetPath = path.resolve(cwd, file);
  if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
    return proposals.map((proposal) => rejected(proposal, file, 'stale-base', true, null, null, '目標檔不存在'));
  }
  const lockDir = canonicalCommitLockPath(defaultStewardCommitLockRoot(cwd), targetPath);
  try {
    acquireKernelAdvisoryLock(lockDir, LOCK_WAIT_MS, LOCK_POLL_MS, file);
  } catch (error) {
    if (error instanceof StewardLockTimeoutError) {
      const current = readCurrent(targetPath);
      return proposals.map((proposal) => kitError(proposal, file, 'live-write-lock-timeout', current.text, current.hash, error.message));
    }
    throw error;
  }
  try {
    const results: LiveQueuedWrite[] = [];
    for (const proposal of proposals) {
      results.push(applyOneLocked(cwd, file, targetPath, proposal));
    }
    return results;
  } finally {
    releaseKernelAdvisoryLock(lockDir);
  }
}

function applyOneLocked(cwd: string, file: string, targetPath: string, proposal: PatchProposal): LiveQueuedWrite {
  const current = readCurrent(targetPath);
  const declared = normalizeHash(proposal.fileBeforeHash);
  const observed = normalizeHash(current.hash);
  const lines = patchLineIndexes(proposal.patch);
  if (declared === observed) {
    return commitPatch(cwd, file, targetPath, proposal, current.text, current.hash, lines.changed);
  }
  const prior = readJournal(cwd).filter((entry) => entry.file === file && normalizeHash(entry.baseHash) === declared);
  const overlaps = prior.some((entry) => intersects(entry.changedLines, lines.covered) || intersects(entry.changedLines, lines.changed));
  if (overlaps) {
    return queueRejection(cwd, proposal, file, 'overlapping-write-queued', current, '這筆寫入和已經提交的行重疊，檔案沒有被改');
  }
  let applied: string | null = null;
  try {
    applied = applyUnifiedPatch(current.text, proposal.patch);
  } catch (error) {
    if (!(error instanceof UnifiedPatchApplicationError)) throw error;
  }
  if (applied !== null && prior.length > 0) {
    return commitPrepared(cwd, file, targetPath, proposal, current.text, applied, lines.changed);
  }
  const detail = prior.length > 0
    ? 'base 已經前進，這份 patch 對不上現在的內容'
    : '宣告的 base 不是目前檔案，而且沒有可套用的不相交提交';
  return queueRejection(cwd, proposal, file, 'stale-base', current, detail);
}

function commitPatch(
  cwd: string,
  file: string,
  targetPath: string,
  proposal: PatchProposal,
  before: string,
  beforeHash: string,
  changedLines: readonly number[]
): LiveQueuedWrite {
  let next: string;
  try {
    next = applyUnifiedPatch(before, proposal.patch);
  } catch (error) {
    if (error instanceof UnifiedPatchApplicationError) {
      return rejected(proposal, file, 'patch-context-mismatch', false, before, beforeHash, error.message);
    }
    throw error;
  }
  return commitPrepared(cwd, file, targetPath, proposal, before, next, changedLines, beforeHash);
}

function commitPrepared(
  cwd: string,
  file: string,
  targetPath: string,
  proposal: PatchProposal,
  before: string,
  next: string,
  changedLines: readonly number[],
  baseHash = hashContent(before)
): LiveQueuedWrite {
  if (next === before) {
    return {
      proposalId: proposal.proposalId,
      file,
      decision: 'accepted',
      reasonCode: null,
      verdict: 'applied',
      queued: false,
      currentFileText: before,
      currentFileHash: hashContent(before),
      commitSha: headSha(cwd),
      detail: 'patch 沒有改變檔案'
    };
  }
  try {
    replaceFileAtomically(targetPath, next);
    const sha = gitCommit(cwd, file, proposal.proposalId);
    appendJournal(cwd, {
      file,
      baseHash,
      afterHash: hashContent(next),
      changedLines,
      proposalId: proposal.proposalId
    });
    return {
      proposalId: proposal.proposalId,
      file,
      decision: 'accepted',
      reasonCode: null,
      verdict: 'applied',
      queued: false,
      currentFileText: next,
      currentFileHash: hashContent(next),
      commitSha: sha,
      detail: '已寫入並提交'
    };
  } catch (error) {
    restoreFile(targetPath, before);
    const message = error instanceof Error ? error.message : String(error);
    return kitError(proposal, file, 'live-write-commit-failed', before, hashContent(before), message);
  }
}

function queueRejection(
  cwd: string,
  proposal: PatchProposal,
  file: string,
  reason: 'overlapping-write-queued' | 'stale-base',
  current: { text: string; hash: string },
  detail: string
): LiveQueuedWrite {
  appendQueue(cwd, {
    proposalId: proposal.proposalId,
    file,
    reasonCode: reason,
    currentFileHash: current.hash,
    queuedAt: new Date().toISOString()
  });
  return rejected(proposal, file, reason, true, current.text, current.hash, detail);
}

function patchLineIndexes(patch: string): { covered: number[]; changed: number[] } {
  const covered: number[] = [];
  const changed: number[] = [];
  for (const hunk of parseUnifiedPatchHunks(patch)) {
    let cursor = hunkOldLineIndex(hunk.oldStart);
    for (const entry of hunk.lines) {
      if (entry.marker === '+') {
        changed.push(cursor);
        continue;
      }
      covered.push(cursor);
      if (entry.marker === '-') changed.push(cursor);
      cursor += 1;
    }
  }
  return { covered, changed };
}

function intersects(left: readonly number[], right: readonly number[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

function readCurrent(targetPath: string): { text: string; hash: string } {
  const text = readFileSync(targetPath, 'utf8');
  return { text, hash: hashContent(text) };
}

function readJournal(cwd: string): JournalEntry[] {
  const file = path.join(cwd, journalRelativePath());
  if (!existsSync(file)) return [];
  const entries: JournalEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    entries.push(JSON.parse(line) as JournalEntry);
  }
  return entries;
}

function appendJournal(cwd: string, entry: JournalEntry): void {
  const file = path.join(cwd, journalRelativePath());
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function appendQueue(cwd: string, entry: unknown): void {
  const file = path.join(cwd, queueRelativePath());
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function journalRelativePath(): string {
  return path.join('.atm', 'runtime', 'live-write-journal.jsonl');
}

function queueRelativePath(): string {
  return path.join('.atm', 'runtime', 'live-write-queue.jsonl').split(path.sep).join('/');
}

function replaceFileAtomically(targetPath: string, content: string): void {
  const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${createHash('sha256').update(content).digest('hex').slice(0, 8)}.atm-tmp`);
  const mode = statSync(targetPath).mode;
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: mode & 0o777 });
    renameSync(temporary, targetPath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function restoreFile(targetPath: string, content: string): void {
  try {
    writeFileSync(targetPath, content, 'utf8');
  } catch {
    // 還原失敗留給呼叫端的 kit-error 訊息。
  }
}

function gitCommit(cwd: string, file: string, proposalId: string): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const add = spawnSync('git', ['-C', cwd, 'add', '--', file], { encoding: 'utf8' });
    if (add.status !== 0) {
      if (attempt < 4 && /index\.lock/.test(`${add.stderr}${add.stdout}`)) {
        sleepMs(20 * (attempt + 1));
        continue;
      }
      throw new Error(add.stderr || add.stdout || 'git add 失敗');
    }
    const commit = spawnSync('git', [
      '-C', cwd,
      '-c', 'user.name=atm-steward',
      '-c', 'user.email=atm-steward@localhost',
      '-c', 'commit.gpgsign=false',
      'commit', '-m', `steward live write ${proposalId}`,
      '--', file
    ], { encoding: 'utf8' });
    if (commit.status === 0) return headSha(cwd) ?? '';
    if (attempt < 4 && /index\.lock/.test(`${commit.stderr}${commit.stdout}`)) {
      sleepMs(20 * (attempt + 1));
      continue;
    }
    throw new Error(commit.stderr || commit.stdout || 'git commit 失敗');
  }
  throw new Error('git commit 失敗');
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function headSha(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return sha || null;
}

function rejected(
  proposal: PatchProposal,
  file: string,
  reasonCode: LiveWriteReasonCode,
  queued: boolean,
  text: string | null,
  hash: string | null,
  detail: string
): LiveQueuedWrite {
  return {
    proposalId: proposal.proposalId,
    file,
    decision: 'rejected-by-design',
    reasonCode,
    verdict: 'blocked',
    queued,
    currentFileText: text,
    currentFileHash: hash,
    commitSha: null,
    detail
  };
}

function kitError(
  proposal: PatchProposal,
  file: string,
  reasonCode: 'live-write-lock-timeout' | 'live-write-commit-failed',
  text: string | null,
  hash: string | null,
  detail: string
): LiveQueuedWrite {
  return {
    proposalId: proposal.proposalId,
    file,
    decision: 'kit-error',
    reasonCode,
    verdict: 'blocked',
    queued: false,
    currentFileText: text,
    currentFileHash: hash,
    commitSha: null,
    detail
  };
}

function normalize(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeHash(value: string): string {
  return value.replace(/^sha256:/, '');
}

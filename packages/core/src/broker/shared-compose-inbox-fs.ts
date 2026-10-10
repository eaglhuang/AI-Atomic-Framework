// 跨程序共用收件匣的磁碟格式。
// 同一目標檔在任一時刻最多一個開著的 compose 窗；鎖用核心層建議鎖，
// 持有者死亡時由作業系統釋放，不靠 pid 判斷死活。
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from './steward-kernel-lock.ts';

export type ProposalStage = 'admission' | 'batch' | 'compose' | 'commit';

export type ProposalTerminal =
  | 'committed'
  | 'rejected-conflict'
  | 'rejected-hash-drift'
  | 'rejected-admission'
  | 'timeout'
  | 'error';

export interface ComposeAdmission {
  readonly admitted: boolean;
  readonly reasonCode: string | null;
  readonly waitMs: number;
}

export interface StoredComposeProposal {
  proposalId: string;
  taskId: string;
  actorId: string;
  targetFile: string;
  targetPath: string;
  baseHash: string;
  baseBytes: string;
  baseCommit: string | null;
  patch: string;
  arrivedAt: number;
  late: boolean;
  admission: ComposeAdmission;
  stages: ProposalStage[];
  hashDriftCount: number;
}

export interface ComposeWindowMember {
  readonly proposalId: string;
  readonly arrivedAt: number;
  readonly late: boolean;
}

export interface ComposeWindowRecord {
  windowId: string;
  targetFile: string;
  targetPath: string;
  baseHash: string;
  baseBytes: string;
  openedAt: number;
  expiresAt: number;
  composeWindowMs: number;
  maxBatchSize: number;
  members: ComposeWindowMember[];
  state: 'open';
}

export type ComposeBatchStatus = 'composing' | 'committing' | 'committed' | 'rejected' | 'superseded';

export interface ComposeBatchRecord {
  batchId: string;
  windowId: string;
  targetFile: string;
  targetPath: string;
  baseHash: string;
  baseBytes: string;
  openedAt: number;
  sealedAt: number;
  arrivals: ComposeWindowMember[];
  batchSize: number;
  status: ComposeBatchStatus;
  /** superseded 批次不為成員寫終態收據，提案會對新的 base 重送。 */
  memberTerminal: boolean;
  composeVerdict: 'compatible' | 'conflict' | 'error' | null;
  diagnosticComposeVerdict: string | null;
  candidate: string | null;
  terminal: ProposalTerminal | null;
  detail: string | null;
}

export interface SharedComposeReceipt {
  proposalId: string;
  stage: ProposalStage;
  stagesReached: ProposalStage[];
  batchId: string | null;
  batchSize: number | null;
  baseHash: string;
  declaredBaseHash: string;
  late: boolean;
  terminal: ProposalTerminal;
  detail: string | null;
  composeVerdict: string | null;
  diagnosticComposeVerdict: string | null;
  hashDriftCount: number;
}

export function hashComposeBytes(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function sharedComposeFileKey(targetFile: string): string {
  return createHash('sha256').update(targetFile, 'utf8').digest('hex').slice(0, 32);
}

export function composeToken(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

export function assertSafeProposalId(proposalId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(proposalId)) {
    throw new Error(`proposalId 只能使用英數、點、底線與連字號：${proposalId}`);
  }
}

export function ensureComposeInbox(inboxDir: string): void {
  for (const name of ['locks', 'proposals', 'windows', 'batches', 'receipts']) {
    mkdirSync(path.join(inboxDir, name), { recursive: true });
  }
}

export function withComposeFileLock<T>(inboxDir: string, targetFile: string, waitMs: number, fn: () => T): T {
  const lockDir = path.join(inboxDir, 'locks', sharedComposeFileKey(targetFile));
  mkdirSync(lockDir, { recursive: true });
  acquireKernelAdvisoryLock(lockDir, waitMs, 10, targetFile);
  try {
    return fn();
  } finally {
    releaseKernelAdvisoryLock(lockDir);
  }
}

export function atomicWriteText(filePath: string, content: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-compose-${process.pid}-${randomBytes(3).toString('hex')}`
  );
  writeFileSync(tmp, content);
  return tmp;
}

export function commitTempFile(tmpPath: string, filePath: string): void {
  renameSync(tmpPath, filePath);
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
  commitTempFile(tmp, filePath);
}

export function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function proposalPath(inboxDir: string, proposalId: string): string {
  return path.join(inboxDir, 'proposals', `${proposalId}.json`);
}

export function windowPath(inboxDir: string, targetFile: string): string {
  return path.join(inboxDir, 'windows', `${sharedComposeFileKey(targetFile)}.json`);
}

export function batchPath(inboxDir: string, batchId: string): string {
  return path.join(inboxDir, 'batches', `${batchId}.json`);
}

export function receiptPath(inboxDir: string, proposalId: string): string {
  return path.join(inboxDir, 'receipts', `${proposalId}.json`);
}

export function readProposal(inboxDir: string, proposalId: string): StoredComposeProposal | null {
  return readJson<StoredComposeProposal>(proposalPath(inboxDir, proposalId));
}

export function writeProposal(inboxDir: string, proposal: StoredComposeProposal): void {
  writeJsonAtomic(proposalPath(inboxDir, proposal.proposalId), proposal);
}

export function readWindow(inboxDir: string, targetFile: string): ComposeWindowRecord | null {
  return readJson<ComposeWindowRecord>(windowPath(inboxDir, targetFile));
}

export function writeWindow(inboxDir: string, window: ComposeWindowRecord): void {
  writeJsonAtomic(windowPath(inboxDir, window.targetFile), window);
}

export function deleteWindow(inboxDir: string, targetFile: string): void {
  rmSync(windowPath(inboxDir, targetFile), { force: true });
}

export function readBatch(inboxDir: string, batchId: string): ComposeBatchRecord | null {
  return readJson<ComposeBatchRecord>(batchPath(inboxDir, batchId));
}

export function writeBatch(inboxDir: string, batch: ComposeBatchRecord): void {
  writeJsonAtomic(batchPath(inboxDir, batch.batchId), batch);
}

export function listBatches(inboxDir: string): ComposeBatchRecord[] {
  const dir = path.join(inboxDir, 'batches');
  if (!existsSync(dir)) return [];
  const batches: ComposeBatchRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const batch = readJson<ComposeBatchRecord>(path.join(dir, name));
    if (batch) batches.push(batch);
  }
  return batches;
}

export function readReceipt(inboxDir: string, proposalId: string): SharedComposeReceipt | null {
  return readJson<SharedComposeReceipt>(receiptPath(inboxDir, proposalId));
}

export function writeReceipt(inboxDir: string, receipt: SharedComposeReceipt): SharedComposeReceipt {
  const existing = readReceipt(inboxDir, receipt.proposalId);
  if (existing && existing.terminal !== 'timeout') return existing;
  writeJsonAtomic(receiptPath(inboxDir, receipt.proposalId), receipt);
  return receipt;
}

export function removeComposeTempFiles(directories: readonly string[]): string[] {
  const removed: string[] = [];
  for (const dir of directories) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.includes('.tmp-compose-')) continue;
      rmSync(path.join(dir, name), { force: true });
      removed.push(path.join(dir, name));
    }
  }
  return removed;
}

export function readTargetText(targetPath: string): string {
  if (!existsSync(targetPath)) return '';
  return readFileSync(targetPath, 'utf8');
}

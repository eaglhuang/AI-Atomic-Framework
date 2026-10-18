// Disk format for the cross-process shared compose inbox.
// One open window per target. The lock is the kernel advisory lock; a dead
// holder is released by the OS. Cleanup must not delete a live writer's temp.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from './steward-kernel-lock.ts';
import {
  SHARED_COMPOSE_CONTRACT,
  type ProposalStage,
  type ProposalTerminal,
  type StopReason
} from './shared-compose-inbox-contract.ts';

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
  scope: string | null;
  ticket: string | null;
  validators: string[];
  arrivedAt: number;
  firstSubmittedAt: number;
  deadlineMs: number;
  itemStopAt: number | null;
  retryCount: number;
  attemptCount: number;
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
  policyVersion: string;
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
  policyVersion: string;
  openedAt: number;
  sealedAt: number;
  arrivals: ComposeWindowMember[];
  batchSize: number;
  status: ComposeBatchStatus;
  memberTerminal: boolean;
  acceptedIds: string[];
  rejectedIds: string[];
  errorIds: string[];
  rejectionDetails: Record<string, string>;
  errorDetails: Record<string, string>;
  composeVerdict: 'compatible' | 'conflict' | 'error' | 'mixed' | null;
  diagnosticComposeVerdict: string | null;
  candidate: string | null;
  renameCount: number;
  renameAt: number | null;
  resultHash: string | null;
  terminal: ProposalTerminal | null;
  detail: string | null;
}

export interface SharedComposeReceipt {
  schemaId: typeof SHARED_COMPOSE_CONTRACT.schemaId;
  proposalId: string;
  taskId: string;
  actorId: string;
  scope: string | null;
  ticket: string | null;
  validators: string[];
  stage: ProposalStage;
  stagesReached: ProposalStage[];
  batchId: string | null;
  batchSize: number | null;
  memberProposalIds: string[];
  acceptedSetKey: string[];
  baseHash: string;
  declaredBaseHash: string;
  resultHash: string | null;
  late: boolean;
  terminal: ProposalTerminal;
  resolvedTerminal: ProposalTerminal | null;
  resolvedStopReason: StopReason | null;
  stopReason: StopReason;
  executableSeconds: number;
  firstSubmittedAt: number;
  effectiveStopAt: number;
  elapsedMs: number;
  attemptCount: number;
  retryCount: number;
  renameAt: number | null;
  ackAt: number | null;
  renameCount: number;
  detail: string | null;
  composeVerdict: string | null;
  diagnosticComposeVerdict: string | null;
  hashDriftCount: number;
  policyVersion: string;
}

export interface EntryPointRecord {
  entryPointId: string;
  pid: number;
  stoppedAt: number | null;
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

export function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${label} 只能使用英數、點、底線與連字號：${value}`);
  }
}

export function ensureComposeInbox(inboxDir: string): void {
  for (const name of ['locks', 'proposals', 'windows', 'batches', 'receipts', 'entry-points']) {
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

/** One file fsync plus a best-effort directory fsync. Callers must not count this as a retry. */
export function commitTempFile(tmpPath: string, filePath: string): void {
  const fd = openSync(tmpPath, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, filePath);
  fsyncDirectory(path.dirname(filePath));
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = atomicWriteText(filePath, `${JSON.stringify(value)}\n`);
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

export function entryPointPath(inboxDir: string, entryPointId: string): string {
  return path.join(inboxDir, 'entry-points', `${entryPointId}.json`);
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
  return listJson<ComposeBatchRecord>(path.join(inboxDir, 'batches'));
}

export function readReceipt(inboxDir: string, proposalId: string): SharedComposeReceipt | null {
  return readJson<SharedComposeReceipt>(receiptPath(inboxDir, proposalId));
}

export function writeReceipt(inboxDir: string, receipt: SharedComposeReceipt): SharedComposeReceipt {
  const existing = readReceipt(inboxDir, receipt.proposalId);
  if (existing && existing.terminal !== 'reconciliation-incomplete') return existing;
  writeJsonAtomic(receiptPath(inboxDir, receipt.proposalId), receipt);
  return readReceipt(inboxDir, receipt.proposalId) ?? receipt;
}

export function listReceipts(inboxDir: string): SharedComposeReceipt[] {
  return listJson<SharedComposeReceipt>(path.join(inboxDir, 'receipts'));
}

export function readEntryPoint(inboxDir: string, entryPointId: string): EntryPointRecord | null {
  return readJson<EntryPointRecord>(entryPointPath(inboxDir, entryPointId));
}

export function writeEntryPoint(inboxDir: string, record: EntryPointRecord): void {
  writeJsonAtomic(entryPointPath(inboxDir, record.entryPointId), record);
}

export function listEntryPoints(inboxDir: string): EntryPointRecord[] {
  return listJson<EntryPointRecord>(path.join(inboxDir, 'entry-points'));
}

export function liveEntryPoints(inboxDir: string): EntryPointRecord[] {
  return listEntryPoints(inboxDir).filter((record) => record.stoppedAt === null);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function tempOwnerPid(fileName: string): number | null {
  const match = /\.tmp-compose-(\d+)-[0-9a-f]+$/.exec(fileName);
  if (!match?.[1]) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) ? pid : null;
}

/** Removes compose temps whose owner pid is dead. Live writers' temps stay. */
export function removeComposeTempFiles(directories: readonly string[]): string[] {
  const removed: string[] = [];
  for (const dir of directories) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.includes('.tmp-compose-')) continue;
      const pid = tempOwnerPid(name);
      if (pid !== null && isProcessAlive(pid)) continue;
      const full = path.join(dir, name);
      rmSync(full, { force: true });
      removed.push(full);
    }
  }
  return removed;
}

export function parentDir(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index <= 0 ? '.' : filePath.slice(0, index);
}

export function readTargetText(targetPath: string): string {
  if (!existsSync(targetPath)) return '';
  return readFileSync(targetPath, 'utf8');
}

function listJson<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const rows: T[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const row = readJson<T>(path.join(dir, name));
    if (row) rows.push(row);
  }
  return rows;
}

function fsyncDirectory(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // Directory fsync is best effort on virtual filesystems. The file fsync already ran.
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

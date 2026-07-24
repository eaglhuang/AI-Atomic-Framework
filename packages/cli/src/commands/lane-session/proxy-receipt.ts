import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from '../shared.ts';
import { atomicWriteJson } from './store.ts';
import { capabilityFingerprint } from './redaction.ts';

/**
 * Non-replayable proxy/takeover receipts.
 *
 * A human or captain approval mints a single-use receipt that delegates one or
 * more mutation command classes from an owner lane to an executor lane for a
 * single task, bounded by a TTL. The receipt records approver, executor lane,
 * owner lane, task, command classes, reason, and expiry. The replayable nonce
 * is never stored; only its hash is persisted so a receipt cannot be forged or
 * replayed after it is consumed.
 */

export const runtimeProxyReceiptsRootRelativePath = '.atm/runtime/lane-proxy-receipts' as const;
export const historyProxyAuditRootRelativePath = '.atm/history/lane-proxy-audit' as const;

export type ProxyReceiptCommandClass =
  | 'taskflow-close-write'
  | 'governed-commit'
  | 'framework-mode'
  | 'runner-sync'
  | 'push';

export type ProxyReceiptGrantKind = 'proxy' | 'takeover';

export interface ProxyReceiptDocument {
  readonly schemaId: 'atm.laneProxyReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly receiptId: string;
  readonly grantKind: ProxyReceiptGrantKind;
  readonly nonceHash: string;
  readonly approver: string;
  readonly executorLaneId: string;
  readonly ownerLaneId: string;
  readonly taskId: string;
  readonly commandClasses: readonly ProxyReceiptCommandClass[];
  readonly reason: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly consumedCommandClass: ProxyReceiptCommandClass | null;
}

export interface IssueProxyReceiptInput {
  readonly cwd: string;
  readonly grantKind?: ProxyReceiptGrantKind;
  readonly approver: string;
  readonly executorLaneId: string;
  readonly ownerLaneId: string;
  readonly taskId: string;
  readonly commandClasses: readonly ProxyReceiptCommandClass[];
  readonly reason: string;
  readonly ttlMs: number;
  readonly now?: string;
  /** Optional deterministic nonce (tests). A random nonce is minted otherwise. */
  readonly nonce?: string;
}

export interface IssueProxyReceiptResult {
  readonly receipt: ProxyReceiptDocument;
  readonly receiptPath: string;
  /** The one-time nonce. Returned once at issue time and never persisted in the clear. */
  readonly nonce: string;
}

export function issueProxyReceipt(input: IssueProxyReceiptInput): IssueProxyReceiptResult {
  const cwd = path.resolve(input.cwd);
  const nowIso = normalizeIsoString(input.now) ?? new Date().toISOString();
  const nonce = normalizeOptionalString(input.nonce) ?? randomBytes(24).toString('hex');
  const commandClasses = normalizeCommandClasses(input.commandClasses);
  if (commandClasses.length === 0) {
    throw new Error('A proxy receipt must delegate at least one command class.');
  }
  const receiptId = createReceiptId({
    ownerLaneId: input.ownerLaneId,
    executorLaneId: input.executorLaneId,
    taskId: input.taskId,
    issuedAt: nowIso,
    nonce
  });
  const receipt: ProxyReceiptDocument = {
    schemaId: 'atm.laneProxyReceipt.v1',
    specVersion: '0.1.0',
    receiptId,
    grantKind: input.grantKind ?? 'proxy',
    nonceHash: hashNonce(nonce),
    approver: input.approver.trim(),
    executorLaneId: input.executorLaneId.trim(),
    ownerLaneId: input.ownerLaneId.trim(),
    taskId: input.taskId.trim(),
    commandClasses,
    reason: normalizeOptionalString(input.reason) ?? 'proxy execution approved',
    issuedAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + normalizePositiveInteger(input.ttlMs, 0)).toISOString(),
    consumedAt: null,
    consumedCommandClass: null
  };
  const absolutePath = proxyReceiptPathFor(cwd, receiptId);
  atomicWriteJson(absolutePath, receipt);
  return { receipt, receiptPath: relativePathFrom(cwd, absolutePath), nonce };
}

export interface FindUsableProxyReceiptInput {
  readonly cwd: string;
  readonly taskId: string;
  readonly ownerLaneId: string;
  readonly executorLaneId: string;
  readonly commandClass: ProxyReceiptCommandClass;
  readonly now?: string;
}

/**
 * Return the first usable (unconsumed, unexpired, surface-matching) receipt that
 * delegates {@link FindUsableProxyReceiptInput.commandClass} from the owner lane
 * to the executor lane for the task. Read-only; does not consume.
 */
export function findUsableProxyReceipt(input: FindUsableProxyReceiptInput): ProxyReceiptDocument | null {
  const nowMs = Date.parse(normalizeIsoString(input.now) ?? new Date().toISOString());
  const taskId = input.taskId.trim();
  const ownerLaneId = input.ownerLaneId.trim();
  const executorLaneId = input.executorLaneId.trim();
  for (const receipt of listProxyReceipts(input.cwd)) {
    if (receipt.consumedAt) continue;
    if (receipt.taskId !== taskId) continue;
    if (receipt.ownerLaneId !== ownerLaneId) continue;
    if (receipt.executorLaneId !== executorLaneId) continue;
    if (!receipt.commandClasses.includes(input.commandClass)) continue;
    const expiresMs = Date.parse(receipt.expiresAt);
    if (Number.isFinite(expiresMs) && Number.isFinite(nowMs) && nowMs > expiresMs) continue;
    return receipt;
  }
  return null;
}

export interface ConsumeProxyReceiptResult {
  readonly receipt: ProxyReceiptDocument;
  readonly receiptPath: string;
  readonly auditPath: string;
}

/**
 * Consume a usable receipt for the given command class, marking it non-replayable
 * and writing an immutable audit artifact under `.atm/history/lane-proxy-audit`.
 */
export function consumeProxyReceipt(input: FindUsableProxyReceiptInput & { readonly executingActorId?: string | null }): ConsumeProxyReceiptResult | null {
  const cwd = path.resolve(input.cwd);
  const usable = findUsableProxyReceipt(input);
  if (!usable) return null;
  const nowIso = normalizeIsoString(input.now) ?? new Date().toISOString();
  const consumed: ProxyReceiptDocument = {
    ...usable,
    consumedAt: nowIso,
    consumedCommandClass: input.commandClass
  };
  const receiptAbsolutePath = proxyReceiptPathFor(cwd, usable.receiptId);
  atomicWriteJson(receiptAbsolutePath, consumed);

  const auditRecord = {
    schemaId: 'atm.laneProxyAudit.v1' as const,
    specVersion: '0.1.0' as const,
    receiptId: consumed.receiptId,
    grantKind: consumed.grantKind,
    taskId: consumed.taskId,
    commandClass: input.commandClass,
    approver: consumed.approver,
    executingActorId: normalizeOptionalString(input.executingActorId) ?? null,
    ownerLaneFingerprint: capabilityFingerprint(consumed.ownerLaneId, 'lane'),
    executorLaneFingerprint: capabilityFingerprint(consumed.executorLaneId, 'lane'),
    reason: consumed.reason,
    issuedAt: consumed.issuedAt,
    expiresAt: consumed.expiresAt,
    consumedAt: nowIso
  };
  const auditAbsolutePath = proxyAuditPathFor(cwd, consumed.taskId, `${consumed.receiptId}-${input.commandClass}`);
  atomicWriteJson(auditAbsolutePath, auditRecord);

  return {
    receipt: consumed,
    receiptPath: relativePathFrom(cwd, receiptAbsolutePath),
    auditPath: relativePathFrom(cwd, auditAbsolutePath)
  };
}

export function listProxyReceipts(cwd: string): readonly ProxyReceiptDocument[] {
  const absoluteRoot = path.join(path.resolve(cwd), runtimeProxyReceiptsRootRelativePath);
  if (!existsSync(absoluteRoot)) return [];
  return readdirSync(absoluteRoot)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readProxyReceiptFile(path.join(absoluteRoot, entry)))
    .filter((entry): entry is ProxyReceiptDocument => entry !== null)
    .sort((left, right) => left.issuedAt.localeCompare(right.issuedAt));
}

export function proxyReceiptPathFor(cwd: string, receiptId: string): string {
  return path.join(path.resolve(cwd), runtimeProxyReceiptsRootRelativePath, `${safeFileId(receiptId)}.json`);
}

export function proxyAuditPathFor(cwd: string, taskId: string, artifactId: string): string {
  return path.join(path.resolve(cwd), historyProxyAuditRootRelativePath, safeFileId(taskId), `${safeFileId(artifactId)}.json`);
}

export function hashNonce(nonce: string): string {
  return `sha256:${createHash('sha256').update(nonce).digest('hex')}`;
}

function readProxyReceiptFile(filePath: string): ProxyReceiptDocument | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ProxyReceiptDocument>;
    if (parsed.schemaId !== 'atm.laneProxyReceipt.v1') return null;
    const receiptId = normalizeOptionalString(parsed.receiptId);
    const executorLaneId = normalizeOptionalString(parsed.executorLaneId);
    const ownerLaneId = normalizeOptionalString(parsed.ownerLaneId);
    const taskId = normalizeOptionalString(parsed.taskId);
    const nonceHash = normalizeOptionalString(parsed.nonceHash);
    if (!receiptId || !executorLaneId || !ownerLaneId || !taskId || !nonceHash) return null;
    return {
      schemaId: 'atm.laneProxyReceipt.v1',
      specVersion: '0.1.0',
      receiptId,
      grantKind: parsed.grantKind === 'takeover' ? 'takeover' : 'proxy',
      nonceHash,
      approver: normalizeOptionalString(parsed.approver) ?? 'unknown-approver',
      executorLaneId,
      ownerLaneId,
      taskId,
      commandClasses: normalizeCommandClasses(parsed.commandClasses),
      reason: normalizeOptionalString(parsed.reason) ?? 'proxy execution approved',
      issuedAt: normalizeIsoString(parsed.issuedAt) ?? new Date(0).toISOString(),
      expiresAt: normalizeIsoString(parsed.expiresAt) ?? new Date(0).toISOString(),
      consumedAt: normalizeIsoString(parsed.consumedAt) ?? null,
      consumedCommandClass: isCommandClass(parsed.consumedCommandClass) ? parsed.consumedCommandClass : null
    };
  } catch {
    return null;
  }
}

function createReceiptId(input: {
  readonly ownerLaneId: string;
  readonly executorLaneId: string;
  readonly taskId: string;
  readonly issuedAt: string;
  readonly nonce: string;
}): string {
  const stamp = input.issuedAt.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const digest = createHash('sha256')
    .update(`${input.ownerLaneId}\n${input.executorLaneId}\n${input.taskId}\n${input.issuedAt}\n${input.nonce}`)
    .digest('hex')
    .slice(0, 12);
  return `proxy-${stamp}-${digest}`;
}

function normalizeCommandClasses(value: unknown): readonly ProxyReceiptCommandClass[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<ProxyReceiptCommandClass>();
  for (const entry of value) {
    if (isCommandClass(entry)) out.add(entry);
  }
  return [...out];
}

function isCommandClass(value: unknown): value is ProxyReceiptCommandClass {
  return value === 'taskflow-close-write'
    || value === 'governed-commit'
    || value === 'framework-mode'
    || value === 'runner-sync'
    || value === 'push';
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function safeFileId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

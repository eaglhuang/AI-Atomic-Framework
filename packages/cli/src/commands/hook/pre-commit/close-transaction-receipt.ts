import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { CloseWindowStagedIndexLockRecord } from '../../tasks/close-window-lock.ts';

export const CLOSE_TRANSACTION_HOOK_RECEIPT_SCHEMA_ID = 'atm.closeTransactionHookReceipt.v1';
const RECEIPT_TTL_MS = 5 * 60 * 1000;

export interface CloseTransactionHookReceipt {
  readonly schemaId: typeof CLOSE_TRANSACTION_HOOK_RECEIPT_SCHEMA_ID;
  readonly receiptId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly invocationNonce: string;
  readonly commitSurface: 'taskflow-close-governance-followup';
  readonly closeWindowAcquiredAt: string;
  readonly parentHead: string;
  readonly candidateDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

function normalizeTaskId(value: string): string {
  return value.trim().toUpperCase();
}

function receiptPath(root: string): string {
  return path.join(root, '.atm', 'runtime', 'locks', 'close-transaction-hook-receipt.json');
}

function git(root: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

export function readCurrentHead(root: string): string | null {
  try {
    const head = git(root, ['rev-parse', '--verify', 'HEAD']);
    return /^[0-9a-f]{40}$/i.test(head) ? head.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Hash the sealed index entries, never the mutable worktree. */
export function digestStagedCandidate(root: string, allowedFiles: readonly string[], env?: NodeJS.ProcessEnv): string | null {
  const normalized = [...new Set(allowedFiles.map((entry) => entry.replace(/\\/g, '/').trim()).filter(Boolean))].sort();
  if (normalized.length === 0) return null;
  try {
    const entries = git(root, ['ls-files', '--stage', '-z', '--', ...normalized], env)
      .split('\0')
      .filter(Boolean)
      .sort();
    if (entries.length !== normalized.length) return null;
    return `sha256:${createHash('sha256').update(entries.join('\0')).digest('hex')}`;
  } catch {
    return null;
  }
}

export function writeCloseTransactionHookReceipt(input: {
  readonly root: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly invocationNonce: string;
  readonly commitSurface: 'taskflow-close-governance-followup';
  readonly closeWindowLock: CloseWindowStagedIndexLockRecord;
  readonly parentHead: string;
  readonly candidateDigest: string;
  readonly nowMs?: number;
}): CloseTransactionHookReceipt | null {
  if (input.closeWindowLock.status !== 'active'
    || normalizeTaskId(input.closeWindowLock.taskId) !== normalizeTaskId(input.taskId)
    || input.closeWindowLock.actorId !== input.actorId
    || !input.invocationNonce
    || !input.parentHead
    || !input.candidateDigest) return null;
  const now = input.nowMs ?? Date.now();
  const receipt: CloseTransactionHookReceipt = {
    schemaId: CLOSE_TRANSACTION_HOOK_RECEIPT_SCHEMA_ID,
    receiptId: randomUUID(),
    taskId: normalizeTaskId(input.taskId),
    actorId: input.actorId,
    invocationNonce: input.invocationNonce,
    commitSurface: input.commitSurface,
    closeWindowAcquiredAt: input.closeWindowLock.acquiredAt,
    parentHead: input.parentHead.toLowerCase(),
    candidateDigest: input.candidateDigest,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RECEIPT_TTL_MS).toISOString()
  };
  const target = receiptPath(input.root);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

export function consumeCloseTransactionHookReceipt(input: {
  readonly root: string;
  readonly taskId: string | null;
  readonly actorId: string | null;
  readonly invocationNonce: string | null;
  readonly commitSurface: string | null;
  readonly scopedIndexActive: boolean;
  readonly closeWindowLock: CloseWindowStagedIndexLockRecord | null;
  readonly stagedFiles: readonly string[];
  readonly nowMs?: number;
}): { readonly reusable: boolean; readonly reason: string } {
  if (!input.scopedIndexActive) return { reusable: false, reason: 'live-index commits cannot consume close-transaction receipts' };
  if (!input.taskId || !input.actorId || !input.invocationNonce || input.commitSurface !== 'taskflow-close-governance-followup' || !input.closeWindowLock || input.closeWindowLock.status !== 'active') return { reusable: false, reason: 'task, actor, invocation capability, or active close-window lock is missing' };
  const target = receiptPath(input.root);
  if (!existsSync(target)) return { reusable: false, reason: 'close-transaction receipt is missing' };
  let receipt: CloseTransactionHookReceipt;
  try {
    receipt = JSON.parse(readFileSync(target, 'utf8')) as CloseTransactionHookReceipt;
  } catch {
    return { reusable: false, reason: 'close-transaction receipt is unreadable' };
  }
  const parentHead = readCurrentHead(input.root);
  const candidateDigest = digestStagedCandidate(input.root, input.stagedFiles);
  const now = input.nowMs ?? Date.now();
  const valid = receipt.schemaId === CLOSE_TRANSACTION_HOOK_RECEIPT_SCHEMA_ID
    && normalizeTaskId(receipt.taskId) === normalizeTaskId(input.taskId)
    && receipt.actorId === input.actorId
    && receipt.invocationNonce === input.invocationNonce
    && receipt.commitSurface === input.commitSurface
    && receipt.closeWindowAcquiredAt === input.closeWindowLock.acquiredAt
    && receipt.parentHead === parentHead
    && receipt.candidateDigest === candidateDigest
    && Number.isFinite(Date.parse(receipt.expiresAt))
    && Date.parse(receipt.expiresAt) > now;
  if (!valid) return { reusable: false, reason: 'close-transaction receipt binding does not match this commit' };
  try { unlinkSync(target); } catch { /* single-use is enforced by the parent/digest binding even if cleanup races */ }
  return { reusable: true, reason: 'exact close-transaction receipt consumed' };
}

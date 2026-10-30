import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertActiveCloseLease } from './close-transaction-mutex.ts';
import { writeCloseAtomic } from './close-attempt.ts';

export const CLOSE_TRANSACTION_STATUS_SCHEMA_ID = 'atm.closeTransactionStatus.v1';
export type CloseTransactionPhase = 'started' | 'ledger-written' | 'target-commit-created' | 'planning-commit-created' | 'post-cleanup-complete' | 'rolled-back' | 'failed';
export interface CloseTransactionStatus {
  readonly schemaId: typeof CLOSE_TRANSACTION_STATUS_SCHEMA_ID;
  readonly taskId: string;
  readonly attemptId?: string | null;
  readonly phase: CloseTransactionPhase;
  readonly outcome: 'in-progress' | 'completed' | 'rolled-back' | 'failed';
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly ledgerCommit: string | null;
  readonly targetCommit: string | null;
  readonly planningCommit: string | null;
  readonly cleanupComplete: boolean;
  readonly recoveryCommand: string;
  readonly failure: string | null;
}
export function closeTransactionStatusPath(cwd: string, taskId: string): string { return path.join(cwd, '.atm', 'runtime', 'close-transactions', `${taskId}.json`); }
export function writeCloseTransactionStatus(input: { cwd: string; taskId: string; phase: CloseTransactionPhase; outcome?: CloseTransactionStatus['outcome']; startedAt?: string; ledgerCommit?: string | null; targetCommit?: string | null; planningCommit?: string | null; cleanupComplete?: boolean; failure?: string | null; }): CloseTransactionStatus {
  assertActiveCloseLease();
  const now = new Date().toISOString();
  // A new close attempt starts a fresh transaction; only phases of the same
  // attempt inherit its start time and commits (#373).
  const previous = input.phase === 'started' ? null : readCloseTransactionStatus(input.cwd, input.taskId);
  const outcome = input.outcome ?? (input.phase === 'post-cleanup-complete' ? 'completed' : input.phase === 'rolled-back' ? 'rolled-back' : input.phase === 'failed' ? 'failed' : 'in-progress');
  const record: CloseTransactionStatus = { schemaId: CLOSE_TRANSACTION_STATUS_SCHEMA_ID, taskId: input.taskId, attemptId: previous?.attemptId ?? (process.env.ATM_CLOSE_ATTEMPT_TASK === input.taskId ? process.env.ATM_CLOSE_ATTEMPT_ID ?? null : null), phase: input.phase, outcome, startedAt: input.startedAt ?? previous?.startedAt ?? now, updatedAt: now, ledgerCommit: input.ledgerCommit === undefined ? previous?.ledgerCommit ?? null : input.ledgerCommit, targetCommit: input.targetCommit === undefined ? previous?.targetCommit ?? null : input.targetCommit, planningCommit: input.planningCommit === undefined ? previous?.planningCommit ?? null : input.planningCommit, cleanupComplete: input.cleanupComplete ?? previous?.cleanupComplete ?? false, recoveryCommand: outcome === 'in-progress' || outcome === 'failed' ? `node atm.mjs taskflow close --task ${input.taskId} --actor <actor-id> --recover --json` : `node atm.mjs taskflow status --task ${input.taskId} --json`, failure: input.failure === undefined ? previous?.failure ?? null : input.failure };
  const filePath = closeTransactionStatusPath(input.cwd, input.taskId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeCloseAtomic(filePath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
export function readCloseTransactionStatus(cwd: string, taskId: string): CloseTransactionStatus | null { const filePath = closeTransactionStatusPath(cwd, taskId); if (!existsSync(filePath)) return null; try { const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<CloseTransactionStatus>; return parsed.schemaId === CLOSE_TRANSACTION_STATUS_SCHEMA_ID && parsed.taskId === taskId ? parsed as CloseTransactionStatus : null; } catch { return null; } }

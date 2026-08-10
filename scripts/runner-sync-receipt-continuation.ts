import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function uniqueReceiptTaskIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

/** Preserves a temporary steward's durable delivery-task continuation. */
export function resolveTemporaryStewardLinks(cwd: string, memberTaskIds: readonly string[]): string[] {
  return uniqueReceiptTaskIds(memberTaskIds.flatMap((memberTaskId) => {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${memberTaskId}.lock.json`);
    if (!existsSync(lockPath)) return [];
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
      const linkedTaskId = typeof lock.linkedTaskId === 'string' ? lock.linkedTaskId.trim() : '';
      return lock.workItemId === memberTaskId && linkedTaskId ? [linkedTaskId] : [];
    } catch {
      return [];
    }
  }));
}

function quoteCliArg(value: string): string { return JSON.stringify(value); }

export function buildRunnerSyncReleaseCommand(input: {
  readonly taskId: string;
  readonly stewardWorkId: string;
  readonly receiptRef: string;
  readonly receiptDigest?: string | null;
}): string {
  const digest = input.receiptDigest ? ` --receipt-digest ${quoteCliArg(input.receiptDigest)}` : '';
  return `node atm.mjs broker runner-sync release --task ${quoteCliArg(input.taskId)} --steward-work-id ${quoteCliArg(input.stewardWorkId)} --receipt-ref ${quoteCliArg(input.receiptRef)}${digest} --json`;
}

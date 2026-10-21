import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveActiveRunnerPublicationTask } from './sealed-runner-publication.ts';

// Reserve two hours for compilation and publication, before creating a worktree.
export const MIN_PUBLICATION_CLAIM_REMAINING_SECONDS = 7200;

export function assertSealedRunnerClaimLifetime(input: {
  cwd: string;
  actorId: string;
  taskId?: string | null;
  now?: string;
}): void {
  const now = input.now ?? new Date().toISOString();
  const renew = (taskId: string): string => `node atm.mjs tasks renew --task ${taskId} --actor ${input.actorId} --ttl-seconds 14400 --json`;
  let taskId: string;
  try {
    taskId = resolveActiveRunnerPublicationTask({ ...input, now });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} Renew publication authority before building: ${renew(input.taskId || '<task-id>')}`);
  }
  let authority: Record<string, unknown>;
  if (taskId.startsWith('ATM-FRAMEWORK-TEMP-')) {
    authority = JSON.parse(readFileSync(path.join(input.cwd, '.atm/runtime/locks', `${taskId}.lock.json`), 'utf8')) as Record<string, unknown>;
  } else {
    const task = JSON.parse(readFileSync(path.join(input.cwd, '.atm/history/tasks', `${taskId}.json`), 'utf8')) as { claim: Record<string, unknown> };
    authority = task.claim;
  }
  const heartbeat = Date.parse(String(authority.heartbeatAt ?? authority.claimedAt ?? authority.lockedAt ?? ''));
  const remaining = heartbeat + Number(authority.ttlSeconds) * 1000 - Date.parse(now);
  if (!Number.isFinite(remaining) || remaining < MIN_PUBLICATION_CLAIM_REMAINING_SECONDS * 1000) {
    throw new Error(`Publication claim ${taskId} has insufficient lifetime for a sealed build (requires ${MIN_PUBLICATION_CLAIM_REMAINING_SECONDS}s remaining). Renew before starting: ${renew(taskId)}`);
  }
}

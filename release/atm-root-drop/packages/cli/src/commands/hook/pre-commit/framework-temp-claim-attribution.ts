import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Verifies the lock-backed authority used by a temporary framework commit. */
export function hasLiveFrameworkTempClaimAttribution(input: {
  readonly cwd: string;
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly now?: number;
}): boolean {
  if (!input.actorId || !input.taskId?.startsWith('ATM-FRAMEWORK-TEMP-')) return false;
  const lockPath = path.join(input.cwd, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
  if (!existsSync(lockPath)) return false;
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const heartbeatAt = Date.parse(String(lock.heartbeatAt ?? lock.lockedAt ?? ''));
    const ttlSeconds = Number(lock.ttlSeconds);
    return lock.workItemId === input.taskId
      && (text(lock.actorId) ?? text(lock.lockedBy)) === input.actorId
      && lock.released !== true
      && String(lock.status ?? '').trim().toLowerCase() !== 'released'
      && Number.isFinite(heartbeatAt)
      && Number.isFinite(ttlSeconds)
      && ttlSeconds > 0
      && heartbeatAt + ttlSeconds * 1000 > (input.now ?? Date.now());
  } catch {
    return false;
  }
}

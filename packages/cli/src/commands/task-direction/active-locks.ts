import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { TaskDirectionLock } from '../task-direction.ts';
import { isClaimExpired, parseClaimRecord } from '../tasks/task-ledger-readers.ts';
import { dedupeDirectionLocks, isTaskDirectionLock } from './support.ts';

/**
 * Projects durable direction records into currently enforceable write locks.
 * A lock without its live matching claim is recovery residue, never a writer.
 */
export function readActiveTaskDirectionLocks(cwd: string): readonly TaskDirectionLock[] {
  const locks: TaskDirectionLock[] = [];
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (existsSync(lockRoot)) for (const entry of readdirSync(lockRoot).filter((item) => item.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), 'utf8')) as Record<string, unknown>;
      const lock = parsed.taskDirectionLock;
      if (parsed.released !== true && parsed.status !== 'released' && isTaskDirectionLock(lock) && hasLiveMatchingTaskClaim(cwd, lock)) locks.push(lock);
    } catch { /* malformed runtime records are not active locks */ }
  }
  const sidecarRoot = path.join(cwd, '.atm', 'runtime', 'task-direction-locks');
  if (existsSync(sidecarRoot)) for (const entry of readdirSync(sidecarRoot).filter((item) => item.endsWith('.json'))) {
    try {
      const lock = JSON.parse(readFileSync(path.join(sidecarRoot, entry), 'utf8'));
      if (isTaskDirectionLock(lock) && hasLiveMatchingTaskClaim(cwd, lock)) locks.push(lock);
    } catch { /* malformed runtime records are not active locks */ }
  }
  return dedupeDirectionLocks(locks);
}

function hasLiveMatchingTaskClaim(cwd: string, lock: TaskDirectionLock): boolean {
  try {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${lock.taskId}.json`);
    if (!existsSync(taskPath)) return false;
    const claim = parseClaimRecord((JSON.parse(readFileSync(taskPath, 'utf8')) as { claim?: unknown }).claim);
    if (!claim || claim.state !== 'active' || isClaimExpired(claim, new Date().toISOString()) || claim.actorId !== lock.actorId) return false;
    const lockLaneId = lock.laneSession?.laneSessionId;
    const claimLaneId = claim.laneSession?.laneSessionId;
    return !lockLaneId || !claimLaneId || lockLaneId === claimLaneId;
  } catch { return false; }
}

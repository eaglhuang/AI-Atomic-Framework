import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathMatchesWriteScope } from '../../../../core/src/broker/write-scope-policy.ts';

export type FrameworkTempLockDisposition = 'foreign-live' | 'stale-recovery-input';

export interface FrameworkTempLockProjection {
  readonly workItemId: string;
  readonly actorId: string;
  readonly heartbeatAt: string | null;
  readonly ttlSeconds: number | null;
  readonly leaseFresh: boolean | null;
  readonly disposition: FrameworkTempLockDisposition;
  readonly linkedTaskId: string | null;
  readonly laneSessionId: string | null;
  /**
   * ATM-GOV-0395: how the lane above was established.
   *
   * `recorded` — the producer wrote an explicit `laneSessionId`, so comparing
   * it against a caller's lane is meaningful in both directions.
   * `unrecorded-legacy` — the lock predates that guarantee. Its lane is
   * unknown, not different: treating the absence as a mismatch is what made a
   * live claim unusable by its own owner. Consumers must reconcile such a lock
   * before trusting it, and must fail closed while it stays ambiguous.
   */
  readonly laneProvenance: FrameworkTempLockLaneProvenance;
  readonly files: readonly string[];
}

export type FrameworkTempLockLaneProvenance = 'recorded' | 'unrecorded-legacy';

export function readFrameworkTempLockProjection(cwd: string, now = Date.now()): readonly FrameworkTempLockProjection[] {
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (!existsSync(lockRoot)) return [];
  return readdirSync(lockRoot)
    .filter((entry) => entry.endsWith('.lock.json'))
    .flatMap((entry): readonly FrameworkTempLockProjection[] => {
      try {
        const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), 'utf8')) as Record<string, unknown>;
        if (String(parsed.status ?? '').trim().toLowerCase() === 'released') return [];
        const workItemId = text(parsed.workItemId);
        const actorId = text(parsed.actorId ?? parsed.lockedBy);
        if (!workItemId || !actorId) return [];
        const heartbeatAt = text(parsed.heartbeatAt ?? parsed.lockedAt);
        const ttlSeconds = number(parsed.ttlSeconds);
        const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
        return [{
          workItemId,
          actorId,
          heartbeatAt,
          ttlSeconds,
          leaseFresh: heartbeatAt && ttlSeconds !== null && Number.isFinite(heartbeatMs)
            ? now - heartbeatMs <= ttlSeconds * 1000
            : null,
          disposition: heartbeatAt && ttlSeconds !== null && Number.isFinite(heartbeatMs) && now - heartbeatMs <= ttlSeconds * 1000
            ? 'foreign-live'
            : 'stale-recovery-input',
          linkedTaskId: text(parsed.linkedTaskId ?? parsed.taskId),
          laneSessionId: text(parsed.laneSessionId),
          laneProvenance: text(parsed.laneSessionId) ? 'recorded' : 'unrecorded-legacy',
          files: uniqueStrings(Array.isArray(parsed.files) ? parsed.files : [])
        }];
      } catch {
        return [];
      }
    });
}

export function frameworkTempLockOwnsPath(
  locks: readonly FrameworkTempLockProjection[],
  filePath: string
): FrameworkTempLockProjection | null {
  return locks.find((lock) => lock.files.some((entry) => pathMatchesWriteScope(filePath, entry))) ?? null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: readonly unknown[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map(normalizePath).filter(Boolean))].sort();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

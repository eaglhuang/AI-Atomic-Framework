import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface FrameworkTempLockProjection {
  readonly workItemId: string;
  readonly actorId: string;
  readonly heartbeatAt: string | null;
  readonly ttlSeconds: number | null;
  readonly leaseFresh: boolean | null;
  readonly files: readonly string[];
}

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
  const normalized = normalizePath(filePath);
  return locks.find((lock) => lock.files.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`))) ?? null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uniqueStrings(values: readonly unknown[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map(normalizePath).filter(Boolean))].sort();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

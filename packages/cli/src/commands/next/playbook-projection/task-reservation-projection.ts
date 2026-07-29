// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, readStringArray } from '../intent-normalizers.ts';
import { uniqueSorted } from '../view-projections.ts';
import { parseJsonText } from '../../shared.ts';
import { normalizeOptionalString } from '../route-resolution.ts';

const FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;

export interface TaskReservationProjection {
  readonly taskId: string;
  readonly title: string;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly createdAt: string | null;
  readonly importedAt: string | null;
  readonly ageSeconds: number;
  readonly ttlSeconds: number;
  readonly leaseFresh: boolean;
  readonly files: readonly string[];
}

export function inspectFreshTaskReservationForTask(
  cwd: string,
  task: { readonly workItemId: string },
  currentActorId: string | null | undefined,
  now: number,
  currentLaneSessionId: string | null | undefined = null
): TaskReservationProjection | null {
  const currentActor = currentActorId?.trim() || null;
  const currentLane = normalizeOptionalString(currentLaneSessionId);
  return readFreshTaskReservations(cwd, now).find((reservation) => {
    if (reservation.taskId !== task.workItemId) return false;
    if (!currentActor || reservation.actorId !== currentActor) return true;
    if (!currentLane || !reservation.laneSessionId) return false;
    return reservation.laneSessionId !== currentLane;
  }) ?? null;
}

export function readFreshTaskReservations(cwd: string, now: number): readonly TaskReservationProjection[] {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) return [];
  return readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): TaskReservationProjection[] => {
      try {
        const parsed = parseJsonText(readFileSync(path.join(taskStorePath, entry), 'utf8')) as Record<string, unknown>;
        const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
        if (!workItemId || !isTaskFreshReservationCandidate(parsed)) return [];
        const claimRecord = isRecord(parsed.claim) ? parsed.claim : {};
        if (claimRecord.state === 'active') return [];
        const source = isRecord(parsed.source) ? parsed.source : {};
        const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
        const actorId = readPlanningCardOwner(cwd, sourcePlanPath)
          ?? normalizeOptionalString(parsed.owner ?? parsed.ownerActorId ?? parsed.createdByActor ?? parsed.createdBy ?? parsed.importedByActor ?? parsed.importedBy ?? source.owner ?? source.actorId);
        if (!actorId) return [];
        const createdAt = normalizeOptionalString(parsed.createdAt ?? parsed.created_at ?? source.createdAt ?? source.created_at);
        const importedAt = normalizeOptionalString(parsed.importedAt ?? parsed.imported_at ?? source.importedAt ?? source.imported_at);
        const referenceAt = parseIsoMillis(importedAt) ?? parseIsoMillis(createdAt) ?? parseIsoMillis(normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at));
        if (referenceAt === null) return [];
        const ageSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
        if (ageSeconds > FRESH_TASK_RESERVATION_TTL_SECONDS) return [];
        return [{
          taskId: workItemId,
          title: normalizeOptionalString(parsed.title) ?? workItemId,
          actorId,
          laneSessionId: readLaneSessionIdFromTaskDocument(parsed),
          createdAt,
          importedAt,
          ageSeconds,
          ttlSeconds: FRESH_TASK_RESERVATION_TTL_SECONDS,
          leaseFresh: true,
          files: readReservationFiles(cwd, parsed, claimRecord)
        }];
      } catch {
        return [];
      }
    });
}

function readReservationFiles(cwd: string, parsed: Record<string, unknown>, claimRecord: Record<string, unknown>): readonly string[] {
  return uniqueSorted([
    ...readStringArray(parsed.scope), ...readStringArray(parsed.scopePaths), ...readStringArray(parsed.files),
    ...readStringArray(parsed.deliverables), ...readStringArray(parsed.targetAllowedFiles), ...readStringArray(claimRecord.files)
  ].map((file) => {
    const normalized = normalizeWorkPath(file);
    return path.isAbsolute(normalized) ? path.relative(cwd, normalized).replace(/\\/g, '/') : normalized;
  }).filter(Boolean));
}

function readLaneSessionIdFromTaskDocument(parsed: Record<string, unknown>): string | null {
  const source = isRecord(parsed.source) ? parsed.source : {};
  const claimRecord = isRecord(parsed.claim) ? parsed.claim : {};
  const directionLock = isRecord(parsed.taskDirectionLock) ? parsed.taskDirectionLock : {};
  return normalizeOptionalString(parsed.laneSessionId ?? parsed.laneId ?? source.laneSessionId ?? source.laneId)
    ?? readLaneSessionIdFromEnvelope(parsed.laneSession)
    ?? readLaneSessionIdFromEnvelope(source.laneSession)
    ?? readLaneSessionIdFromEnvelope(claimRecord.laneSession)
    ?? readLaneSessionIdFromEnvelope(directionLock.laneSession)
    ?? normalizeOptionalString(directionLock.laneSessionId ?? directionLock.guidanceSessionId);
}

function readLaneSessionIdFromEnvelope(value: unknown): string | null {
  return isRecord(value) ? normalizeOptionalString(value.laneSessionId) : null;
}

function isTaskFreshReservationCandidate(parsed: Record<string, unknown>): boolean {
  const status = normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? 'planned');
  return status === 'planned' || status === 'ready' || status === 'open' || status === 'reserved';
}

function readPlanningCardOwner(cwd: string, sourcePlanPath: string | null): string | null {
  if (!sourcePlanPath) return null;
  const candidate = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
  if (!existsSync(candidate)) return null;
  try {
    const rawText = readFileSync(candidate, 'utf8');
    const frontmatter = parseMarkdownFrontmatter(rawText);
    return isRecord(frontmatter)
      ? normalizeOptionalString(frontmatter.owner ?? frontmatter.actor ?? frontmatter.captain)
      : readFrontmatterScalar(rawText, 'owner') ?? readFrontmatterScalar(rawText, 'actor') ?? readFrontmatterScalar(rawText, 'captain');
  } catch {
    return null;
  }
}

function readFrontmatterScalar(rawText: string, key: string): string | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(rawText);
  const line = match?.[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
  return line ? normalizeOptionalString(line.slice(line.indexOf(':') + 1).replace(/^['"]|['"]$/g, '')) : null;
}

function parseIsoMillis(value: string | null | undefined): number | null {
  const millis = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(millis) ? millis : null;
}

function normalizeWorkPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

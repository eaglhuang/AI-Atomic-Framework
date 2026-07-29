import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, readStringArray } from '../intent-normalizers.js';
import { uniqueSorted } from '../view-projections.js';
import { parseJsonText } from '../../shared.js';
import { normalizeOptionalString } from '../route-resolution.js';
const FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;
export function inspectFreshTaskReservationForTask(cwd, task, currentActorId, now, currentLaneSessionId = null) {
    const currentActor = currentActorId?.trim() || null;
    const currentLane = normalizeOptionalString(currentLaneSessionId);
    return readFreshTaskReservations(cwd, now).find((reservation) => {
        if (reservation.taskId !== task.workItemId)
            return false;
        if (!currentActor || reservation.actorId !== currentActor)
            return true;
        if (!currentLane || !reservation.laneSessionId)
            return false;
        return reservation.laneSessionId !== currentLane;
    }) ?? null;
}
export function readFreshTaskReservations(cwd, now) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        try {
            const parsed = parseJsonText(readFileSync(path.join(taskStorePath, entry), 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId || !isTaskFreshReservationCandidate(parsed))
                return [];
            const claimRecord = isRecord(parsed.claim) ? parsed.claim : {};
            if (claimRecord.state === 'active')
                return [];
            const source = isRecord(parsed.source) ? parsed.source : {};
            const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
            const actorId = readPlanningCardOwner(cwd, sourcePlanPath)
                ?? normalizeOptionalString(parsed.owner ?? parsed.ownerActorId ?? parsed.createdByActor ?? parsed.createdBy ?? parsed.importedByActor ?? parsed.importedBy ?? source.owner ?? source.actorId);
            if (!actorId)
                return [];
            const createdAt = normalizeOptionalString(parsed.createdAt ?? parsed.created_at ?? source.createdAt ?? source.created_at);
            const importedAt = normalizeOptionalString(parsed.importedAt ?? parsed.imported_at ?? source.importedAt ?? source.imported_at);
            const referenceAt = parseIsoMillis(importedAt) ?? parseIsoMillis(createdAt) ?? parseIsoMillis(normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at));
            if (referenceAt === null)
                return [];
            const ageSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
            if (ageSeconds > FRESH_TASK_RESERVATION_TTL_SECONDS)
                return [];
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
        }
        catch {
            return [];
        }
    });
}
function readReservationFiles(cwd, parsed, claimRecord) {
    return uniqueSorted([
        ...readStringArray(parsed.scope), ...readStringArray(parsed.scopePaths), ...readStringArray(parsed.files),
        ...readStringArray(parsed.deliverables), ...readStringArray(parsed.targetAllowedFiles), ...readStringArray(claimRecord.files)
    ].map((file) => {
        const normalized = normalizeWorkPath(file);
        return path.isAbsolute(normalized) ? path.relative(cwd, normalized).replace(/\\/g, '/') : normalized;
    }).filter(Boolean));
}
function readLaneSessionIdFromTaskDocument(parsed) {
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
function readLaneSessionIdFromEnvelope(value) {
    return isRecord(value) ? normalizeOptionalString(value.laneSessionId) : null;
}
function isTaskFreshReservationCandidate(parsed) {
    const status = normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? 'planned');
    return status === 'planned' || status === 'ready' || status === 'open' || status === 'reserved';
}
function readPlanningCardOwner(cwd, sourcePlanPath) {
    if (!sourcePlanPath)
        return null;
    const candidate = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
    if (!existsSync(candidate))
        return null;
    try {
        const rawText = readFileSync(candidate, 'utf8');
        const frontmatter = parseMarkdownFrontmatter(rawText);
        return isRecord(frontmatter)
            ? normalizeOptionalString(frontmatter.owner ?? frontmatter.actor ?? frontmatter.captain)
            : readFrontmatterScalar(rawText, 'owner') ?? readFrontmatterScalar(rawText, 'actor') ?? readFrontmatterScalar(rawText, 'captain');
    }
    catch {
        return null;
    }
}
function readFrontmatterScalar(rawText, key) {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(rawText);
    const line = match?.[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
    return line ? normalizeOptionalString(line.slice(line.indexOf(':') + 1).replace(/^['"]|['"]$/g, '')) : null;
}
function parseIsoMillis(value) {
    const millis = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(millis) ? millis : null;
}
function normalizeWorkPath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listActorWorkSessions, resolveActorWorkSession } from '../../actor-session.js';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, normalizeSearchText, readStringArray } from '../intent-normalizers.js';
import { uniqueSorted } from '../view-projections.js';
import { parseJsonText } from '../../shared.js';
import { normalizeOptionalString } from '../route-resolution.js';
const NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;
export function buildActiveWorkSummary(cwd, currentActorId, ownFiles = []) {
    const now = Date.now();
    const currentActor = currentActorId?.trim() || null;
    const normalizedOwnFiles = uniqueSorted(ownFiles.map(normalizeWorkPath).filter(Boolean));
    const activeClaims = readActiveClaimRecords(cwd, now);
    const activeLocks = readActiveLockRecords(cwd, now);
    const freshReservations = readFreshTaskReservations(cwd, now);
    const stagedFiles = readStagedFiles(cwd);
    const currentSession = resolveActorWorkSession(cwd, {});
    const currentSessionId = currentSession?.sessionId ?? null;
    const actorMap = new Map();
    for (const claim of activeClaims) {
        const bucket = actorMap.get(claim.actorId) ?? { taskIds: new Set(), files: new Set(), sessionIds: new Set(), editors: new Set() };
        bucket.taskIds.add(claim.taskId);
        for (const file of claim.files)
            bucket.files.add(file);
        if (claim.sessionId)
            bucket.sessionIds.add(claim.sessionId);
        if (claim.editor)
            bucket.editors.add(claim.editor);
        actorMap.set(claim.actorId, bucket);
    }
    for (const lock of activeLocks) {
        const bucket = actorMap.get(lock.actorId) ?? { taskIds: new Set(), files: new Set(), sessionIds: new Set(), editors: new Set() };
        bucket.taskIds.add(lock.workItemId);
        for (const file of lock.files)
            bucket.files.add(file);
        actorMap.set(lock.actorId, bucket);
    }
    for (const reservation of freshReservations) {
        const bucket = actorMap.get(reservation.actorId) ?? { taskIds: new Set(), files: new Set(), sessionIds: new Set(), editors: new Set() };
        bucket.taskIds.add(reservation.taskId);
        for (const file of reservation.files)
            bucket.files.add(file);
        actorMap.set(reservation.actorId, bucket);
    }
    const activeActors = [...actorMap.entries()]
        .map(([actorId, value]) => ({
        actorId,
        taskIds: [...value.taskIds].sort((left, right) => left.localeCompare(right)),
        fileCount: value.files.size,
        sessionIds: [...value.sessionIds].sort((left, right) => left.localeCompare(right)),
        sessionCount: value.sessionIds.size,
        editors: [...value.editors].sort((left, right) => left.localeCompare(right))
    }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId));
    const foreignActors = activeActors.filter((actor) => !currentActor || actor.actorId !== currentActor);
    const foreignSessions = activeClaims.filter((claim) => claim.sessionId
        && currentActor
        && claim.actorId === currentActor
        && (!currentSessionId || claim.sessionId !== currentSessionId));
    const foreignActorIds = uniqueSorted([
        ...foreignActors.map((actor) => actor.actorId),
        ...foreignSessions.map((claim) => claim.actorId)
    ]);
    const foreignSessionIds = uniqueSorted(foreignSessions.map((claim) => claim.sessionId).filter((entry) => Boolean(entry)));
    const foreignDirtyFiles = readForeignDirtyFiles(cwd, {
        activeClaims,
        activeLocks,
        freshReservations,
        foreignActorIds,
        foreignSessionIds
    });
    const hasForeignActiveWork = foreignActors.length > 0 || foreignSessionIds.length > 0 || stagedFiles.length > 0;
    const teamLevelRecommendation = buildTeamLevelRecommendation({
        ownFiles: normalizedOwnFiles,
        activeClaims,
        activeLocks,
        freshReservations,
        stagedFiles,
        foreignDirtyFiles,
        foreignActorIds,
        foreignSessionIds
    });
    const reasonParts = [
        ...(foreignActors.length > 0 ? [`${foreignActors.length} other active actor(s): ${foreignActors.map((entry) => entry.actorId).join(', ')}`] : []),
        ...(foreignSessionIds.length > 0 ? [`${foreignSessionIds.length} other active session(s) for current actor: ${foreignSessionIds.join(', ')}`] : []),
        ...(freshReservations.length > 0 ? [`${freshReservations.length} fresh task reservation(s) visible`] : []),
        ...(foreignDirtyFiles.length > 0 ? [`${foreignDirtyFiles.length} foreign dirty WIP file(s) overlap active task ownership`] : []),
        ...(stagedFiles.length > 0 ? [`${stagedFiles.length} staged file(s) present in the shared index`] : [])
    ];
    return {
        schemaId: 'atm.activeWorkSummary.v1',
        generatedAt: new Date(now).toISOString(),
        activeClaimCount: activeClaims.length,
        activeActors,
        activeClaims,
        activeLocks,
        freshReservationCount: freshReservations.length,
        freshReservations,
        stagedFiles,
        foreignDirtyFiles,
        hasForeignActiveWork,
        teamLevelRecommendation,
        brokerRecommendation: {
            enabled: hasForeignActiveWork,
            reason: reasonParts.length > 0 ? reasonParts.join('; ') : null,
            statusCommand: 'node atm.mjs tasks status --json',
            brokerStatusCommand: 'node atm.mjs broker status --json',
            teamStatusCommand: 'node atm.mjs team status --compact --json'
        }
    };
}
function buildTeamLevelRecommendation(input) {
    const ownSet = new Set(input.ownFiles);
    const foreignFiles = uniqueSorted([
        ...input.activeClaims.filter((claim) => input.foreignActorIds.includes(claim.actorId) || (claim.sessionId && input.foreignSessionIds.includes(claim.sessionId))).flatMap((claim) => claim.files),
        ...input.activeLocks.filter((lock) => input.foreignActorIds.includes(lock.actorId)).flatMap((lock) => lock.files),
        ...input.freshReservations.filter((reservation) => input.foreignActorIds.includes(reservation.actorId)).flatMap((reservation) => reservation.files)
    ]);
    const overlappingFiles = input.ownFiles.length > 0
        ? foreignFiles.filter((file) => ownSet.has(file))
        : [];
    const stagedOverlap = input.ownFiles.length > 0
        ? input.stagedFiles.filter((file) => ownSet.has(file))
        : [];
    const foreignDirtyOverlap = input.ownFiles.length > 0
        ? input.foreignDirtyFiles.filter((file) => ownSet.has(file))
        : [];
    const foreignActorCount = new Set(input.foreignActorIds).size;
    const foreignSessionCount = new Set(input.foreignSessionIds).size;
    const freshForeignReservationCount = input.freshReservations.filter((reservation) => input.foreignActorIds.includes(reservation.actorId)).length;
    const sharedIndexActive = input.stagedFiles.length > 0;
    const foreignDirtyActive = input.foreignDirtyFiles.length > 0;
    const overlapCount = uniqueSorted([...overlappingFiles, ...stagedOverlap, ...foreignDirtyOverlap]).length;
    const foreignWorkCount = foreignActorCount + foreignSessionCount;
    const allOverlaps = uniqueSorted([...overlappingFiles, ...stagedOverlap, ...foreignDirtyOverlap]);
    const frameworkFoundationRisk = input.ownFiles.some(isFrameworkFoundationPath);
    if (frameworkFoundationRisk && (foreignWorkCount > 0 || sharedIndexActive || foreignDirtyActive || overlapCount > 0)) {
        return {
            level: 'L5',
            reason: 'Framework foundation files are in scope while other active work, dirty WIP, or shared-index state exists; use the full Team Agent Broker lane.',
            ownFiles: input.ownFiles,
            overlappingFiles: allOverlaps,
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (frameworkFoundationRisk) {
        return {
            level: 'L4',
            reason: 'Framework foundation files are in scope; use elevated coordination even without visible overlap.',
            ownFiles: input.ownFiles,
            overlappingFiles: allOverlaps,
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (foreignWorkCount >= 3 || (overlapCount > 0 && sharedIndexActive && foreignWorkCount >= 2)) {
        return {
            level: 'L5',
            reason: 'Multiple active actors plus overlapping files or shared staged index require full Broker coordination with review and validation roles.',
            ownFiles: input.ownFiles,
            overlappingFiles: allOverlaps,
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (overlapCount > 1 || (overlapCount > 0 && sharedIndexActive)) {
        return {
            level: 'L4',
            reason: 'Active foreign work overlaps this scope across multiple files or the shared index, so add a coordinator plus review/validation coverage.',
            ownFiles: input.ownFiles,
            overlappingFiles: allOverlaps,
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (overlapCount === 1 || sharedIndexActive) {
        return {
            level: 'L3',
            reason: 'A concrete same-file or shared-index risk is present; use Broker arbitration with an implementer and validator lane.',
            ownFiles: input.ownFiles,
            overlappingFiles: allOverlaps,
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (foreignDirtyActive) {
        return {
            level: 'L3',
            reason: 'Foreign active-task dirty WIP is present in the shared worktree; use Broker arbitration before committing or closing.',
            ownFiles: input.ownFiles,
            overlappingFiles: allOverlaps,
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (freshForeignReservationCount > 0) {
        return {
            level: 'L3',
            reason: 'Fresh foreign-created task reservations are visible; use Broker arbitration before claiming another captain\'s newly opened work.',
            ownFiles: input.ownFiles,
            overlappingFiles: [],
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    if (foreignWorkCount > 0) {
        return {
            level: 'L2',
            reason: 'Other active actors exist but no file overlap is visible for this scope; keep coordination light and monitor Broker status.',
            ownFiles: input.ownFiles,
            overlappingFiles: [],
            foreignActors: uniqueSorted(input.foreignActorIds),
            foreignSessions: uniqueSorted(input.foreignSessionIds)
        };
    }
    return {
        level: 'L1',
        reason: 'No foreign active work or shared-index risk is visible; a single coordinator/implementer path is enough.',
        ownFiles: input.ownFiles,
        overlappingFiles: [],
        foreignActors: [],
        foreignSessions: []
    };
}
function readForeignDirtyFiles(cwd, input) {
    const dirtyFiles = new Set(readDirtyWorktreeFiles(cwd));
    if (dirtyFiles.size === 0)
        return [];
    const foreignOwnedFiles = uniqueSorted([
        ...input.activeClaims
            .filter((claim) => input.foreignActorIds.includes(claim.actorId) || (claim.sessionId && input.foreignSessionIds.includes(claim.sessionId)))
            .flatMap((claim) => claim.files),
        ...input.activeLocks
            .filter((lock) => input.foreignActorIds.includes(lock.actorId))
            .flatMap((lock) => lock.files),
        ...input.freshReservations
            .filter((reservation) => input.foreignActorIds.includes(reservation.actorId))
            .flatMap((reservation) => reservation.files)
    ]);
    return foreignOwnedFiles.filter((file) => dirtyFiles.has(normalizeWorkPath(file)));
}
function readDirtyWorktreeFiles(cwd) {
    const diff = spawnSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf8' });
    const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
    return uniqueSorted([
        ...(diff.status === 0 ? diff.stdout.split(/\r?\n/) : []),
        ...(untracked.status === 0 ? untracked.stdout.split(/\r?\n/) : [])
    ].map(normalizeWorkPath).filter(Boolean));
}
function isFrameworkFoundationPath(filePath) {
    const normalized = normalizeWorkPath(filePath);
    return normalized.startsWith('packages/core/')
        || /^packages\/cli\/src\/commands\/(?:next(?:\.ts|\/)|broker\.ts|team\.ts|taskflow\.ts|git-governance\.ts|integration-hooks\.ts|hook\/pre-commit\.ts|tasks\/(?:claim-intent|close-window-lock|import-orchestrator|legacy-impl|task-option-parsers)\.ts)/.test(normalized)
        || normalized.startsWith('packages/cli/src/commands/next/')
        || normalized.startsWith('packages/cli/src/commands/taskflow/')
        || normalized.startsWith('packages/cli/src/commands/framework-development/')
        || normalized.startsWith('packages/integrations-core/src/compiler/')
        || normalized.startsWith('packages/core/src/broker/')
        || normalized.startsWith('packages/core/src/team-runtime/');
}
export function inspectFreshTaskReservationForTask(cwd, task, currentActorId, now, currentLaneSessionId = null) {
    const reservations = readFreshTaskReservations(cwd, now);
    const currentActor = currentActorId?.trim() || null;
    const currentLane = normalizeOptionalString(currentLaneSessionId);
    return reservations.find((reservation) => {
        if (reservation.taskId !== task.workItemId)
            return false;
        if (!currentActor || reservation.actorId !== currentActor)
            return true;
        if (!currentLane || !reservation.laneSessionId)
            return false;
        return reservation.laneSessionId !== currentLane;
    }) ?? null;
}
function readFreshTaskReservations(cwd, now) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId)
                return [];
            if (!isTaskFreshReservationCandidate(parsed))
                return [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            if (claimRecord.state === 'active')
                return [];
            const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
                ? parsed.source
                : {};
            const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
            const sourceOwner = readPlanningCardOwner(cwd, sourcePlanPath);
            const actorId = sourceOwner
                ?? normalizeOptionalString(parsed.owner ?? parsed.ownerActorId ?? parsed.createdByActor ?? parsed.createdBy ?? parsed.importedByActor ?? parsed.importedBy ?? source.owner ?? source.actorId);
            if (!actorId)
                return [];
            const laneSessionId = readLaneSessionIdFromTaskDocument(parsed);
            const createdAt = normalizeOptionalString(parsed.createdAt ?? parsed.created_at ?? source.createdAt ?? source.created_at);
            const importedAt = normalizeOptionalString(parsed.importedAt ?? parsed.imported_at ?? source.importedAt ?? source.imported_at);
            const referenceAt = parseIsoMillis(importedAt) ?? parseIsoMillis(createdAt) ?? parseIsoMillis(normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at));
            if (referenceAt === null)
                return [];
            const ageSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
            if (ageSeconds > NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS)
                return [];
            const files = uniqueSorted([
                ...readStringArray(parsed.scope),
                ...readStringArray(parsed.scopePaths),
                ...readStringArray(parsed.files),
                ...readStringArray(parsed.deliverables),
                ...readStringArray(parsed.targetAllowedFiles),
                ...readStringArray(claimRecord.files)
            ].map((file) => {
                const normalized = normalizeWorkPath(file);
                return path.isAbsolute(normalized) ? path.relative(cwd, normalized).replace(/\\/g, '/') : normalized;
            }).filter(Boolean));
            return [{
                    taskId: workItemId,
                    title: normalizeOptionalString(parsed.title) ?? workItemId,
                    actorId,
                    laneSessionId,
                    createdAt,
                    importedAt,
                    ageSeconds,
                    ttlSeconds: NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS,
                    leaseFresh: true,
                    files
                }];
        }
        catch {
            return [];
        }
    });
}
function readLaneSessionIdFromTaskDocument(parsed) {
    const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
        ? parsed.source
        : {};
    const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
        ? parsed.claim
        : {};
    const directionLock = parsed.taskDirectionLock && typeof parsed.taskDirectionLock === 'object' && !Array.isArray(parsed.taskDirectionLock)
        ? parsed.taskDirectionLock
        : {};
    return normalizeOptionalString(parsed.laneSessionId ?? parsed.laneId ?? source.laneSessionId ?? source.laneId)
        ?? readLaneSessionIdFromEnvelope(parsed.laneSession)
        ?? readLaneSessionIdFromEnvelope(source.laneSession)
        ?? readLaneSessionIdFromEnvelope(claimRecord.laneSession)
        ?? readLaneSessionIdFromEnvelope(directionLock.laneSession)
        ?? normalizeOptionalString(directionLock.laneSessionId ?? directionLock.guidanceSessionId);
}
function readLaneSessionIdFromEnvelope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return normalizeOptionalString(value.laneSessionId);
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
        const owner = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
            ? normalizeOptionalString(frontmatter.owner ?? frontmatter.actor ?? frontmatter.captain)
            : null;
        return owner ?? readFrontmatterScalar(rawText, 'owner') ?? readFrontmatterScalar(rawText, 'actor') ?? readFrontmatterScalar(rawText, 'captain');
    }
    catch {
        return null;
    }
}
function readFrontmatterScalar(rawText, key) {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(rawText);
    if (!match)
        return null;
    const line = match[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
    if (!line)
        return null;
    return normalizeOptionalString(line.slice(line.indexOf(':') + 1).replace(/^['"]|['"]$/g, ''));
}
function parseIsoMillis(value) {
    if (!value)
        return null;
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
}
function readActiveClaimRecords(cwd, now) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    const sessionsByLeaseId = new Map();
    for (const session of listActorWorkSessions(cwd)) {
        if (session.claimLeaseId)
            sessionsByLeaseId.set(session.claimLeaseId, session);
    }
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId)
                return [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            if (claimRecord.state !== 'active')
                return [];
            const actorId = normalizeOptionalString(claimRecord.actorId);
            if (!actorId)
                return [];
            const heartbeatAt = normalizeOptionalString(claimRecord.heartbeatAt);
            const ttlSeconds = normalizeOptionalNumber(claimRecord.ttlSeconds);
            const leaseId = normalizeOptionalString(claimRecord.leaseId);
            const session = leaseId ? sessionsByLeaseId.get(leaseId) ?? null : null;
            return [{
                    taskId: workItemId,
                    title: normalizeOptionalString(parsed.title) ?? workItemId,
                    actorId,
                    leaseId,
                    sessionId: session?.sessionId ?? normalizeOptionalString(parsed.startedBySessionId) ?? null,
                    editor: session?.editor ?? null,
                    gitName: session?.gitName ?? null,
                    intent: normalizeOptionalString(claimRecord.intent) ?? 'write',
                    claimedAt: normalizeOptionalString(claimRecord.claimedAt),
                    heartbeatAt,
                    heartbeatAgeSeconds: heartbeatAt ? Math.max(0, Math.floor((now - Date.parse(heartbeatAt)) / 1000)) : null,
                    ttlSeconds,
                    leaseFresh: heartbeatAt && ttlSeconds !== null ? now - Date.parse(heartbeatAt) <= ttlSeconds * 1000 : null,
                    files: uniqueSorted(readStringArray(claimRecord.files).map(normalizeWorkPath))
                }];
        }
        catch {
            return [];
        }
    });
}
function readActiveLockRecords(cwd, now) {
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (!existsSync(lockRoot))
        return [];
    return readdirSync(lockRoot)
        .filter((entry) => entry.endsWith('.lock.json'))
        .flatMap((entry) => {
        try {
            const parsed = parseJsonText(readFileSync(path.join(lockRoot, entry), 'utf8'));
            if (normalizeOptionalString(parsed.status) === 'released')
                return [];
            const workItemId = normalizeOptionalString(parsed.workItemId);
            const actorId = normalizeOptionalString(parsed.actorId ?? parsed.lockedBy);
            if (!workItemId || !actorId)
                return [];
            const heartbeatAt = normalizeOptionalString(parsed.heartbeatAt ?? parsed.lockedAt);
            const ttlSeconds = normalizeOptionalNumber(parsed.ttlSeconds);
            return [{
                    workItemId,
                    actorId,
                    heartbeatAt,
                    heartbeatAgeSeconds: heartbeatAt ? Math.max(0, Math.floor((now - Date.parse(heartbeatAt)) / 1000)) : null,
                    ttlSeconds,
                    leaseFresh: heartbeatAt && ttlSeconds !== null ? now - Date.parse(heartbeatAt) <= ttlSeconds * 1000 : null,
                    files: uniqueSorted(readStringArray(parsed.files).map(normalizeWorkPath))
                }];
        }
        catch {
            return [];
        }
    });
}
function normalizeOptionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function normalizeWorkPath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function readStagedFiles(cwd) {
    const result = spawnSync('git', ['diff', '--name-only', '--cached'], {
        cwd,
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.status !== 0)
        return [];
    return uniqueSorted(String(result.stdout ?? '')
        .split(/\r?\n/)
        .map(normalizeWorkPath)
        .filter(Boolean));
}
export function mentionsNotCurrentTask(prompt) {
    const normalized = normalizeSearchText(prompt);
    return /\bnot\s+(?:the\s+)?current\s+task\b|\bnot\s+(?:this\s+)?active\s+task\b/.test(normalized)
        || /不是(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/.test(prompt)
        || /不要(?:接|掛|綁|套|附著|attach)(?:到|在)?(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/i.test(prompt);
}

// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listActorWorkSessions, resolveActorWorkSession } from '../../actor-session.ts';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, normalizeSearchText, readStringArray } from '../intent-normalizers.ts';
import { uniqueSorted } from '../view-projections.ts';
import { parseJsonText } from '../../shared.ts';
import { normalizeOptionalString } from '../route-resolution.ts';

const NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;

export interface ActiveWorkSummary {
  readonly schemaId: 'atm.activeWorkSummary.v1';
  readonly generatedAt: string;
  readonly activeClaimCount: number;
  readonly activeActors: readonly {
    readonly actorId: string;
    readonly taskIds: readonly string[];
    readonly fileCount: number;
    readonly sessionIds: readonly string[];
    readonly sessionCount: number;
    readonly editors: readonly string[];
  }[];
  readonly activeClaims: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly actorId: string;
    readonly leaseId: string | null;
    readonly sessionId: string | null;
    readonly editor: string | null;
    readonly gitName: string | null;
    readonly intent: string;
    readonly claimedAt: string | null;
    readonly heartbeatAt: string | null;
    readonly heartbeatAgeSeconds: number | null;
    readonly ttlSeconds: number | null;
    readonly leaseFresh: boolean | null;
    readonly files: readonly string[];
  }[];
  readonly activeLocks: readonly {
    readonly workItemId: string;
    readonly actorId: string;
    readonly heartbeatAt: string | null;
    readonly heartbeatAgeSeconds: number | null;
    readonly ttlSeconds: number | null;
    readonly leaseFresh: boolean | null;
    readonly files: readonly string[];
  }[];
  readonly freshReservationCount: number;
  readonly freshReservations: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly actorId: string;
    readonly createdAt: string | null;
    readonly importedAt: string | null;
    readonly ageSeconds: number;
    readonly ttlSeconds: number;
    readonly leaseFresh: boolean;
    readonly files: readonly string[];
  }[];
  readonly stagedFiles: readonly string[];
  readonly hasForeignActiveWork: boolean;
  readonly teamLevelRecommendation: {
    readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    readonly reason: string;
    readonly ownFiles: readonly string[];
    readonly overlappingFiles: readonly string[];
    readonly foreignActors: readonly string[];
    readonly foreignSessions: readonly string[];
  };
  readonly brokerRecommendation: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly statusCommand: string;
    readonly brokerStatusCommand: string;
    readonly teamStatusCommand: string;
  };
}

export function buildActiveWorkSummary(cwd: string, currentActorId?: string | null, ownFiles: readonly string[] = []): ActiveWorkSummary {
  const now = Date.now();
  const currentActor = currentActorId?.trim() || null;
  const normalizedOwnFiles = uniqueSorted(ownFiles.map(normalizeWorkPath).filter(Boolean));
  const activeClaims = readActiveClaimRecords(cwd, now);
  const activeLocks = readActiveLockRecords(cwd, now);
  const freshReservations = readFreshTaskReservations(cwd, now);
  const stagedFiles = readStagedFiles(cwd);
  const currentSession = resolveActorWorkSession(cwd, {});
  const currentSessionId = currentSession?.sessionId ?? null;
  const actorMap = new Map<string, { taskIds: Set<string>; files: Set<string>; sessionIds: Set<string>; editors: Set<string> }>();
  for (const claim of activeClaims) {
    const bucket = actorMap.get(claim.actorId) ?? { taskIds: new Set<string>(), files: new Set<string>(), sessionIds: new Set<string>(), editors: new Set<string>() };
    bucket.taskIds.add(claim.taskId);
    for (const file of claim.files) bucket.files.add(file);
    if (claim.sessionId) bucket.sessionIds.add(claim.sessionId);
    if (claim.editor) bucket.editors.add(claim.editor);
    actorMap.set(claim.actorId, bucket);
  }
  for (const lock of activeLocks) {
    const bucket = actorMap.get(lock.actorId) ?? { taskIds: new Set<string>(), files: new Set<string>(), sessionIds: new Set<string>(), editors: new Set<string>() };
    bucket.taskIds.add(lock.workItemId);
    for (const file of lock.files) bucket.files.add(file);
    actorMap.set(lock.actorId, bucket);
  }
  for (const reservation of freshReservations) {
    const bucket = actorMap.get(reservation.actorId) ?? { taskIds: new Set<string>(), files: new Set<string>(), sessionIds: new Set<string>(), editors: new Set<string>() };
    bucket.taskIds.add(reservation.taskId);
    for (const file of reservation.files) bucket.files.add(file);
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
  const foreignSessions = activeClaims.filter((claim) =>
    claim.sessionId
    && currentActor
    && claim.actorId === currentActor
    && (!currentSessionId || claim.sessionId !== currentSessionId)
  );
  const foreignActorIds = uniqueSorted([
    ...foreignActors.map((actor) => actor.actorId),
    ...foreignSessions.map((claim) => claim.actorId)
  ]);
  const foreignSessionIds = uniqueSorted(foreignSessions.map((claim) => claim.sessionId).filter((entry): entry is string => Boolean(entry)));
  const hasForeignActiveWork = foreignActors.length > 0 || foreignSessionIds.length > 0 || stagedFiles.length > 0;
  const teamLevelRecommendation = buildTeamLevelRecommendation({
    ownFiles: normalizedOwnFiles,
    activeClaims,
    activeLocks,
    freshReservations,
    stagedFiles,
    foreignActorIds,
    foreignSessionIds
  });
  const reasonParts = [
    ...(foreignActors.length > 0 ? [`${foreignActors.length} other active actor(s): ${foreignActors.map((entry) => entry.actorId).join(', ')}`] : []),
    ...(foreignSessionIds.length > 0 ? [`${foreignSessionIds.length} other active session(s) for current actor: ${foreignSessionIds.join(', ')}`] : []),
    ...(freshReservations.length > 0 ? [`${freshReservations.length} fresh task reservation(s) visible`] : []),
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

function buildTeamLevelRecommendation(input: {
  readonly ownFiles: readonly string[];
  readonly activeClaims: ActiveWorkSummary['activeClaims'];
  readonly activeLocks: ActiveWorkSummary['activeLocks'];
  readonly freshReservations: ActiveWorkSummary['freshReservations'];
  readonly stagedFiles: readonly string[];
  readonly foreignActorIds: readonly string[];
  readonly foreignSessionIds: readonly string[];
}): ActiveWorkSummary['teamLevelRecommendation'] {
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
  const foreignActorCount = new Set(input.foreignActorIds).size;
  const foreignSessionCount = new Set(input.foreignSessionIds).size;
  const freshForeignReservationCount = input.freshReservations.filter((reservation) => input.foreignActorIds.includes(reservation.actorId)).length;
  const sharedIndexActive = input.stagedFiles.length > 0;
  const overlapCount = uniqueSorted([...overlappingFiles, ...stagedOverlap]).length;
  const foreignWorkCount = foreignActorCount + foreignSessionCount;
  const frameworkFoundationRisk = input.ownFiles.some(isFrameworkFoundationPath);
  if (frameworkFoundationRisk && (foreignWorkCount > 0 || sharedIndexActive || overlapCount > 0)) {
    return {
      level: 'L5',
      reason: 'Framework foundation files are in scope while other active work or shared-index state exists; use the full Team Agent Broker lane.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (frameworkFoundationRisk) {
    return {
      level: 'L4',
      reason: 'Framework foundation files are in scope; use elevated coordination even without visible overlap.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (foreignWorkCount >= 3 || (overlapCount > 0 && sharedIndexActive && foreignWorkCount >= 2)) {
    return {
      level: 'L5',
      reason: 'Multiple active actors plus overlapping files or shared staged index require full Broker coordination with review and validation roles.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (overlapCount > 1 || (overlapCount > 0 && sharedIndexActive)) {
    return {
      level: 'L4',
      reason: 'Active foreign work overlaps this scope across multiple files or the shared index, so add a coordinator plus review/validation coverage.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (overlapCount === 1 || sharedIndexActive) {
    return {
      level: 'L3',
      reason: 'A concrete same-file or shared-index risk is present; use Broker arbitration with an implementer and validator lane.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
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

function isFrameworkFoundationPath(filePath: string): boolean {
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

export function inspectFreshTaskReservationForTask(
  cwd: string,
  task: ImportedTaskSummary,
  currentActorId: string | null | undefined,
  now: number
): ActiveWorkSummary['freshReservations'][number] | null {
  const reservations = readFreshTaskReservations(cwd, now);
  const currentActor = currentActorId?.trim() || null;
  return reservations.find((reservation) =>
    reservation.taskId === task.workItemId
    && (!currentActor || reservation.actorId !== currentActor)
  ) ?? null;
}

function readFreshTaskReservations(cwd: string, now: number): ActiveWorkSummary['freshReservations'] {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) return [];
  return readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ActiveWorkSummary['freshReservations'] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = parseJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
        if (!workItemId) return [];
        if (!isTaskFreshReservationCandidate(parsed)) return [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        if (claimRecord.state === 'active') return [];
        const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
          ? parsed.source as Record<string, unknown>
          : {};
        const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
        const sourceOwner = readPlanningCardOwner(cwd, sourcePlanPath);
        const actorId = sourceOwner
          ?? normalizeOptionalString(parsed.owner ?? parsed.ownerActorId ?? parsed.createdByActor ?? parsed.createdBy ?? parsed.importedByActor ?? parsed.importedBy ?? source.owner ?? source.actorId);
        if (!actorId) return [];
        const createdAt = normalizeOptionalString(parsed.createdAt ?? parsed.created_at ?? source.createdAt ?? source.created_at);
        const importedAt = normalizeOptionalString(parsed.importedAt ?? parsed.imported_at ?? source.importedAt ?? source.imported_at);
        const referenceAt = parseIsoMillis(importedAt) ?? parseIsoMillis(createdAt) ?? parseIsoMillis(normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at));
        if (referenceAt === null) return [];
        const ageSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
        if (ageSeconds > NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS) return [];
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
          createdAt,
          importedAt,
          ageSeconds,
          ttlSeconds: NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS,
          leaseFresh: true,
          files
        }];
      } catch {
        return [];
      }
    });
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
    const owner = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
      ? normalizeOptionalString((frontmatter as Record<string, unknown>).owner ?? (frontmatter as Record<string, unknown>).actor ?? (frontmatter as Record<string, unknown>).captain)
      : null;
    return owner ?? readFrontmatterScalar(rawText, 'owner') ?? readFrontmatterScalar(rawText, 'actor') ?? readFrontmatterScalar(rawText, 'captain');
  } catch {
    return null;
  }
}

function readFrontmatterScalar(rawText: string, key: string): string | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(rawText);
  if (!match) return null;
  const line = match[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
  if (!line) return null;
  return normalizeOptionalString(line.slice(line.indexOf(':') + 1).replace(/^['"]|['"]$/g, ''));
}

function parseIsoMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function readActiveClaimRecords(cwd: string, now: number): ActiveWorkSummary['activeClaims'] {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) return [];
  const sessionsByLeaseId = new Map<string, ReturnType<typeof listActorWorkSessions>[number]>();
  for (const session of listActorWorkSessions(cwd)) {
    if (session.claimLeaseId) sessionsByLeaseId.set(session.claimLeaseId, session);
  }
  return readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ActiveWorkSummary['activeClaims'] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = parseJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
        if (!workItemId) return [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        if (claimRecord.state !== 'active') return [];
        const actorId = normalizeOptionalString(claimRecord.actorId);
        if (!actorId) return [];
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
      } catch {
        return [];
      }
    });
}

function readActiveLockRecords(cwd: string, now: number): ActiveWorkSummary['activeLocks'] {
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (!existsSync(lockRoot)) return [];
  return readdirSync(lockRoot)
    .filter((entry) => entry.endsWith('.lock.json'))
    .flatMap((entry): ActiveWorkSummary['activeLocks'] => {
      try {
        const parsed = parseJsonText(readFileSync(path.join(lockRoot, entry), 'utf8')) as Record<string, unknown>;
        if (normalizeOptionalString(parsed.status) === 'released') return [];
        const workItemId = normalizeOptionalString(parsed.workItemId);
        const actorId = normalizeOptionalString(parsed.actorId ?? parsed.lockedBy);
        if (!workItemId || !actorId) return [];
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
      } catch {
        return [];
      }
    });
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeWorkPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function readStagedFiles(cwd: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', '--cached'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return [];
  return uniqueSorted(String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(normalizeWorkPath)
    .filter(Boolean));
}

function mentionsNotCurrentTask(prompt: string) {
  const normalized = normalizeSearchText(prompt);
  return /\bnot\s+(?:the\s+)?current\s+task\b|\bnot\s+(?:this\s+)?active\s+task\b/.test(normalized)
    || /不是(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/.test(prompt)
    || /不要(?:接|掛|綁|套|附著|attach)(?:到|在)?(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/i.test(prompt);
}

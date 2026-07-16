import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRuntimeIdentityForActor } from '../actor-registry.ts';
import { relativePathFrom } from '../shared.ts';

export const runtimeLaneSessionsRootRelativePath = '.atm/runtime/lane-sessions' as const;

export type LaneSessionStatus = 'active' | 'handoff' | 'adopted' | 'released' | 'expired';
export type LaneSessionTtlPhase = 'fresh' | 'grace' | 'expired';

export interface LaneSessionIdentitySnapshot {
  readonly actorId: string;
  readonly editor: string | null;
  readonly gitName: string | null;
  readonly gitEmail: string | null;
  readonly provider: string | null;
  readonly activeSessionId: string | null;
}

export interface LaneSessionAdoptionSource {
  readonly kind: 'mint' | 'adoption' | 'handoff' | 'import';
  readonly sourceLaneId: string | null;
  readonly sourceActorId: string | null;
  readonly reason: string | null;
}

export interface LaneSessionLastCommand {
  readonly command: string;
  readonly executedAt: string;
  readonly exitCode: number | null;
}

export interface LaneSessionDocument {
  readonly schemaId: 'atm.laneSession.v1';
  readonly specVersion: '0.1.0';
  readonly laneId: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly status: LaneSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
  readonly identity: LaneSessionIdentitySnapshot;
  readonly adoptionSource: LaneSessionAdoptionSource;
  readonly handoffTokenHash: string | null;
  readonly lastCommand: LaneSessionLastCommand | null;
  readonly lastHeartbeatAt: string | null;
}

export interface MintLaneSessionInput {
  readonly cwd: string;
  readonly actorId: string;
  readonly taskId?: string | null;
  readonly laneId?: string | null;
  readonly ttlMs: number;
  readonly status?: LaneSessionStatus;
  readonly timestamp?: string;
  readonly adoptionSource?: Partial<LaneSessionAdoptionSource> | null;
  readonly handoffToken?: string | null;
  readonly lastCommand?: LaneSessionLastCommand | null;
}

export interface AdoptLaneSessionInput {
  readonly cwd: string;
  readonly laneId: string;
  readonly actorId: string;
  readonly reason?: string | null;
  readonly timestamp?: string;
  readonly lastCommand?: LaneSessionLastCommand | null;
}

export interface RecordLaneSessionHeartbeatInput {
  readonly cwd: string;
  readonly laneId: string;
  readonly actorId?: string | null;
  readonly timestamp?: string;
  readonly lastCommand?: LaneSessionLastCommand | null;
}

export type LaneSessionHeartbeatFailureReason = 'not-found' | 'closed' | 'expired';

export type LaneSessionHeartbeatResult = {
  readonly ok: true;
  readonly session: LaneSessionDocument;
  readonly previousSession: LaneSessionDocument;
  readonly sessionPath: string;
  readonly ttlPhaseBefore: LaneSessionTtlPhase;
} | {
  readonly ok: false;
  readonly reason: LaneSessionHeartbeatFailureReason;
  readonly session: LaneSessionDocument | null;
  readonly ttlPhaseBefore: LaneSessionTtlPhase | null;
};

export interface LaneSessionSweepInput {
  readonly cwd: string;
  readonly now?: string;
  readonly graceMs?: number;
  readonly write?: boolean;
  readonly actorId?: string | null;
  readonly lastCommand?: LaneSessionLastCommand | null;
}

export interface LaneSessionSweepEntry {
  readonly laneId: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly status: LaneSessionStatus;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly ttlPhase: LaneSessionTtlPhase;
  readonly sweepable: boolean;
  readonly reason: string;
}

export interface LaneSessionSweepResult {
  readonly generatedAt: string;
  readonly graceMs: number;
  readonly write: boolean;
  readonly entries: readonly LaneSessionSweepEntry[];
  readonly staleCount: number;
  readonly sweptCount: number;
  readonly sweptSessions: readonly LaneSessionDocument[];
}

export type LaneSessionAdoptionFailureReason = 'not-found' | 'closed';

export type LaneSessionAdoptionResult = {
  readonly ok: true;
  readonly session: LaneSessionDocument;
  readonly previousSession: LaneSessionDocument;
  readonly sessionPath: string;
} | {
  readonly ok: false;
  readonly reason: LaneSessionAdoptionFailureReason;
  readonly session: LaneSessionDocument | null;
};

export function mintLaneSession(input: MintLaneSessionInput): {
  readonly session: LaneSessionDocument;
  readonly sessionPath: string;
} {
  const cwd = path.resolve(input.cwd);
  const nowIso = normalizeIsoString(input.timestamp) ?? new Date().toISOString();
  const laneId = normalizeOptionalString(input.laneId) ?? createLaneSessionId(cwd, input.actorId, input.taskId ?? null, nowIso);
  const ttlMs = normalizePositiveInteger(input.ttlMs, 0);
  const session: LaneSessionDocument = {
    schemaId: 'atm.laneSession.v1',
    specVersion: '0.1.0',
    laneId,
    actorId: input.actorId,
    taskId: normalizeOptionalString(input.taskId) ?? null,
    status: input.status ?? 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
    ttlMs,
    identity: snapshotLaneIdentity(cwd, input.actorId),
    adoptionSource: normalizeAdoptionSource(input.adoptionSource),
    handoffTokenHash: input.handoffToken ? hashHandoffToken(input.handoffToken) : null,
    lastCommand: normalizeLastCommand(input.lastCommand),
    lastHeartbeatAt: nowIso
  };
  const absolutePath = laneSessionPathFor(cwd, laneId);
  atomicWriteJson(absolutePath, session);
  return {
    session,
    sessionPath: relativePathFrom(cwd, absolutePath)
  };
}

export function adoptLaneSession(input: AdoptLaneSessionInput): LaneSessionAdoptionResult {
  const cwd = path.resolve(input.cwd);
  const previousSession = readLaneSession(cwd, input.laneId);
  if (!previousSession) {
    return { ok: false, reason: 'not-found', session: null };
  }
  if (!isLaneSessionAdoptable(previousSession)) {
    return { ok: false, reason: 'closed', session: previousSession };
  }
  const nowIso = normalizeIsoString(input.timestamp) ?? new Date().toISOString();
  const ttlMs = normalizePositiveInteger(previousSession.ttlMs, 0);
  const session: LaneSessionDocument = {
    ...previousSession,
    actorId: input.actorId,
    status: 'adopted',
    updatedAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
    identity: snapshotLaneIdentity(cwd, input.actorId),
    adoptionSource: {
      kind: 'adoption',
      sourceLaneId: previousSession.laneId,
      sourceActorId: previousSession.actorId,
      reason: normalizeOptionalString(input.reason) ?? null
    },
    lastCommand: normalizeLastCommand(input.lastCommand),
    lastHeartbeatAt: nowIso
  };
  const absolutePath = laneSessionPathFor(cwd, previousSession.laneId);
  atomicWriteJson(absolutePath, session);
  return {
    ok: true,
    session,
    previousSession,
    sessionPath: relativePathFrom(cwd, absolutePath)
  };
}

export function recordLaneSessionHeartbeat(input: RecordLaneSessionHeartbeatInput): LaneSessionHeartbeatResult {
  const cwd = path.resolve(input.cwd);
  const previousSession = readLaneSession(cwd, input.laneId);
  if (!previousSession) {
    return { ok: false, reason: 'not-found', session: null, ttlPhaseBefore: null };
  }
  const nowIso = normalizeIsoString(input.timestamp) ?? new Date().toISOString();
  const ttlPhaseBefore = classifyLaneSessionTtl({ now: nowIso, expiresAt: previousSession.expiresAt });
  if (previousSession.status === 'released' || previousSession.status === 'expired') {
    return { ok: false, reason: 'closed', session: previousSession, ttlPhaseBefore };
  }
  if (ttlPhaseBefore === 'expired') {
    return { ok: false, reason: 'expired', session: previousSession, ttlPhaseBefore };
  }
  const ttlMs = normalizePositiveInteger(previousSession.ttlMs, 0);
  const session: LaneSessionDocument = {
    ...previousSession,
    actorId: normalizeOptionalString(input.actorId) ?? previousSession.actorId,
    updatedAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
    identity: snapshotLaneIdentity(cwd, normalizeOptionalString(input.actorId) ?? previousSession.actorId),
    lastCommand: normalizeLastCommand(input.lastCommand) ?? previousSession.lastCommand,
    lastHeartbeatAt: nowIso
  };
  const absolutePath = laneSessionPathFor(cwd, previousSession.laneId);
  atomicWriteJson(absolutePath, session);
  return {
    ok: true,
    session,
    previousSession,
    sessionPath: relativePathFrom(cwd, absolutePath),
    ttlPhaseBefore
  };
}

export function inspectLaneSessionSweep(input: LaneSessionSweepInput): LaneSessionSweepResult {
  return sweepLaneSessions({ ...input, write: false });
}

export function sweepLaneSessions(input: LaneSessionSweepInput): LaneSessionSweepResult {
  const cwd = path.resolve(input.cwd);
  const generatedAt = normalizeIsoString(input.now) ?? new Date().toISOString();
  const graceMs = normalizePositiveInteger(input.graceMs ?? 0, 0);
  const entries: LaneSessionSweepEntry[] = [];
  const sweptSessions: LaneSessionDocument[] = [];
  for (const session of listLaneSessions(cwd)) {
    const ttlPhase = classifyLaneSessionTtl({ now: generatedAt, expiresAt: session.expiresAt, graceMs });
    const sweepable = ttlPhase === 'expired' && session.status !== 'released' && session.status !== 'expired';
    entries.push({
      laneId: session.laneId,
      actorId: session.actorId,
      taskId: session.taskId,
      status: session.status,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      ttlPhase,
      sweepable,
      reason: sweepable
        ? 'ttl-expired'
        : session.status === 'released' || session.status === 'expired'
          ? 'already-closed'
          : ttlPhase === 'grace'
            ? 'within-grace'
            : 'fresh'
    });
    if (!input.write || !sweepable) continue;
    const nextSession: LaneSessionDocument = {
      ...session,
      status: 'expired',
      updatedAt: generatedAt,
      lastCommand: normalizeLastCommand(input.lastCommand) ?? session.lastCommand
    };
    atomicWriteJson(laneSessionPathFor(cwd, session.laneId), nextSession);
    sweptSessions.push(nextSession);
  }
  return {
    generatedAt,
    graceMs,
    write: input.write === true,
    entries,
    staleCount: entries.filter((entry) => entry.sweepable).length,
    sweptCount: sweptSessions.length,
    sweptSessions
  };
}

export function isLaneSessionAdoptable(session: LaneSessionDocument): boolean {
  return session.status !== 'released' && session.status !== 'expired';
}

export function readLaneSession(cwd: string, laneId: string): LaneSessionDocument | null {
  return readLaneSessionFile(laneSessionPathFor(path.resolve(cwd), laneId));
}

export function listLaneSessions(cwd: string): readonly LaneSessionDocument[] {
  const absoluteRoot = path.join(path.resolve(cwd), runtimeLaneSessionsRootRelativePath);
  if (!existsSync(absoluteRoot)) return [];
  return readdirSync(absoluteRoot)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readLaneSessionFile(path.join(absoluteRoot, entry)))
    .filter((entry): entry is LaneSessionDocument => entry !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function classifyLaneSessionTtl(input: {
  readonly now?: string | Date;
  readonly expiresAt: string;
  readonly graceMs?: number;
}): LaneSessionTtlPhase {
  const nowMs = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now ?? new Date().toISOString());
  const expiresMs = Date.parse(input.expiresAt);
  const graceMs = normalizePositiveInteger(input.graceMs ?? 0, 0);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) return 'expired';
  if (nowMs <= expiresMs) return 'fresh';
  return nowMs <= expiresMs + graceMs ? 'grace' : 'expired';
}

export function hashHandoffToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function laneSessionPathFor(cwd: string, laneId: string): string {
  return path.join(path.resolve(cwd), runtimeLaneSessionsRootRelativePath, `${safeFileId(laneId)}.json`);
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function readLaneSessionFile(filePath: string): LaneSessionDocument | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LaneSessionDocument>;
    if (parsed.schemaId !== 'atm.laneSession.v1' || !normalizeOptionalString(parsed.laneId) || !normalizeOptionalString(parsed.actorId)) {
      return null;
    }
    return {
      schemaId: 'atm.laneSession.v1',
      specVersion: '0.1.0',
      laneId: parsed.laneId!.trim(),
      actorId: parsed.actorId!.trim(),
      taskId: normalizeOptionalString(parsed.taskId) ?? null,
      status: normalizeStatus(parsed.status),
      createdAt: normalizeIsoString(parsed.createdAt) ?? new Date().toISOString(),
      updatedAt: normalizeIsoString(parsed.updatedAt) ?? normalizeIsoString(parsed.createdAt) ?? new Date().toISOString(),
      expiresAt: normalizeIsoString(parsed.expiresAt) ?? new Date(0).toISOString(),
      ttlMs: normalizePositiveInteger(parsed.ttlMs, 0),
      identity: normalizeIdentity(parsed.identity, parsed.actorId!.trim()),
      adoptionSource: normalizeAdoptionSource(parsed.adoptionSource),
      handoffTokenHash: normalizeOptionalString(parsed.handoffTokenHash) ?? null,
      lastCommand: normalizeLastCommand(parsed.lastCommand),
      lastHeartbeatAt: normalizeIsoString(parsed.lastHeartbeatAt) ?? null
    };
  } catch {
    return null;
  }
}

function snapshotLaneIdentity(cwd: string, actorId: string): LaneSessionIdentitySnapshot {
  const identity = readRuntimeIdentityForActor(cwd, actorId);
  return {
    actorId,
    editor: normalizeOptionalString(identity?.editor) ?? null,
    gitName: normalizeOptionalString(identity?.gitName) ?? null,
    gitEmail: normalizeOptionalString(identity?.gitEmail) ?? null,
    provider: normalizeOptionalString(identity?.provider) ?? null,
    activeSessionId: normalizeOptionalString(identity?.activeSessionId) ?? null
  };
}

function createLaneSessionId(cwd: string, actorId: string, taskId: string | null, timestamp: string): string {
  const stamp = timestamp.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const digest = createHash('sha256')
    .update(`${path.resolve(cwd)}\n${actorId}\n${taskId ?? ''}\n${timestamp}`)
    .digest('hex')
    .slice(0, 10);
  return `lane-${stamp}-${sanitizeToken(actorId)}-${digest}`;
}

function normalizeAdoptionSource(value: unknown): LaneSessionAdoptionSource {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Partial<LaneSessionAdoptionSource> : {};
  const kind = record.kind === 'adoption' || record.kind === 'handoff' || record.kind === 'import' ? record.kind : 'mint';
  return {
    kind,
    sourceLaneId: normalizeOptionalString(record.sourceLaneId) ?? null,
    sourceActorId: normalizeOptionalString(record.sourceActorId) ?? null,
    reason: normalizeOptionalString(record.reason) ?? null
  };
}

function normalizeIdentity(value: unknown, actorId: string): LaneSessionIdentitySnapshot {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Partial<LaneSessionIdentitySnapshot> : {};
  return {
    actorId: normalizeOptionalString(record.actorId) ?? actorId,
    editor: normalizeOptionalString(record.editor) ?? null,
    gitName: normalizeOptionalString(record.gitName) ?? null,
    gitEmail: normalizeOptionalString(record.gitEmail) ?? null,
    provider: normalizeOptionalString(record.provider) ?? null,
    activeSessionId: normalizeOptionalString(record.activeSessionId) ?? null
  };
}

function normalizeLastCommand(value: unknown): LaneSessionLastCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<LaneSessionLastCommand>;
  const command = normalizeOptionalString(record.command);
  if (!command) return null;
  return {
    command,
    executedAt: normalizeIsoString(record.executedAt) ?? new Date().toISOString(),
    exitCode: typeof record.exitCode === 'number' && Number.isInteger(record.exitCode) ? record.exitCode : null
  };
}

function normalizeStatus(value: unknown): LaneSessionStatus {
  return value === 'handoff' || value === 'adopted' || value === 'released' || value === 'expired' ? value : 'active';
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeToken(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'lane';
}

function safeFileId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

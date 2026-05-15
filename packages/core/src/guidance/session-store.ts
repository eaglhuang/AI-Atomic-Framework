import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildGuidancePacket, type GuidancePacket, type GuidanceSession, type ProjectOrientationReport, type RouteDecision } from './guidance-packet.ts';
import type { LegacyRoutePlan } from './legacy-route-plan.ts';

export interface CreateGuidanceSessionInput {
  readonly repositoryRoot: string;
  readonly goal: string;
  readonly orientation: ProjectOrientationReport;
  readonly routeDecision: RouteDecision;
  readonly actor?: string;
  readonly now?: string;
  readonly legacyRoutePlan?: LegacyRoutePlan;
  readonly shadowMode?: boolean;
}

export interface GuidanceAuditRecord {
  readonly who: string;
  readonly when: string;
  readonly action: string;
  readonly reason: string;
  readonly result: string;
  readonly profile: string;
  readonly sessionId?: string;
}

export function createGuidanceSession(input: CreateGuidanceSessionInput): GuidanceSession {
  const now = input.now ?? new Date().toISOString();
  const actor = input.actor ?? 'ATM CLI';
  const sessionId = createSessionId(input.repositoryRoot, input.goal, now);
  const packet: GuidancePacket = buildGuidancePacket({
    sessionId,
    orientation: input.orientation,
    routeDecision: input.routeDecision
  });
  const session: GuidanceSession = {
    schemaId: 'atm.guidanceSession',
    specVersion: '0.1.0',
    sessionId,
    repositoryRoot: path.resolve(input.repositoryRoot),
    goal: input.goal,
    createdAt: now,
    updatedAt: now,
    actor,
    orientation: input.orientation,
    routeDecision: input.routeDecision,
    packet,
    ...(input.legacyRoutePlan !== undefined ? { legacyRoutePlan: input.legacyRoutePlan } : {}),
    ...(input.shadowMode !== undefined ? { shadowMode: input.shadowMode } : {})
  };
  writeGuidanceSession(session);
  writeGuidanceAudit(session.repositoryRoot, {
    who: actor,
    when: now,
    action: 'guidance.start',
    reason: input.goal,
    result: session.routeDecision.recommendedRoute,
    profile: 'dev',
    sessionId
  });
  return session;
}

export function guidancePaths(repositoryRoot: string, sessionId?: string) {
  const atmRoot = path.join(path.resolve(repositoryRoot), '.atm');
  return {
    activeSessionPath: path.join(atmRoot, 'runtime', 'guidance', 'active-session.json'),
    sessionsRoot: path.join(atmRoot, 'history', 'guidance', 'sessions'),
    auditLogPath: path.join(atmRoot, 'history', 'guidance', 'audit-log.jsonl'),
    proposalsRoot: path.join(atmRoot, 'history', 'guidance', 'proposals'),
    sessionPath: sessionId ? path.join(atmRoot, 'history', 'guidance', 'sessions', `${safeFileId(sessionId)}.json`) : null,
    proposalPath: sessionId ? path.join(atmRoot, 'history', 'guidance', 'proposals', `${safeFileId(sessionId)}.json`) : null
  };
}

export function writeGuidanceSession(session: GuidanceSession): void {
  const paths = guidancePaths(session.repositoryRoot, session.sessionId);
  if (!paths.sessionPath) return;
  writeJson(paths.sessionPath, session);
  writeJson(paths.activeSessionPath, {
    schemaId: 'atm.activeGuidanceSession',
    specVersion: '0.1.0',
    sessionId: session.sessionId,
    sessionPath: path.relative(session.repositoryRoot, paths.sessionPath).replace(/\\/g, '/'),
    updatedAt: session.updatedAt
  });
}

export function readActiveGuidanceSession(repositoryRoot: string): GuidanceSession | null {
  const paths = guidancePaths(repositoryRoot);
  const active = readJson(paths.activeSessionPath) as { sessionPath?: string } | null;
  if (!active?.sessionPath) return null;
  return readGuidanceSession(repositoryRoot, active.sessionPath.replace(/\.json$/, '').split('/').pop() ?? '');
}

export function readGuidanceSession(repositoryRoot: string, sessionId: string): GuidanceSession | null {
  const paths = guidancePaths(repositoryRoot, sessionId);
  if (!paths.sessionPath || !existsSync(paths.sessionPath)) return null;
  return readJson(paths.sessionPath) as GuidanceSession | null;
}

export function writeGuidanceAudit(repositoryRoot: string, record: GuidanceAuditRecord): void {
  const paths = guidancePaths(repositoryRoot);
  mkdirSync(path.dirname(paths.auditLogPath), { recursive: true });
  appendFileSync(paths.auditLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function createSessionId(repositoryRoot: string, goal: string, now: string): string {
  const timestamp = now.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const digest = createHash('sha256').update(`${path.resolve(repositoryRoot)}\n${goal}\n${now}`).digest('hex').slice(0, 10);
  return `guidance-${timestamp}-${digest}`;
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

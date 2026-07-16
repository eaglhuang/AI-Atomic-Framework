import { listLaneSessions, mintLaneSession, readLaneSession, type LaneSessionDocument } from './store.ts';
import { message, type CommandMessage } from '../shared.ts';

export interface LaneSessionEnvelope {
  readonly laneSessionId: string;
  readonly status: LaneSessionDocument['status'];
  readonly source: 'option' | 'env' | 'minted';
  readonly exportHint: string;
}

export interface LaneSessionResolution {
  readonly session: LaneSessionDocument;
  readonly source: LaneSessionEnvelope['source'];
  readonly exportHint: string;
  readonly messages: readonly CommandMessage[];
  readonly envelope: LaneSessionEnvelope;
}

export interface ResolveLaneSessionInput {
  readonly cwd: string;
  readonly laneSessionId?: string | null;
  readonly actorId?: string | null;
  readonly command?: string | null;
  readonly now?: string;
  readonly ttlMs?: number;
}

const defaultLaneSessionTtlMs = 30 * 60 * 1000;

export function resolveLaneSession(input: ResolveLaneSessionInput): LaneSessionResolution {
  const messages: CommandMessage[] = [];
  const actorId = normalizeOptionalString(input.actorId) ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'lane-actor';
  const optionLaneId = normalizeOptionalString(input.laneSessionId);
  const envLaneId = normalizeOptionalString(process.env.ATM_LANE_SESSION_ID);
  const requestedLaneId = optionLaneId ?? envLaneId;
  const requestedSource: LaneSessionEnvelope['source'] | null = optionLaneId ? 'option' : envLaneId ? 'env' : null;

  const requestedSession = requestedLaneId ? readLaneSession(input.cwd, requestedLaneId) : null;
  if (requestedSession && isUsableLaneSession(requestedSession, input.now)) {
    const exportHint = buildExportHint(requestedSession.laneId);
    addAdoptableMessages({ cwd: input.cwd, actorId: requestedSession.actorId, currentLaneId: requestedSession.laneId, messages });
    return buildResolution(requestedSession, requestedSource ?? 'env', exportHint, messages);
  }

  if (requestedLaneId) {
    messages.push(message('warn', 'ATM_LANE_SESSION_STALE_ENV', 'Requested lane session is missing, closed, or expired; minting a new lane session.', {
      requestedLaneSessionId: requestedLaneId,
      source: requestedSource,
      found: Boolean(requestedSession),
      status: requestedSession?.status ?? null
    }));
  }

  const minted = mintLaneSession({
    cwd: input.cwd,
    actorId,
    ttlMs: input.ttlMs ?? defaultLaneSessionTtlMs,
    timestamp: input.now,
    lastCommand: input.command
      ? {
        command: input.command,
        executedAt: input.now ?? new Date().toISOString(),
        exitCode: null
      }
      : null
  });
  const exportHint = buildExportHint(minted.session.laneId);
  messages.push(message('info', 'ATM_LANE_SESSION_MINTED', 'Minted a new lane session.', {
    laneSessionId: minted.session.laneId,
    sessionPath: minted.sessionPath,
    exportHint
  }));
  addAdoptableMessages({ cwd: input.cwd, actorId, currentLaneId: minted.session.laneId, messages });
  return buildResolution(minted.session, 'minted', exportHint, messages);
}

function buildResolution(
  session: LaneSessionDocument,
  source: LaneSessionEnvelope['source'],
  exportHint: string,
  messages: readonly CommandMessage[]
): LaneSessionResolution {
  return {
    session,
    source,
    exportHint,
    messages,
    envelope: {
      laneSessionId: session.laneId,
      status: session.status,
      source,
      exportHint
    }
  };
}

function addAdoptableMessages(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly currentLaneId: string;
  readonly messages: CommandMessage[];
}): void {
  const adoptable = listLaneSessions(input.cwd)
    .filter((session) => session.actorId === input.actorId)
    .filter((session) => session.laneId !== input.currentLaneId)
    .filter((session) => isUsableLaneSession(session))
    .slice(0, 3);
  if (adoptable.length === 0) return;
  input.messages.push(message('warn', 'ATM_LANE_SESSION_ADOPTABLE', 'Other active lane sessions exist for this actor; bare flows may continue, or export one of the listed lanes to adopt it.', {
    actorId: input.actorId,
    currentLaneSessionId: input.currentLaneId,
    adoptable: adoptable.map((session) => ({
      laneSessionId: session.laneId,
      updatedAt: session.updatedAt,
      exportHint: buildExportHint(session.laneId)
    }))
  }));
}

function isUsableLaneSession(session: LaneSessionDocument, now?: string): boolean {
  if (session.status === 'released' || session.status === 'expired') return false;
  const expiresAt = Date.parse(session.expiresAt);
  const nowMs = Date.parse(now ?? new Date().toISOString());
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && nowMs <= expiresAt;
}

function buildExportHint(laneSessionId: string): string {
  return `export ATM_LANE_SESSION_ID=${JSON.stringify(laneSessionId)}`;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

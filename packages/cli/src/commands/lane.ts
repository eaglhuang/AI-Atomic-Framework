import path from 'node:path';
import { appendLaneSessionEvent } from './lane-session/events.ts';
import { rebindLifecycleAfterLaneAdopt } from './lane-session/adopt-rebind.ts';
import { resolveLaneSession } from './lane-session/resolve.ts';
import {
  adoptLaneSession,
  inspectLaneSessionSweep,
  recordLaneSessionHeartbeat,
  sweepLaneSessions
} from './lane-session/store.ts';
import { CliError, makeResult, message } from './shared.ts';

export function runLane(argv: string[]) {
  const options = parseLaneOptions(argv);
  if (options.action === 'adopt') {
    return runLaneAdopt(options);
  }
  if (options.action === 'heartbeat') {
    return runLaneHeartbeat(options);
  }
  if (options.action === 'sweep') {
    return runLaneSweep(options);
  }
  if (options.action !== 'status') {
    throw new CliError('ATM_CLI_USAGE', 'lane supports: status, adopt <lane-id>, heartbeat [lane-id], sweep', { exitCode: 2 });
  }

  const lane = resolveLaneSession({
    cwd: options.cwd,
    laneSessionId: options.laneSessionId,
    actorId: options.actorId,
    command: 'node atm.mjs lane status --json'
  });

  return makeResult({
    ok: true,
    command: 'lane',
    cwd: options.cwd,
    messages: [
      ...lane.messages,
      message('info', 'ATM_LANE_SESSION_STATUS', `Lane session ${lane.session.laneId} is ${lane.session.status}.`, {
        laneSessionId: lane.session.laneId,
        status: lane.session.status,
        source: lane.source,
        exportHint: lane.exportHint
      })
    ],
    evidence: {
      action: 'status',
      laneSession: lane.envelope,
      session: lane.session
    }
  });
}

function runLaneAdopt(options: ParsedLaneOptions) {
  if (!options.targetLaneId) {
    throw new CliError('ATM_CLI_USAGE', 'lane adopt requires a lane id.', { exitCode: 2 });
  }
  const actorId = options.actorId ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? null;
  if (!actorId) {
    throw new CliError('ATM_LANE_ADOPT_ACTOR_REQUIRED', 'lane adopt requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
  }
  const adopted = adoptLaneSession({
    cwd: options.cwd,
    laneId: options.targetLaneId,
    actorId,
    reason: options.reason,
    confirm: options.confirm,
    handoffToken: options.handoffToken,
    graceMs: options.graceMs,
    lastCommand: {
      command: `node atm.mjs lane adopt ${options.targetLaneId} --json`,
      executedAt: new Date().toISOString(),
      exitCode: null
    }
  });
  if (!adopted.ok) {
    const code = adopted.reason === 'not-found'
      ? 'ATM_LANE_SESSION_NOT_FOUND'
      : adopted.reason === 'not-stale'
        ? 'ATM_LANE_SESSION_NOT_STALE'
        : adopted.reason === 'token-mismatch'
          ? 'ATM_LANE_ADOPT_TOKEN_MISMATCH'
          : 'ATM_LANE_SESSION_NOT_ADOPTABLE';
    const summary = adopted.reason === 'not-found'
      ? `Lane session ${options.targetLaneId} was not found.`
      : adopted.reason === 'not-stale'
        ? `Lane session ${options.targetLaneId} is still within TTL; adopt requires --confirm or a matching handoff token.`
        : adopted.reason === 'token-mismatch'
          ? `Lane session ${options.targetLaneId} handoff token did not match.`
          : `Lane session ${options.targetLaneId} is closed and cannot be adopted.`;
    throw new CliError(code, summary, {
      exitCode: 1,
      details: {
        laneSessionId: options.targetLaneId,
        status: adopted.session?.status ?? null,
        ttlPhase: adopted.ttlPhaseBefore ?? null,
        requiredCommand: adopted.reason === 'not-stale'
          ? `node atm.mjs lane adopt ${options.targetLaneId} --actor ${actorId} --confirm --json`
          : null
      }
    });
  }

  const rebind = rebindLifecycleAfterLaneAdopt({
    cwd: options.cwd,
    laneId: adopted.session.laneId,
    actorId,
    session: adopted.session
  });

  const event = appendLaneSessionEvent({
    cwd: options.cwd,
    laneId: adopted.session.laneId,
    action: 'adopt',
    actorId,
    details: {
      previousActorId: adopted.previousSession.actorId,
      previousStatus: adopted.previousSession.status,
      reason: options.reason,
      authorization: adopted.authorization,
      ttlPhaseBefore: adopted.ttlPhaseBefore,
      reboundSessionIds: rebind.reboundSessionIds,
      reboundTaskIds: rebind.reboundTaskIds,
      preservedLeaseIds: rebind.preservedLeaseIds
    }
  });
  const exportHint = buildExportHint(adopted.session.laneId);
  const envelope = {
    laneSessionId: adopted.session.laneId,
    status: adopted.session.status,
    source: 'option',
    exportHint
  };

  return makeResult({
    ok: true,
    command: 'lane',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_LANE_SESSION_ADOPTED', `Lane session ${adopted.session.laneId} adopted by ${actorId}.`, {
        laneSessionId: adopted.session.laneId,
        actorId,
        previousActorId: adopted.previousSession.actorId,
        authorization: adopted.authorization,
        reboundSessionIds: rebind.reboundSessionIds,
        reboundTaskIds: rebind.reboundTaskIds,
        preservedLeaseIds: rebind.preservedLeaseIds,
        eventPath: event.eventPath,
        exportHint
      })
    ],
    evidence: {
      action: 'adopt',
      laneSession: envelope,
      session: adopted.session,
      previousSession: adopted.previousSession,
      authorization: adopted.authorization,
      ttlPhaseBefore: adopted.ttlPhaseBefore,
      rebind,
      event: event.event,
      eventPath: event.eventPath
    }
  });
}

function runLaneHeartbeat(options: ParsedLaneOptions) {
  const actorId = options.actorId ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? null;
  const laneId = options.targetLaneId ?? options.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? null;
  if (!laneId) {
    throw new CliError('ATM_LANE_SESSION_HEARTBEAT_TARGET_REQUIRED', 'lane heartbeat requires a lane id or ATM_LANE_SESSION_ID.', { exitCode: 2 });
  }
  const heartbeat = recordLaneSessionHeartbeat({
    cwd: options.cwd,
    laneId,
    actorId,
    lastCommand: {
      command: `node atm.mjs lane heartbeat ${laneId} --json`,
      executedAt: new Date().toISOString(),
      exitCode: null
    }
  });
  if (!heartbeat.ok) {
    const details = {
      laneSessionId: laneId,
      status: heartbeat.session?.status ?? null,
      ttlPhaseBefore: heartbeat.ttlPhaseBefore
    };
    if (heartbeat.reason === 'not-found') {
      throw new CliError('ATM_LANE_SESSION_NOT_FOUND', `Lane session ${laneId} was not found.`, { exitCode: 1, details });
    }
    if (heartbeat.reason === 'expired') {
      throw new CliError('ATM_LANE_SESSION_HEARTBEAT_EXPIRED', `Lane session ${laneId} is expired and cannot be heartbeated.`, { exitCode: 1, details });
    }
    throw new CliError('ATM_LANE_SESSION_HEARTBEAT_CLOSED', `Lane session ${laneId} is closed and cannot be heartbeated.`, { exitCode: 1, details });
  }
  const event = appendLaneSessionEvent({
    cwd: options.cwd,
    laneId: heartbeat.session.laneId,
    action: 'heartbeat',
    actorId: actorId ?? heartbeat.session.actorId,
    details: {
      previousUpdatedAt: heartbeat.previousSession.updatedAt,
      previousExpiresAt: heartbeat.previousSession.expiresAt,
      nextExpiresAt: heartbeat.session.expiresAt,
      ttlPhaseBefore: heartbeat.ttlPhaseBefore,
      reason: options.reason
    }
  });
  const exportHint = buildExportHint(heartbeat.session.laneId);
  const envelope = {
    laneSessionId: heartbeat.session.laneId,
    status: heartbeat.session.status,
    source: options.targetLaneId || options.laneSessionId ? 'option' : 'env',
    exportHint
  };

  return makeResult({
    ok: true,
    command: 'lane',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_LANE_SESSION_HEARTBEAT_RECORDED', `Lane session ${heartbeat.session.laneId} heartbeat recorded.`, {
        laneSessionId: heartbeat.session.laneId,
        actorId: heartbeat.session.actorId,
        eventPath: event.eventPath,
        expiresAt: heartbeat.session.expiresAt,
        exportHint
      })
    ],
    evidence: {
      action: 'heartbeat',
      laneSession: envelope,
      session: heartbeat.session,
      previousSession: heartbeat.previousSession,
      ttlPhaseBefore: heartbeat.ttlPhaseBefore,
      event: event.event,
      eventPath: event.eventPath
    }
  });
}

function runLaneSweep(options: ParsedLaneOptions) {
  const actorId = options.actorId ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? null;
  const sweep = options.write
    ? sweepLaneSessions({
      cwd: options.cwd,
      graceMs: options.graceMs,
      write: true,
      actorId,
      lastCommand: {
        command: 'node atm.mjs lane sweep --write --json',
        executedAt: new Date().toISOString(),
        exitCode: null
      }
    })
    : inspectLaneSessionSweep({
      cwd: options.cwd,
      graceMs: options.graceMs,
      actorId
    });

  const events = options.write
    ? sweep.sweptSessions.map((session) => appendLaneSessionEvent({
      cwd: options.cwd,
      laneId: session.laneId,
      action: 'sweep-expire',
      actorId,
      details: {
        reason: 'ttl-expired',
        graceMs: sweep.graceMs
      }
    }))
    : [];
  const code = options.write ? 'ATM_LANE_SESSION_SWEEP_APPLIED' : 'ATM_LANE_SESSION_SWEEP_REPORTED';
  return makeResult({
    ok: true,
    command: 'lane',
    cwd: options.cwd,
    messages: [
      message('info', code, options.write
        ? `Lane sweep expired ${sweep.sweptCount} stale lane session(s).`
        : `Lane sweep found ${sweep.staleCount} stale lane session(s).`, {
        staleCount: sweep.staleCount,
        sweptCount: sweep.sweptCount,
        write: sweep.write,
        graceMs: sweep.graceMs,
        eventPaths: events.map((entry) => entry.eventPath)
      })
    ],
    evidence: {
      action: 'sweep',
      sweep,
      events: events.map((entry) => entry.event),
      eventPaths: events.map((entry) => entry.eventPath)
    }
  });
}

interface ParsedLaneOptions {
  readonly cwd: string;
  readonly action: 'status' | 'adopt' | 'heartbeat' | 'sweep';
  readonly targetLaneId: string | null;
  readonly laneSessionId: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly confirm: boolean;
  readonly handoffToken: string | null;
  readonly graceMs: number;
  readonly write: boolean;
}

function parseLaneOptions(argv: string[]): ParsedLaneOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedLaneOptions['action'] | null,
    targetLaneId: null as string | null,
    laneSessionId: null as string | null,
    actorId: null as string | null,
    reason: null as string | null,
    confirm: false,
    handoffToken: null as string | null,
    graceMs: 0,
    write: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--lane-session-id' || arg === '--lane-session') {
      state.laneSessionId = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      state.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--confirm') {
      state.confirm = true;
      continue;
    }
    if (arg === '--handoff-token') {
      state.handoffToken = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--grace-ms') {
      state.graceMs = requireNonNegativeInteger(requireValue(argv, index, '--grace-ms'), '--grace-ms');
      index += 1;
      continue;
    }
    if (arg === '--write') {
      state.write = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `lane does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      if ((state.action === 'adopt' || state.action === 'heartbeat') && !state.targetLaneId) {
        state.targetLaneId = arg;
        continue;
      }
      throw new CliError('ATM_CLI_USAGE', 'lane accepts only one action.', { exitCode: 2 });
    }
    state.action = arg as ParsedLaneOptions['action'];
  }

  return {
    cwd: path.resolve(state.cwd),
    action: state.action ?? 'status',
    targetLaneId: state.targetLaneId,
    laneSessionId: state.laneSessionId,
    actorId: state.actorId,
    reason: state.reason,
    confirm: state.confirm,
    handoffToken: state.handoffToken,
    graceMs: state.graceMs,
    write: state.write
  };
}

function buildExportHint(laneSessionId: string): string {
  return `export ATM_LANE_SESSION_ID=${JSON.stringify(laneSessionId)}`;
}

function requireValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `lane requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function requireNonNegativeInteger(value: string, optionName: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new CliError('ATM_CLI_USAGE', `lane requires a non-negative integer for ${optionName}`, { exitCode: 2 });
  }
  return numeric;
}

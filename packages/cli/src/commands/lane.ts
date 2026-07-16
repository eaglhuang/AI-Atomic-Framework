import path from 'node:path';
import { appendLaneSessionEvent } from './lane-session/events.ts';
import { resolveLaneSession } from './lane-session/resolve.ts';
import { adoptLaneSession } from './lane-session/store.ts';
import { CliError, makeResult, message } from './shared.ts';

export function runLane(argv: string[]) {
  const options = parseLaneOptions(argv);
  if (options.action === 'adopt') {
    return runLaneAdopt(options);
  }
  if (options.action !== 'status') {
    throw new CliError('ATM_CLI_USAGE', 'lane supports: status, adopt <lane-id>', { exitCode: 2 });
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
    lastCommand: {
      command: `node atm.mjs lane adopt ${options.targetLaneId} --json`,
      executedAt: new Date().toISOString(),
      exitCode: null
    }
  });
  if (!adopted.ok) {
    const code = adopted.reason === 'not-found' ? 'ATM_LANE_SESSION_NOT_FOUND' : 'ATM_LANE_SESSION_NOT_ADOPTABLE';
    const summary = adopted.reason === 'not-found'
      ? `Lane session ${options.targetLaneId} was not found.`
      : `Lane session ${options.targetLaneId} is closed and cannot be adopted.`;
    throw new CliError(code, summary, {
      exitCode: 1,
      details: {
        laneSessionId: options.targetLaneId,
        status: adopted.session?.status ?? null
      }
    });
  }

  const event = appendLaneSessionEvent({
    cwd: options.cwd,
    laneId: adopted.session.laneId,
    action: 'adopt',
    actorId,
    details: {
      previousActorId: adopted.previousSession.actorId,
      previousStatus: adopted.previousSession.status,
      reason: options.reason
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
        eventPath: event.eventPath,
        exportHint
      })
    ],
    evidence: {
      action: 'adopt',
      laneSession: envelope,
      session: adopted.session,
      previousSession: adopted.previousSession,
      event: event.event,
      eventPath: event.eventPath
    }
  });
}

interface ParsedLaneOptions {
  readonly cwd: string;
  readonly action: 'status' | 'adopt';
  readonly targetLaneId: string | null;
  readonly laneSessionId: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
}

function parseLaneOptions(argv: string[]): ParsedLaneOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedLaneOptions['action'] | null,
    targetLaneId: null as string | null,
    laneSessionId: null as string | null,
    actorId: null as string | null,
    reason: null as string | null
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
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `lane does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      if (state.action === 'adopt' && !state.targetLaneId) {
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
    reason: state.reason
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

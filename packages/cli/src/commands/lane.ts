import path from 'node:path';
import { resolveLaneSession } from './lane-session/resolve.ts';
import { CliError, makeResult, message } from './shared.ts';

export function runLane(argv: string[]) {
  const options = parseLaneOptions(argv);
  if (options.action !== 'status') {
    throw new CliError('ATM_CLI_USAGE', 'lane supports: status', { exitCode: 2 });
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

interface ParsedLaneOptions {
  readonly cwd: string;
  readonly action: 'status';
  readonly laneSessionId: string | null;
  readonly actorId: string | null;
}

function parseLaneOptions(argv: string[]): ParsedLaneOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedLaneOptions['action'] | null,
    laneSessionId: null as string | null,
    actorId: null as string | null
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
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `lane does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'lane accepts only one action.', { exitCode: 2 });
    }
    state.action = arg as ParsedLaneOptions['action'];
  }

  return {
    cwd: path.resolve(state.cwd),
    action: state.action ?? 'status',
    laneSessionId: state.laneSessionId,
    actorId: state.actorId
  };
}

function requireValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `lane requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

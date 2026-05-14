import path from 'node:path';
import { createGuidanceSession, decideGuidanceRoute, probeProject } from '../../../core/src/guidance/index.ts';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';

export function runStart(argv: string[] = []) {
  const spec = getCommandSpec('start');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for start.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const goal = String(parsed.options.goal ?? '').trim();
  if (!goal) {
    throw new CliError('ATM_CLI_USAGE', 'start requires --goal "<goal>"', { exitCode: 2 });
  }

  const orientation = probeProject(cwd);
  const routeDecision = decideGuidanceRoute({ goal, orientation });
  const session = createGuidanceSession({
    repositoryRoot: cwd,
    goal,
    orientation,
    routeDecision,
    actor: String(parsed.options.actor ?? 'ATM CLI')
  });

  return makeResult({
    ok: true,
    command: 'start',
    cwd,
    messages: [message('info', 'ATM_GUIDANCE_SESSION_STARTED', 'Guidance session started.', { sessionId: session.sessionId })],
    evidence: {
      sessionId: session.sessionId,
      routeDecision,
      guidancePacket: session.packet,
      session
    }
  });
}

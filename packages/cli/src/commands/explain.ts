import path from 'node:path';
import { explainGuidanceIssue, readActiveGuidanceSession, readGuidanceSession } from '../../../core/src/guidance/index.ts';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';

export function runExplain(argv: string[] = []) {
  const spec = getCommandSpec('explain');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for explain.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const why = String(parsed.options.why ?? '').trim();
  if (why !== 'blocked') {
    throw new CliError('ATM_CLI_USAGE', 'explain currently supports --why blocked', { exitCode: 2 });
  }

  const sessionId = typeof parsed.options.session === 'string' ? parsed.options.session : null;
  const session = sessionId ? readGuidanceSession(cwd, sessionId) : readActiveGuidanceSession(cwd);
  if (!session) {
    const issue = explainGuidanceIssue('ATM_GUIDANCE_SESSION_REQUIRED');
    return makeResult({
      ok: false,
      command: 'explain',
      cwd,
      messages: [message('error', issue.code, issue.message, issue.details)],
      evidence: {
        why,
        issues: [issue]
      }
    });
  }

  const blockedBy = session.routeDecision.blockedBy;
  const missingEvidence = session.packet.missingEvidence;
  return makeResult({
    ok: true,
    command: 'explain',
    cwd,
    messages: [message('info', 'ATM_GUIDANCE_EXPLAIN_READY', 'Guidance block explanation is ready.', { sessionId: session.sessionId })],
    evidence: {
      why,
      sessionId: session.sessionId,
      recommendedRoute: session.routeDecision.recommendedRoute,
      blockedBy,
      missingEvidence,
      nextStep: session.packet.nextCommand,
      allowedCommands: session.packet.allowedCommands,
      blockedCommands: session.packet.blockedCommands
    }
  });
}

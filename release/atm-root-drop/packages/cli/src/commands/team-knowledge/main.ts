import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand } from '../shared.ts';
import { runKnowledgeBuild, runKnowledgeCompact, runKnowledgeQuery, runKnowledgeStats } from './actions.ts';
import { evaluateKnowledgePermission } from './permission.ts';
import { teamKnowledgeSpec } from './spec.ts';

export async function runTeamKnowledge(argv: string[], inheritedCwd?: string) {
  const parsed = parseArgsForCommand(teamKnowledgeSpec, argv);
  const action = String(parsed.positional[0] ?? 'build').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? inheritedCwd ?? process.cwd()));
  const permission = evaluateKnowledgePermission(action, parsed.options);
  if (!permission.ok) {
    return makeResult({
      ok: false,
      command: 'team',
      cwd,
      messages: [message('error', permission.code, permission.reason, permission.details)],
      evidence: {
        action: `knowledge.${action}`,
        permission
      }
    });
  }

  if (action === 'build') {
    return runKnowledgeBuild(parsed.options, cwd, permission);
  }
  if (action === 'query') {
    return runKnowledgeQuery(parsed.options, cwd, permission);
  }
  if (action === 'stats') {
    return runKnowledgeStats(parsed.options, cwd, permission);
  }
  if (action === 'compact') {
    return runKnowledgeCompact(parsed.options, cwd, permission);
  }
  throw new CliError('ATM_CLI_USAGE', 'team knowledge supports: build, query, stats, compact', { exitCode: 2 });
}

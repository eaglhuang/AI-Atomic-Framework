import path from 'node:path';
import { probeProject } from '../../../core/src/guidance/index.ts';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';

export function runOrient(argv: string[] = []) {
  const spec = getCommandSpec('orient');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for orient.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const orientation = probeProject(cwd);
  return makeResult({
    ok: true,
    command: 'orient',
    cwd,
    messages: [message('info', 'ATM_GUIDANCE_ORIENTATION_READY', 'Project orientation report is ready.', { repositoryRoot: orientation.repositoryRoot })],
    evidence: {
      orientation
    }
  });
}

import path from 'node:path';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';

export function runTaskflow(argv: string[] = []) {
  const spec = getCommandSpec('taskflow');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for taskflow.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  const action = parsed.positional[0];
  if (action !== 'open') {
    throw new CliError('ATM_CLI_USAGE', `Unknown taskflow action: ${action}. Only "open" is supported.`, { exitCode: 2 });
  }

  const write = !!parsed.options.write;

  if (write) {
    throw new CliError(
      'ATM_TASKFLOW_WRITE_MODE_NOT_SUPPORTED',
      'The write mode is not supported for taskflow in this version. ATM taskflow acts as an orchestrator only and does not write to task card, ledger, or shard files.',
      { exitCode: 1 }
    );
  }

  // 實作 dry-run 骨架
  const result = makeResult({
    ok: true,
    command: 'taskflow open',
    cwd,
    mode: 'dry-run',
    messages: [
      message(
        'info',
        'ATM_TASKFLOW_OPEN_DRY_RUN_SKELETON_READY',
        'Taskflow open dry-run skeleton is ready. Write mode is not supported by design.',
        { cwd }
      )
    ],
    evidence: {
      wouldDo: [
        {
          workItemId: 'TASK-AAO-0112',
          action: 'create-dry-run',
          status: 'planned',
          targetRepo: 'AI-Atomic-Framework'
        }
      ],
      diagnostics: [
        'This is a read-only orchestrator dry-run skeleton.',
        'No physical task cards, ledger records, or json shards will be created or modified by this command.'
      ],
      decision: {
        reason: 'All task ledger mutations remain delegated to the repo-profile specified task opener and compiler.',
        delegatedTo: 'repo-profile task compiler / task-card-opener.js'
      }
    }
  });

  return {
    ...result,
    schemaId: 'atm.taskflowOpenResult.v1',
    writeEnabled: false
  };
}

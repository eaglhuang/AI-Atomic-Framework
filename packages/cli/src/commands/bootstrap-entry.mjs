import { runInit } from './init.mjs';
import { message } from './shared.mjs';

const defaultBootstrapTaskTitle = 'Bootstrap ATM in this repository';

export function runBootstrap(argv) {
  const hasTask = Array.isArray(argv) && argv.includes('--task');
  const effectiveArgs = hasTask ? argv : [...argv, '--task', defaultBootstrapTaskTitle];
  const result = runInit([...effectiveArgs, '--adopt', 'default']);
  const created = Array.isArray(result.evidence?.created) ? result.evidence.created : [];
  const bootstrapCreated = created.length > 0;

  return {
    ...result,
    command: 'bootstrap',
    messages: [
      bootstrapCreated
        ? message('info', 'ATM_BOOTSTRAP_CREATED', 'ATM default bootstrap pack created.')
        : message('info', 'ATM_BOOTSTRAP_READY', 'ATM default bootstrap pack already exists; no files were changed.')
    ]
  };
}

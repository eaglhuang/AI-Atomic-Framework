import { runInit } from './init.mjs';
import { message } from './shared.mjs';

export function runBootstrap(argv) {
  const result = runInit([...argv, '--adopt', 'default']);
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
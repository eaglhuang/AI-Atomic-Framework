import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'team',
  summary: 'Plan scoped ATM team agents for a task without writing runtime state.',
  positional: [
    { name: 'action', summary: 'Team action. Currently supports: plan.' }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id to build a dry-run team plan for.' },
    { flag: '--recipe', value: 'id', summary: 'Optional team recipe id. Defaults to a language-aware built-in recipe.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs team plan --task TASK-AAO-0005 --json',
    'node atm.mjs team plan --task TASK-AAO-0005 --recipe atm.default.normal.typescript --json'
  ]
});

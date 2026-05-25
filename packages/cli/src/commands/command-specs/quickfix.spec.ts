import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'quickfix',
  summary: 'Manage the lightweight ATM quickfix runtime lock.',
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for claim or release actions.' },
    { flag: '--prompt', value: 'text', summary: 'Prompt text used to infer quickfix scope during claim.' },
    { flag: '--files', value: 'csv', summary: 'Optional comma-separated path scope for the quickfix lock.' },
    { flag: '--reason', value: 'text', summary: 'Optional human-readable reason for the quickfix lock.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs quickfix status --json',
    'node atm.mjs quickfix claim --actor codex-main --prompt "fix tsconfig.json typo" --json',
    'node atm.mjs quickfix release --actor codex-main --json'
  ]
});

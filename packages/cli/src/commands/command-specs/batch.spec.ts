import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'batch',
  summary: 'Inspect or checkpoint an active ATM batch run. Batch automates queue bookkeeping, but each task still needs real deliverables before closure.',
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for checkpoint or abandon actions.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs batch status --json',
    'node atm.mjs batch checkpoint --actor codex-main --json',
    'node atm.mjs batch abandon --actor codex-main --json'
  ]
});

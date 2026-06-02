import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'taskflow',
  summary: 'Visualize, plan, or prepare ATM task flows and execution paths.',
  positional: [
    { name: 'action', summary: 'open', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--dry-run', summary: 'Preview task cards to be opened and ledger updates without writing.' },
    { flag: '--write', summary: 'Perform the task card creation and ledger update.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs taskflow open --dry-run --json',
    'node atm.mjs taskflow open --write --json'
  ]
});

import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'route',
  summary: 'Steward takeover and validator-gated apply command.',
  positional: [
    { name: 'action', summary: 'takeover', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--merge-plan-file', value: 'path', summary: 'Path to merge plan file.' },
    { flag: '--proposal-file', value: 'path', summary: 'Path to patch proposal file.' },
    { flag: '--steward-id', value: 'name', summary: 'Steward identity name.' },
    { flag: '--evidence-out-path', value: 'path', summary: 'Path to save apply evidence.' },
    { flag: '--scope-files', value: 'csv', summary: 'Comma-separated scoped files.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs route takeover --merge-plan-file plan.json --proposal-file prop.json'
  ]
});

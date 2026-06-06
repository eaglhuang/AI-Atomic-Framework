import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'hook',
  summary: 'Run ATM-managed repository Git hook gates.',
  positional: [
    { name: 'action', summary: 'pre-commit | pre-push', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path.' },
    { flag: '--base', value: 'ref', summary: 'Base ref for pre-push commit-range validation.' },
    { flag: '--head', value: 'ref', summary: 'Head ref for pre-push commit-range validation.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs hook pre-commit --json',
    'node atm.mjs hook pre-push --base origin/main --head HEAD --json'
  ]
});

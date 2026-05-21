import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'git-hooks',
  summary: 'Install or verify ATM-managed Git hooks for framework-development hard gates.',
  positional: [
    { name: 'action', summary: 'install | verify', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path.' },
    { flag: '--framework-required', summary: 'Treat missing hooks as an error even outside a detected framework repo.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs git-hooks install --framework-required --json',
    'node atm.mjs git-hooks verify --framework-required --json'
  ]
});

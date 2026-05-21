import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'framework-mode',
  summary: 'Inspect whether ATM framework-development hard gates are required.',
  positional: [
    { name: 'action', summary: 'status', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path to inspect.' },
    { flag: '--files', value: 'csv', summary: 'Optional comma-separated declared change scope instead of git diff.' },
    { flag: '--target-repo', value: 'path', summary: 'Optional cross-repo target repository path.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs framework-mode status --json',
    'node atm.mjs framework-mode status --files packages/core/src/index.ts --json',
    'node atm.mjs framework-mode status --target-repo ../AI-Atomic-Framework --json'
  ]
});

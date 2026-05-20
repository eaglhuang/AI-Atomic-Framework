import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'guard',
  summary: 'Run governance guards for encoding, mutation scope, and git metadata.',
  positional: [
    { name: 'guard-name', summary: 'encoding | mutation | git', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id for mutation or git guard checks.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for mutation or git guard checks.' },
    { flag: '--files', value: 'csv', summary: 'Comma-separated file paths for the guard.' },
    { flag: '--fail-open', summary: 'Return ok=true with warnings when violations are detected.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs guard encoding --files README.md,package.json --json',
    'node atm.mjs guard mutation --task ATM-GOV-0106 --actor codex-main --files packages/cli/src/commands/guard.ts --json',
    'node atm.mjs guard git --task ATM-GOV-0106 --actor codex-main --json'
  ]
});

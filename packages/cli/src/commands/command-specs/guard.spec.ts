import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'guard',
  summary: 'Run governance guards for encoding, mutation scope, git metadata, framework development, and commit ranges.',
  positional: [
    { name: 'guard-name', summary: 'encoding | mutation | git | atom-callsite-readability | framework-development | commit-range', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path for atom-callsite-readability guard.' },
    { flag: '--task', value: 'id', summary: 'Task id for mutation or git guard checks.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for mutation or git guard checks.' },
    { flag: '--files', value: 'csv', summary: 'Comma-separated file paths for the guard or declared framework scope.' },
    { flag: '--base', value: 'ref', summary: 'Base ref for commit-range guard.' },
    { flag: '--head', value: 'ref', summary: 'Head ref for commit-range guard.' },
    { flag: '--fail-open', summary: 'Return ok=true with warnings when violations are detected.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs guard encoding --files README.md,package.json --json',
    'node atm.mjs guard mutation --task ATM-GOV-0106 --actor codex-main --files packages/cli/src/commands/guard.ts --json',
    'node atm.mjs guard git --task ATM-GOV-0106 --actor codex-main --json',
    'node atm.mjs guard atom-callsite-readability --repo . --json',
    'node atm.mjs guard framework-development --files packages/core/src/index.ts --json',
    'node atm.mjs guard commit-range --base origin/main --head HEAD --json'
  ]
});

import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'framework-mode',
    summary: 'Inspect or claim ATM framework-development hard gates for critical source changes.',
    positional: [
        { name: 'action', summary: 'status | claim | release', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--repo', value: 'path', summary: 'Repository path to inspect.' },
        { flag: '--files', value: 'csv', summary: 'Optional comma-separated declared change scope instead of git diff.' },
        { flag: '--target-repo', value: 'path', summary: 'Optional cross-repo target repository path.' },
        { flag: '--actor', value: 'id', summary: 'Actor id for temporary framework-development claim/release.' },
        { flag: '--reason', value: 'text', summary: 'Reason for temporary framework-development claim.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs framework-mode status --json',
        'node atm.mjs framework-mode status --files packages/core/src/index.ts --json',
        'node atm.mjs framework-mode status --target-repo ../AI-Atomic-Framework --json',
        'node atm.mjs framework-mode claim --actor codex-main --files packages/cli/src/commands/next.ts --reason "temporary framework maintenance" --json',
        'node atm.mjs framework-mode release --actor codex-main --json'
    ]
});

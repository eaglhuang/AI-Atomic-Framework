import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'verify',
    summary: 'Run verification checks for self hashes, neutrality, or AGENTS.md.',
    options: [
        commonCwdOption,
        { flag: '--self', summary: 'Verify seed self-verification hashes.' },
        { flag: '--neutrality', summary: 'Verify protected-surface neutrality.' },
        { flag: '--agents-md', summary: 'Verify AGENTS bootstrap guidance contracts.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs verify --self --json',
        'node atm.mjs verify --neutrality --json',
        'node atm.mjs verify --agents-md --json'
    ]
});

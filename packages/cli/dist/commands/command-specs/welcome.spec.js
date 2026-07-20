import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'welcome',
    summary: 'Summarize ATMChart, integration health, and the next ATM action for first-touch onboarding.',
    positional: [],
    options: [
        commonCwdOption,
        { flag: '--dry-run', summary: 'Preview welcome output without writing welcome lineage.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs welcome --cwd . --json',
        'node atm.mjs welcome --cwd . --dry-run --json'
    ]
});

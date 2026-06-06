import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'atomize',
    summary: 'Inspect and improve ATM atomization coverage for the current repository.',
    positional: [
        { name: 'subcommand', summary: 'inventory | score | backfill', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--repo', value: 'path', summary: 'Repository path to inspect or update.' },
        { flag: '--dry-run', summary: 'For backfill, generate a proposal without writing atomization artifacts.' },
        { flag: '--apply', summary: 'For backfill, write generatedDraft governance artifacts for review.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs atomize inventory --repo . --json',
        'node atm.mjs atomize score --repo . --json',
        'node atm.mjs atomize backfill --dry-run --repo . --json',
        'node atm.mjs atomize backfill --apply --repo . --json'
    ]
});

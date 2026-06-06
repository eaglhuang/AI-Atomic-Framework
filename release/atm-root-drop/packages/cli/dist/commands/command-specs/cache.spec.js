import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.js';
export default defineCommandSpec({
    name: 'cache',
    summary: 'Manage ATM guide cache and one-file runtime cache.',
    positional: [
        { name: 'action', summary: 'enable | disable | clear | status | prune', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--goal', value: 'text', summary: 'Filter guide cache entries when clearing.' },
        { flag: '--runtime', value: 'onefile', summary: 'Runtime cache kind to prune. Currently supports onefile.' },
        { flag: '--keep', value: 'count', summary: 'Number of newest one-file cache entries to keep. Defaults to 3.' },
        { flag: '--dry-run', summary: 'Report prune candidates without deleting cache entries.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs cache status --json',
        'node atm.mjs cache clear --goal "rank candidates" --json',
        'node atm.mjs cache prune --runtime onefile --keep 3 --json'
    ]
});

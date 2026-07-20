import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'candidates',
    summary: 'Rank legacy source candidates and emit source inventory plus police evidence.',
    positional: [
        { name: 'action', summary: 'Currently supports: rank', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--include', value: 'glob', summary: 'Source include glob. Repeatable. Defaults to Python pipeline/script globs.', repeatable: true },
        { flag: '--goal', value: 'text', summary: 'Original user goal preserved in the ranking artifact.' },
        { flag: '--max-file-lines', value: 'number', summary: 'Line-count threshold for decomposition police and risk scoring.' },
        { flag: '--limit', value: 'number', summary: 'Maximum ranked candidates to return.' },
        { flag: '--out-dir', value: 'path', summary: 'Report output directory. Defaults to .atm/history/reports/candidates.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs candidates rank --include "pipelines/**/*.py" --json',
        'node atm.mjs candidates rank --include "pipelines/**/*.py" --goal "Prioritize the messiest Python data pipelines" --json'
    ]
});

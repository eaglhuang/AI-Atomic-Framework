import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'atm-chart',
    summary: 'Render or verify ATMChart markdown from ATM guard sources.',
    positional: [
        { name: 'action', summary: 'render | verify', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--out', value: 'path', summary: 'Override ATMChart markdown output path (default: .atm/memory/atm-chart.md).' },
        { flag: '--version-check', summary: 'Also verify ATMChart/framework/template compatibility against the bundled release train matrix.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs atm-chart render --cwd .',
        'node atm.mjs atm-chart verify --cwd .'
    ]
});

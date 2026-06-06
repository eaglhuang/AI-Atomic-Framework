import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'explain',
    summary: 'Explain guidance blocks and the evidence needed to proceed.',
    options: [
        commonCwdOption,
        { flag: '--why', value: 'reason', summary: 'Currently supports: blocked.' },
        { flag: '--session', value: 'id', summary: 'Guidance session id; defaults to the active session.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs explain --why blocked --json',
        'node atm.mjs explain --why blocked --session <session-id> --json'
    ]
});

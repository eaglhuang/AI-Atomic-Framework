import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'status',
    summary: 'Inspect ATM status in framework or adopted repositories, including active worker claims for one-glance coordination.',
    options: [
        commonCwdOption,
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs status --json',
        'node atm.mjs status --pretty'
    ]
});

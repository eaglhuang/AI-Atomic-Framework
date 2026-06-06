import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'orient',
    summary: 'Inspect a repository and emit an ATM guidance orientation report.',
    options: [
        commonCwdOption,
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs orient --cwd . --json'
    ]
});

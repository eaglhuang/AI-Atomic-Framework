import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'orient',
    summary: 'Inspect a repository and emit an ATM guidance orientation report.',
    options: [
        commonCwdOption,
        { flag: '--full', summary: 'Include the complete test/validation entrypoint inventory; the default orientation keeps a compact summary.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs orient --cwd . --json',
        'node atm.mjs orient --cwd . --full --json'
    ]
});

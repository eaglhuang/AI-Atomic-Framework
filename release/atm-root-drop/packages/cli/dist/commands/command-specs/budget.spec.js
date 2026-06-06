import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'budget',
    summary: 'Evaluate context budget policy for a governed task.',
    positional: [
        { name: 'action', summary: 'Currently supports: check', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--task', value: 'id', summary: 'Work item id to evaluate.' },
        { flag: '--budget-id', value: 'id', summary: 'Custom budget report id.' },
        { flag: '--estimated-tokens', value: 'number', summary: 'Estimated token count for the pending turn.' },
        { flag: '--inline-artifacts', value: 'number', summary: 'Inline artifact count in the pending turn.' },
        { flag: '--requested-summary', value: 'text', summary: 'Requested summary guidance.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs budget check --task BOOTSTRAP-0001 --estimated-tokens 16000 --json'
    ]
});

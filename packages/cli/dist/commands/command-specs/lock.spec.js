import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'lock',
    summary: 'Check, acquire, or release a governed scope lock.',
    positional: [
        { name: 'action', summary: 'check | acquire | release', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--task', value: 'id', summary: 'Task id for lock operation.' },
        { flag: '--owner', value: 'name', summary: 'Lock owner identity.' },
        { flag: '--files', value: 'csv', summary: 'Comma-separated locked files for acquire.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs lock acquire --task BOOTSTRAP-0001 --owner atm-agent --json'
    ]
});

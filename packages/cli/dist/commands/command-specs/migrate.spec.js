import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'migrate',
    summary: 'Plan, apply, or verify ATM schema migration codemods for breaking framework version changes.',
    positional: [
        { name: 'action', summary: 'plan | apply | verify', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--from', value: 'version', summary: 'Source ATM chart version to migrate from (e.g. 0.0.1).' },
        { flag: '--to', value: 'version', summary: 'Target ATM chart version to migrate to (e.g. 0.1.0).' },
        { flag: '--fixture', value: 'path', summary: 'Fixture directory path for verify action (must contain before/ and after/).' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs migrate plan --from 0.0.1 --to 0.1.0 --json',
        'node atm.mjs migrate apply --from 0.0.1 --to 0.1.0 --json',
        'node atm.mjs migrate verify --fixture fixtures/migrations/atm-chart-0.0.1-to-0.1.0 --json'
    ]
});

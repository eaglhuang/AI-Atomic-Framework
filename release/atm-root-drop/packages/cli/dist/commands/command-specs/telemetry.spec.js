import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'telemetry',
    summary: 'Manage opt-in ATM CLI telemetry for the current repository.',
    positional: [],
    options: [
        commonCwdOption,
        { flag: '--on', summary: 'Opt in to telemetry for this repository.' },
        { flag: '--off', summary: 'Opt out of telemetry for this repository.' },
        { flag: '--status', summary: 'Show telemetry status (default action).' },
        { flag: '--endpoint', value: 'url', summary: 'Optional telemetry endpoint recorded with opt-in.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs telemetry --status --json',
        'node atm.mjs telemetry --on --json',
        'node atm.mjs telemetry --off --json'
    ]
});

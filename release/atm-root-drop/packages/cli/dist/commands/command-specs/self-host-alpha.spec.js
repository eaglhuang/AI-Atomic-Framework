import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'self-host-alpha',
    summary: 'Verify deterministic self-hosting alpha criteria.',
    options: [
        commonCwdOption,
        { flag: '--verify', summary: 'Run the deterministic self-hosting alpha checklist.' },
        { flag: '--agent', value: 'profile', summary: 'Optional advisory confidence profile.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs self-host-alpha --verify --json',
        'node atm.mjs self-host-alpha --verify --agent claude-code --json'
    ]
});

import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'doctor',
    summary: 'Inspect ATM engineering readiness and trust signals.',
    options: [
        commonCwdOption,
        { flag: '--ci-profile', value: 'profile', summary: 'CI-specific doctor policy profile. Supported: dependency-pr.' },
        { flag: '--skip-check', value: 'check', repeatable: true, summary: 'Skip an explicit doctor check. Supported: git-head-evidence.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs doctor --json',
        'node atm.mjs doctor --ci-profile dependency-pr --json'
    ]
});

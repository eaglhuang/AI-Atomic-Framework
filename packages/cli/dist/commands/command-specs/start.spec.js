import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'start',
    summary: 'Start an ATM guidance session for a concrete goal.',
    options: [
        commonCwdOption,
        { flag: '--goal', value: 'text', summary: 'Goal the agent is trying to accomplish.' },
        { flag: '--actor', value: 'name', summary: 'Optional actor label for session audit.' },
        { flag: '--target-file', value: 'path', summary: 'Path (relative to --cwd) to a legacy source file to analyze and build a LegacyRoutePlan from.' },
        { flag: '--release-blocker', value: 'symbols', summary: 'Comma-separated function names that are release blockers (used with --target-file or --legacy-flow).' },
        { flag: '--shadow', summary: 'Mark the session as shadow mode: dry-run only, no host legacy file writes.' },
        { flag: '--legacy-flow', summary: 'Force legacy route flow; build a LegacyRoutePlan from --target-file or the first config hotspot declared in .atm/config.json.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs start --cwd . --goal "Extract legacy helper" --json',
        'node atm.mjs start --cwd . --goal "Atomize leaf helper" --target-file src/utils.ts --release-blocker "processRequest" --legacy-flow --json'
    ]
});

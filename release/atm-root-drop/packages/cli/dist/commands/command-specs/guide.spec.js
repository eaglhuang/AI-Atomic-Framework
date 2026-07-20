import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'guide',
    summary: 'Show guided ATM workflows, classify free-text goals, and record host-local intent phrases.',
    positional: [
        { name: 'intent', summary: 'overview | first-layer | create-atom | create-map | bootstrap | glossary | help | learn | install-skill', required: false },
        { name: 'command', summary: 'Command name when intent is help.', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--goal', value: 'text', summary: 'Classify a natural-language goal and return the required guidance flow.' },
        { flag: '--phrase', value: 'text', summary: 'Host-local phrase to record when intent is learn.' },
        { flag: '--intent', value: 'id', summary: 'Intent id for guide learn: legacy-atomization | legacy-candidate-ranking | task-plan-import.' },
        { flag: '--reason', value: 'text', summary: 'Review reason for adding a learned host-local phrase.' },
        { flag: '--status', value: 'status', summary: 'Learned phrase status: suggested | active-host | promoted-framework.' },
        { flag: '--target', value: 'host|codex', summary: 'Skill installation target for guide install-skill.' },
        { flag: '--skills-root', value: 'path', summary: 'Override Codex skills root when installing with --target codex.' },
        { flag: '--force', summary: 'Overwrite an existing installed skill.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs guide --goal "Atomize a legacy helper" --json',
        'node atm.mjs guide --goal "Rank the messiest Python pipeline scripts" --json',
        'node atm.mjs guide learn --phrase "brown path washing" --intent legacy-atomization --reason "host phrasing for legacy atomization" --status active-host --json',
        'node atm.mjs guide install-skill --target host --json',
        'node atm.mjs guide first-layer --json',
        'node atm.mjs guide overview --json',
        'node atm.mjs guide glossary --json',
        'node atm.mjs guide help next --json'
    ]
});

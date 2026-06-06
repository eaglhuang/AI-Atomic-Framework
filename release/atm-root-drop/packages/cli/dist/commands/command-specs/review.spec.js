import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'review',
    summary: 'List, inspect, approve, reject, or materialize apply-ready / rollout-ready packets for upgrade proposals.',
    positional: [
        { name: 'action', summary: 'list | show | approve | reject | apply-ready | rollout-ready', required: false },
        { name: 'proposal-id', summary: 'Proposal id for show/approve/reject/apply-ready/rollout-ready.', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--queue', value: 'path', summary: 'Human review queue JSON path.' },
        { flag: '--projection', value: 'path', summary: 'Rendered markdown projection path.' },
        { flag: '--decision-log', value: 'path', summary: 'Decision log JSON path.' },
        { flag: '--reason', value: 'text', summary: 'Decision reason for approve/reject.' },
        { flag: '--by', value: 'name', summary: 'Decision actor label.' },
        { flag: '--at', value: 'timestamp', summary: 'Decision timestamp override.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs review list --json',
        'node atm.mjs review approve <proposal-id> --reason "approved" --json',
        'node atm.mjs review apply-ready <proposal-id> --json',
        'node atm.mjs review rollout-ready <proposal-id> --json'
    ]
});

import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'replacement-lane',
    summary: 'Advance a map through the explicit replacement rollout lane.',
    positional: [
        { name: 'action', summary: 'transition', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--map', value: 'id', summary: 'Target map id.' },
        { flag: '--to', value: 'mode', summary: 'Next replacement mode: shadow | canary | active | legacy-retired.' },
        { flag: '--evidence', value: 'path', summary: 'Evidence path or reference for the transition.', repeatable: true },
        { flag: '--reason', value: 'text', summary: 'Optional reason recorded in the lineage transition log.' },
        { flag: '--actor', value: 'name', summary: 'Optional actor label for the transition log.' },
        { flag: '--at', value: 'timestamp', summary: 'Optional timestamp override for the transition log.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs replacement-lane transition --map ATM-MAP-0001 --to shadow --evidence atomic_workbench/maps/ATM-MAP-0001/map.test.report.json --json',
        'node atm.mjs replacement-lane transition --map ATM-MAP-0001 --to active --evidence atomic_workbench/maps/ATM-MAP-0001/map.equivalence.report.json --evidence .atm/history/reports/review-advisory.json --json'
    ]
});

import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'police',
    summary: 'Run the ATM police family gate and emit a PoliceFamilyGateReport.',
    positional: [
        { name: 'action', summary: 'Currently supports: run', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--profile', value: 'standard|full', summary: 'Police family profile to run (default: standard).' },
        { flag: '--registry', value: 'path', summary: 'Registry document path for Dedup Police (default: atomic-registry.json).' },
        { flag: '--out', value: 'path', summary: 'Optional JSON report output path. Defaults to stdout evidence only.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs police run --profile standard --json',
        'node atm.mjs police run --profile full --out .atm/history/reports/police-family-gate.json --json'
    ]
});

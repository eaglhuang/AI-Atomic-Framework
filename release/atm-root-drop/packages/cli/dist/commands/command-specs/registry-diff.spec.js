import { defineCommandSpec } from '../shared.js';
import { commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'registry-diff',
    summary: 'Generate version hash diff report for a registry atom.',
    positional: [
        { name: 'atom-id', summary: 'Atom id to compare.', required: true }
    ],
    options: [
        { flag: '--from', value: 'version', summary: 'Source version.' },
        { flag: '--to', value: 'version', summary: 'Target version.' },
        { flag: '--registry', value: 'path', summary: 'Optional registry document path.' },
        { flag: '--reason', value: 'text', summary: 'Optional drift reason annotation.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs registry-diff ATM-CORE-0001 --from 1.0.0 --to 1.1.0 --json'
    ]
});

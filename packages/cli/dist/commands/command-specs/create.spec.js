import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'create',
    summary: 'Create and register an atom through the provisioning facade.',
    options: [
        commonCwdOption,
        { flag: '--bucket', value: 'bucket', summary: 'Atom bucket segment (for example: CORE, FIXTURE).' },
        { flag: '--title', value: 'title', summary: 'Human-readable atom title.' },
        { flag: '--description', value: 'text', summary: 'Atom description.' },
        { flag: '--logical-name', value: 'name', summary: 'Optional logical name override.' },
        { flag: '--dry-run', summary: 'Preview generated paths and IDs without writing files.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs create --bucket CORE --title NormalizeCssColor --description "Canonicalize CSS color input." --dry-run'
    ]
});

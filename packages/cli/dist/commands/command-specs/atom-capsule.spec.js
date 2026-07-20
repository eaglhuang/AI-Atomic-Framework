import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'atom-capsule',
    summary: 'Export, import, roll back, or inspect atom capsules in the capsule registry.',
    positional: [
        { name: 'action', summary: 'export | import | rollback | advisories', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--atom', value: 'id', summary: 'Atom id to export.' },
        { flag: '--name', value: 'text', summary: 'Human-readable name recorded in the capsule registry.' },
        { flag: '--source', value: 'path', summary: 'Source file to package during export.' },
        { flag: '--cid', value: 'cid', summary: 'Capsule content id for import or rollback.' },
        { flag: '--payload', value: 'base64', summary: 'Compressed capsule payload for import.' },
        { flag: '--no-vendor', summary: 'Skip vendoring the imported bundle into the repository vendor directory.' },
        { flag: '--previous-cid', value: 'cid', summary: 'Previous capsule cid to link when exporting a new revision.' },
        { flag: '--source-ref', value: 'text', summary: 'Optional source reference recorded in the registry entry.' },
        { flag: '--exported-by', value: 'id', summary: 'Actor or tool id recorded for the export event.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs atom-capsule export --atom ATM-CORE-0001 --source packages/core/src/index.ts --json',
        'node atm.mjs atom-capsule import --cid atm:cid:abc123 --payload <base64> --json',
        'node atm.mjs atom-capsule rollback --cid atm:cid:abc123 --json',
        'node atm.mjs atom-capsule advisories --json'
    ]
});

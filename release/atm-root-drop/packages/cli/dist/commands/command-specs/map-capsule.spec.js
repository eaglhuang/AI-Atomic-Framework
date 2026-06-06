import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'map-capsule',
    summary: 'Export, import, or roll back map capsules backed by the map capsule registry.',
    positional: [
        { name: 'action', summary: 'export | import | rollback', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--map', value: 'id', summary: 'Map id to export.' },
        { flag: '--cid', value: 'cid', summary: 'Map capsule content id for import or rollback.' },
        { flag: '--payload', value: 'base64', summary: 'Compressed map capsule payload for import.' },
        { flag: '--no-vendor', summary: 'Skip vendoring the imported map bundle into the repository vendor directory.' },
        { flag: '--previous-cid', value: 'cid', summary: 'Previous map capsule cid to link when exporting a new revision.' },
        { flag: '--exported-by', value: 'id', summary: 'Actor or tool id recorded for the export event.' },
        { flag: '--name', value: 'text', summary: 'Human-readable name recorded in the map capsule registry.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs map-capsule export --map ATM-MAP-0001 --json',
        'node atm.mjs map-capsule import --cid map:cid:abc123 --payload <base64> --json',
        'node atm.mjs map-capsule rollback --cid map:cid:abc123 --json'
    ]
});

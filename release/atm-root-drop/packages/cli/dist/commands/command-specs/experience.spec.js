import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'experience',
    summary: 'Extract reviewable learning artifacts from ATM evidence.',
    positional: [
        { name: 'action', summary: 'Currently supports: extract', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--from-task', value: 'id', summary: 'Override source task id from the input evidence.' },
        { flag: '--input', value: 'path', summary: 'Experience extraction input JSON path.' },
        { flag: '--out', value: 'path', summary: 'Write the skill candidate JSON artifact.' },
        { flag: '--advisory-out', value: 'path', summary: 'Write the review advisory JSON artifact.' },
        { flag: '--queue', value: 'path', summary: 'Append the generated proposal to a human-review queue.' },
        { flag: '--projection', value: 'path', summary: 'Write a Markdown projection for the human-review queue.' },
        { flag: '--by', value: 'actor', summary: 'Actor label for behavior execution evidence.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs experience extract --input fixtures/experience-loop/task-evidence.json --json',
        'node atm.mjs experience extract --input evidence.json --out .atm/history/artifacts/skill-candidate.json --json'
    ]
});

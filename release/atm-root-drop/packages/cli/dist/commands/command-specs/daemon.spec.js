import { defineCommandSpec } from '../shared.js';
import { commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'daemon',
    summary: 'Manage the advisory ATM background watcher daemon.',
    positional: [
        { name: 'action', summary: 'enable | disable | start | stop | status | log', required: false }
    ],
    options: [
        { flag: '--tail', value: 'count', summary: 'Number of notifications to include for `daemon log`.' },
        { flag: '--actor', value: 'id', summary: 'Actor id recorded when enabling the daemon.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs daemon enable --actor codex-main --json',
        'node atm.mjs daemon start --json',
        'node atm.mjs daemon status --json',
        'node atm.mjs daemon log --tail 20 --json'
    ]
});

import { defineCommandSpec } from '../shared.js';
import { commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'do',
    summary: 'Legacy convenience wrapper for task start, completion, and status flows.',
    positional: [
        { name: 'action', summary: 'start | complete', required: false }
    ],
    options: [
        { flag: '--task', alias: '-t', value: 'id', summary: 'Task id to start or complete.' },
        { flag: '--status', summary: 'Show currently active task lifecycle state instead of starting a task.' },
        { flag: '--evidence', value: 'path', summary: 'Evidence JSON path required by complete.' },
        { flag: '--dry-run', summary: 'Preview lifecycle actions without mutating task state.' },
        { flag: '--actor', value: 'id', summary: 'Actor id for lifecycle transitions.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs do --task TASK-1234 --actor codex-main --json',
        'node atm.mjs do complete --task TASK-1234 --actor codex-main --evidence .atm/history/evidence/TASK-1234.json --json',
        'node atm.mjs do --status --json'
    ]
});

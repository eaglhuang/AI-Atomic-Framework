import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.js';
export default defineCommandSpec({
    name: 'task-view',
    summary: 'Read-only task dashboard that unifies status triangulation, evidence blockers, close completion checklist, and the next safe operator command. task-view does not claim, repair, close, or route work; use next for deterministic routing and taskflow for governed open/close.',
    options: [
        commonCwdOption,
        { flag: '--task', value: 'id', summary: 'Task id to inspect.' },
        { flag: '--actor', value: 'id', summary: 'Optional actor id for evidence freshness checks and pre-close command hints.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs task-view --task TASK-MAO-0044 --json',
        'node atm.mjs task-view --task TASK-MAO-0044 --actor cursor-gpt-5.2 --pretty'
    ]
});

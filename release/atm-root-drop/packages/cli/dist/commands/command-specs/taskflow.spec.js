import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'taskflow',
    summary: 'Official operator-facing task opener orchestration. taskflow open orchestrates; tasks new generates.',
    positional: [
        { name: 'action', summary: 'open', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--dry-run', summary: 'Return the orchestration plan without writing. Default when --write is omitted.' },
        { flag: '--write', summary: 'Run the governed opener entry when delegation prerequisites are satisfied; otherwise fail closed in template-only-fallback mode.' },
        { flag: '--profile', value: 'path', summary: 'Path to the taskflow profile JSON file.' },
        { flag: '--task-id', value: 'id', summary: 'Explicit task id forwarded to the tasks new generation surface during governed write.' },
        { flag: '--output', value: 'path', summary: 'Explicit markdown output path forwarded to the tasks new generation surface during governed write.' },
        { flag: '--template', value: 'name', summary: 'Template key forwarded to tasks new (default: aao-l2-split).' },
        { flag: '--title', value: 'text', summary: 'Optional title forwarded to tasks new.' },
        { flag: '--roster-index', value: 'path', summary: 'Optional roster README path override for roster sync policy.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs taskflow open --dry-run --json',
        'node atm.mjs taskflow open --dry-run --profile planning/taskflow.profile.json --json',
        'node atm.mjs taskflow open --write --profile planning/taskflow.profile.json --task-id TASK-ADOPTER-0002 --output tasks/TASK-ADOPTER-0002.task.md --json'
    ]
});

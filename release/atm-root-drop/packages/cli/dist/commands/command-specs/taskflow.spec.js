import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'taskflow',
    summary: 'Official operator-facing task opener and closeback orchestration. taskflow open orchestrates open; taskflow close is the official operator lane for closeback and may delegate protected backend surfaces internally. tasks new generates; tasks close/reconcile/import/repair-closure remain authoritative emergency backends when used directly.',
    positional: [
        { name: 'action', summary: 'open | close', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--dry-run', summary: 'Return the orchestration plan without writing. Default when --write is omitted.' },
        { flag: '--write', summary: 'Run the governed orchestration entry when prerequisites are satisfied; otherwise fail closed.' },
        { flag: '--no-commit', summary: 'For taskflow close --write: exact-stage the target and planning repo bundle, but do not commit. Auto-commit is on by default.' },
        { flag: '--profile', value: 'path', summary: 'Path to the taskflow profile JSON file.' },
        { flag: '--task', value: 'id', summary: 'Task id for taskflow close orchestration.' },
        { flag: '--actor', value: 'id', summary: 'Actor id required for taskflow close --write.' },
        { flag: '--task-id', value: 'id', summary: 'Explicit task id forwarded to the tasks new generation surface during governed open write.' },
        { flag: '--output', value: 'path', summary: 'Explicit markdown output path forwarded to the tasks new generation surface during governed open write.' },
        { flag: '--template', value: 'name', summary: 'Template key forwarded to tasks new (default: aao-l2-split).' },
        { flag: '--title', value: 'text', summary: 'Optional title forwarded to tasks new.' },
        { flag: '--roster-index', value: 'path', summary: 'Optional roster README path override for roster sync policy.' },
        { flag: '--historical-delivery', value: 'commit', summary: 'For taskflow close: verify an earlier delivery commit through tasks close or reconcile.', repeatable: true },
        { flag: '--delivery-commit', value: 'commit', summary: 'Alias for --historical-delivery on taskflow close.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs taskflow open --dry-run --json',
        'node atm.mjs taskflow open --dry-run --profile planning/taskflow.profile.json --json',
        'node atm.mjs taskflow open --write --profile planning/taskflow.profile.json --task-id TASK-ADOPTER-0002 --output tasks/TASK-ADOPTER-0002.task.md --json',
        'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --dry-run --json',
        'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --historical-delivery abc123 --write --json',
        'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --write --no-commit --json'
    ]
});

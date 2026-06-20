import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.js';
export default defineCommandSpec({
    name: 'batch',
    summary: 'Inspect, repair, resume, skip, or checkpoint an active ATM batch run. Batch automates queue bookkeeping, but each task still needs real deliverables before closure.',
    options: [
        commonCwdOption,
        { flag: '--actor', value: 'id', summary: 'Actor id used for checkpoint, skip, resume, or abandon actions.' },
        { flag: '--batch', value: 'id', summary: 'Select a specific active batch run by batchId.' },
        { flag: '--compact', summary: 'Return only the current queue head, progress, allowed files, validators, and next commands for fast agent routing.' },
        { flag: '--delivery-commit', value: 'commit', summary: 'For checkpoint: verify a scoped delivery commit, equivalent to tasks close --historical-delivery.' },
        { flag: '--hold', summary: 'For checkpoint: close and advance the current task, but do not auto-claim the next queue head before the commit window.' },
        { flag: '--historical-delivery', value: 'commit', summary: 'For checkpoint: verify an earlier scoped delivery commit before closing the queue head.' },
        { flag: '--reason', value: 'text', summary: 'For skip: required blocker reason recorded in the batch audit trail.' },
        { flag: '--scope', value: 'key', summary: 'Select a specific active batch run by scopeKey when batchId is not available.' },
        { flag: '--task', value: 'id', summary: 'For skip/resume: task id to skip from the queue head or restore from the skipped list.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs batch status --json',
        'node atm.mjs batch status --batch batch-abc123 --compact --json',
        'node atm.mjs batch current --compact --json',
        'node atm.mjs batch repair --actor codex-main --batch batch-abc123 --json',
        'node atm.mjs batch skip --actor codex-main --batch batch-abc123 --task TASK-AAO-0044 --reason "external blocker" --json',
        'node atm.mjs batch resume --actor codex-main --batch batch-abc123 --task TASK-AAO-0044 --json',
        'node atm.mjs batch resume --actor codex-main --scope TASK-ASA --json',
        'node atm.mjs batch checkpoint --actor codex-main --batch batch-abc123 --delivery-commit abc123 --json',
        'node atm.mjs batch checkpoint --actor codex-main --batch batch-abc123 --hold --json',
        'node atm.mjs batch checkpoint --actor codex-main --batch batch-abc123 --json',
        'node atm.mjs batch abandon --actor codex-main --batch batch-abc123 --json'
    ]
});

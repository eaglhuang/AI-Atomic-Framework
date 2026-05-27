import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'batch',
  summary: 'Inspect, repair, resume, or checkpoint an active ATM batch run. Batch automates queue bookkeeping, but each task still needs real deliverables before closure.',
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for checkpoint or abandon actions.' },
    { flag: '--batch', value: 'id', summary: 'Select a specific active batch run by batchId.' },
    { flag: '--compact', summary: 'Return only the current queue head, progress, allowed files, validators, and next commands for fast agent routing.' },
    { flag: '--delivery-commit', value: 'commit', summary: 'For checkpoint: verify a scoped delivery commit, equivalent to tasks close --historical-delivery.' },
    { flag: '--hold', summary: 'For checkpoint: close and advance the current task, but do not auto-claim the next queue head before the commit window.' },
    { flag: '--historical-delivery', value: 'commit', summary: 'For checkpoint: verify an earlier scoped delivery commit before closing the queue head.' },
    { flag: '--scope', value: 'key', summary: 'Select a specific active batch run by scopeKey when batchId is not available.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs batch status --json',
    'node atm.mjs batch status --batch batch-abc123 --compact --json',
    'node atm.mjs batch current --compact --json',
    'node atm.mjs batch repair --actor codex-main --batch batch-abc123 --json',
    'node atm.mjs batch resume --actor codex-main --scope TASK-ASA --json',
    'node atm.mjs batch checkpoint --actor codex-main --batch batch-abc123 --delivery-commit abc123 --json',
    'node atm.mjs batch checkpoint --actor codex-main --batch batch-abc123 --hold --json',
    'node atm.mjs batch checkpoint --actor codex-main --batch batch-abc123 --json',
    'node atm.mjs batch abandon --actor codex-main --batch batch-abc123 --json'
  ]
});

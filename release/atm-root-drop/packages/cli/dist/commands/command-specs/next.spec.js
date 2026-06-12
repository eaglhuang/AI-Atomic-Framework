// Spec definitions for next command
import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'next',
    summary: 'Route the current prompt into the official ATM fast, normal, or batch work channel.',
    options: [
        commonCwdOption,
        { flag: '--claim', summary: 'Start the selected fast/normal/batch route and create the required runtime state.' },
        { flag: '--actor', value: 'id', summary: 'Actor id used for next --claim (or set ATM_ACTOR_ID).' },
        { flag: '--prompt', value: 'text', summary: 'Scope next-action routing to the current user prompt before falling back to global state.' },
        { flag: '--task', value: 'id', summary: 'Route directly to one task id without writing a shared task-intent file.' },
        { flag: '--tasks', value: 'csv', summary: 'Freeze an explicit comma-separated task id range for a batch claim.' },
        { flag: '--intent', value: 'path', summary: 'Read an atm.taskIntent.v1 JSON file produced by a trusted skill or integration hook.' },
        { flag: '--output', value: 'path', summary: 'Write JSON output to a file. When passed without a path, defaults to .atm-temp/next-<timestamp>.json.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs next --json',
        'node atm.mjs next --json --output',
        'node atm.mjs next --prompt "implement TASK-ABC-0001" --json',
        'node atm.mjs next --task TASK-ABC-0001 --json',
        'node atm.mjs next --prompt "quick fix tsconfig.json typo" --json',
        'node atm.mjs next --prompt "complete all task cards in PlanAlpha" --json',
        'node atm.mjs next --claim --actor codex-main --prompt "complete selected cards" --tasks TASK-1,TASK-2 --json',
        'node atm.mjs next --intent .atm/runtime/task-intent.json --json',
        'node atm.mjs next --cwd <host-repo> --json',
        'node atm.mjs next --claim --actor codex-main --task TASK-ABC-0001 --json',
        'node atm.mjs next --claim --actor codex-main --prompt "implement TASK-ABC-0001" --json'
    ]
});

// Spec definitions for next command
import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'next',
    summary: 'Route the current prompt into the official ATM fast, normal, or batch work channel. When the selected task id is already known (via --task or an unambiguous --prompt resolution), the recommended claim command prefers the explicit --task TASK-XXX form over re-passing the natural-language prompt.',
    options: [
        commonCwdOption,
        { flag: '--claim', summary: 'Start the selected fast/normal/batch route and create the required runtime state.' },
        { flag: '--actor', value: 'id', summary: 'Actor id used for next --claim (or set ATM_ACTOR_ID).' },
        { flag: '--auto-intent', summary: 'For next --claim task routes, auto-resolve write vs closeout-only from in-scope dirty files and whether deliverables already landed in HEAD.' },
        { flag: '--claim-intent', value: 'mode', summary: 'Override claim mode for next --claim: write or closeout-only/no-more-mutation.' },
        { flag: '--closeout-only', summary: 'Alias for --claim-intent closeout-only on next --claim.' },
        { flag: '--no-more-mutation', summary: 'Alias for --claim-intent closeout-only on next --claim.' },
        { flag: '--files', value: 'csv', summary: 'Optional comma-separated scope files for next --claim; ATM still includes the task ledger record in the underlying claim.' },
        { flag: '--prompt', value: 'text', summary: 'Scope next-action routing to the current user prompt before falling back to global state.' },
        { flag: '--task', value: 'id', summary: 'Route directly to one task id without writing a shared task-intent file.' },
        { flag: '--tasks', value: 'csv', summary: 'Freeze an explicit comma-separated task id range for a batch claim.' },
        { flag: '--intent', value: 'path', summary: 'Read an atm.taskIntent.v1 JSON file produced by a trusted skill or integration hook.' },
        { flag: '--output', value: 'path', summary: 'Write JSON output to a file. When passed without a path, defaults to .atm-temp/next-<timestamp>.json.' },
        { flag: '--verbose', summary: 'Skip default output compaction and return the full untrimmed envelope (large frameworkStatus file lists, duplicated top-level aliases, full playbook echoed inside messages).' },
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
        'node atm.mjs next --claim --actor codex-main --task TASK-ABC-0001 --auto-intent --json',
        'node atm.mjs next --claim --actor codex-main --task TASK-ABC-0001 --files packages/core/src/index.ts --claim-intent write --json',
        'node atm.mjs next --claim --actor codex-main --prompt "implement TASK-ABC-0001" --auto-intent --json',
        'node atm.mjs next --claim --actor codex-main --task TASK-ABC-0001 --claim-intent closeout-only --json'
    ],
    help: {
        audience: 'agent',
        requiredFlagSets: [
            { when: 'Claiming a governed route', flags: ['--claim', '--actor'] },
            { when: 'Routing one exact task without fuzzy prompt matching', flags: ['--task'] }
        ],
        relatedCommands: [
            'node atm.mjs guide --goal "<goal>" --json',
            'node atm.mjs task-view --task TASK-ABC-0001 --json',
            'node atm.mjs batch checkpoint --actor <actor-id> --json'
        ],
        commonMistakes: [
            'Passing one broad prompt that names many task ids; prefer --task, --tasks, or an intent file when the scope is already known.',
            'Running low-level tasks claim loops after next selected a batch lane.',
            'Treating next as task closure; next chooses the governed route, but evidence and closeout still happen in the selected playbook.'
        ],
        playbookNotes: [
            'Read evidence.nextAction.playbook before editing, committing, or closing a task.',
            'When the prompt already resolves to one exact task, prefer next --claim --task TASK-XXX over re-passing natural language.',
            'If governanceReadiness is present, resolve doctor/framework claim/pre-push blockers before implementation.',
            'Default output is compacted (large frameworkStatus file lists truncated, duplicated top-level aliases removed, playbook echoed once via evidence.nextAction.playbook); pass --verbose for the full untrimmed envelope.'
        ]
    }
});

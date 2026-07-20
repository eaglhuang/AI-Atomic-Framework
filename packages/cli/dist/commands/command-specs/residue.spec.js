import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'residue',
    summary: 'Inspect or reconcile ATM-managed worktree residue across tasks.',
    positional: [
        { name: 'action', summary: 'status | reconcile', required: false }
    ],
    options: [
        { flag: '--apply', summary: 'For residue reconcile, remove only owner-aware safe disposable residue. Omit for dry-run.' },
        commonCwdOption,
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs residue status --json',
        'node atm.mjs residue reconcile --json',
        'node atm.mjs residue reconcile --apply --json'
    ],
    help: {
        audience: 'operator',
        requiredFlagSets: [],
        relatedCommands: [
            'node atm.mjs status --json',
            'node atm.mjs tasks status --task TASK-ABC-0001 --residue --json'
        ],
        commonMistakes: [
            'Deleting .atm/history or .atm/runtime files directly before checking whether an active owner still holds them.'
        ],
        playbookNotes: [
            'residue status is read-only. It classifies active-owner, auto-clean-safe, block-and-reconcile, and manual-review buckets so a reconciler can act safely.',
            'residue reconcile is dry-run by default. --apply removes only non-staged, non-active-owner, disposable residue such as runtime push attempts or abandoned-task artifacts.',
            'Each entry reports indexState/sharedIndexRisk plus governance-lock or close-commit-window owner metadata so staged residue can be triaged without raw git inspection.'
        ]
    }
});

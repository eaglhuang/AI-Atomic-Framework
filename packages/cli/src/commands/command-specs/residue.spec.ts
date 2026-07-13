import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'residue',
  summary: 'Inspect ATM-managed worktree residue across tasks without deleting files.',
  positional: [
    { name: 'action', summary: 'status', required: false }
  ],
  options: [
    commonCwdOption,
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs residue status --json'
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
      'residue status is read-only. It classifies active-owner, auto-clean-safe, block-and-reconcile, and manual-review buckets so a later reconciler can act safely.'
    ]
  }
});

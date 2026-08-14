import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'cleanup',
  summary: 'Diagnose or safely reconcile receipt-classified disposable residue.',
  positional: [
    { name: 'action', summary: 'diagnose | apply', required: false }
  ],
  options: [commonCwdOption, commonJsonOption, commonPrettyOption, commonHelpOption],
  examples: [
    'node atm.mjs cleanup diagnose --json',
    'node atm.mjs cleanup apply --json'
  ],
  help: {
    audience: 'operator',
    requiredFlagSets: [],
    relatedCommands: ['node atm.mjs residue status --json'],
    commonMistakes: ['Using raw deletion for active-owner or staged residue.'],
    playbookNotes: ['cleanup apply removes only receipt-classified, non-staged disposable residue and preserves foreign or active-owner files.']
  }
});

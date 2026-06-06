import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'bootstrap',
  summary: 'Create or refresh the default ATM bootstrap pack.',
  positional: [],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'text', summary: 'Override bootstrap task title (default: "Bootstrap ATM in this repository").' },
    { flag: '--force', summary: 'Overwrite existing bootstrap files.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs bootstrap --cwd .',
    'node atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"'
  ]
});

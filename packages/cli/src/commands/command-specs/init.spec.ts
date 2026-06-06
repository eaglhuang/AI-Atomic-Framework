import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'init',
  summary: 'Adopt ATM in a repository.',
  options: [
    commonCwdOption,
    { flag: '--adopt', value: 'profile', summary: 'Adoption profile (default when flag is present without value: default).' },
    { flag: '--integration', value: 'id', summary: 'Install an integration adapter during init.' },
    { flag: '--task', value: 'text', summary: 'Bootstrap task title override.' },
    { flag: '--dry-run', summary: 'Preview init/adopt changes without writing files.' },
    { flag: '--force', summary: 'Overwrite existing config and bootstrap files.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs init --adopt default --json',
    'node atm.mjs init --integration claude-code --json'
  ]
});

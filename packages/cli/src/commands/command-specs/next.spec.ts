import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'next',
  summary: 'Recommend the next official ATM guidance action from current state.',
  options: [
    commonCwdOption,
    { flag: '--claim', summary: 'Claim the selected imported task as part of next-action routing.' },
    { flag: '--actor', value: 'id', summary: 'Actor id used for next --claim (or set ATM_ACTOR_ID).' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs next --json',
    'node atm.mjs next --cwd <host-repo> --json',
    'node atm.mjs next --claim --actor codex-main --json'
  ]
});

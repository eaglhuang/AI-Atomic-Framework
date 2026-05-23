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
    { flag: '--prompt', value: 'text', summary: 'Scope next-action routing to the current user prompt before falling back to global state.' },
    { flag: '--intent', value: 'path', summary: 'Read an atm.taskIntent.v1 JSON file produced by a trusted skill or integration hook.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs next --json',
    'node atm.mjs next --prompt "implement TASK-ABC-0001" --json',
    'node atm.mjs next --intent .atm/runtime/task-intent.json --json',
    'node atm.mjs next --cwd <host-repo> --json',
    'node atm.mjs next --claim --actor codex-main --prompt "implement TASK-ABC-0001" --json'
  ]
});

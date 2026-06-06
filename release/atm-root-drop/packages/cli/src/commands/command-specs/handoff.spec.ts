import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'handoff',
  summary: 'Write continuation summaries for governed work.',
  positional: [
    { name: 'action', summary: 'Currently supports: summarize', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Work item id to summarize.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs handoff summarize --task BOOTSTRAP-0001 --json'
  ]
});

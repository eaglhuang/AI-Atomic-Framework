import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'broker',
  summary: 'Manage write intents, check parallel safety, and inspect local write-broker registry.',
  positional: [
    { name: 'action', summary: 'register | decision | status | release | cleanup', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task ID to register or release.' },
    { flag: '--intent-file', value: 'path', summary: 'Path to WriteIntent JSON payload.' },
    { flag: '--ttl-seconds', value: 'number', summary: 'TTL lease duration in seconds for registering write intent.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs broker register --task TASK-GOV-0100 --intent-file intent.json --json',
    'node atm.mjs broker decision --intent-file intent.json --json',
    'node atm.mjs broker status --json',
    'node atm.mjs broker release --task TASK-GOV-0100 --json',
    'node atm.mjs broker cleanup --json'
  ]
});

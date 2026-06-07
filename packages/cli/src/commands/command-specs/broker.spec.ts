import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'broker',
  summary: 'Manage write intents, proposal capsules, and inspect the local write-broker registry.',
  positional: [
    { name: 'action', summary: 'register | decision | status | release | cleanup | proposal', required: true },
    { name: 'proposal-action', summary: 'create | list | show | validate', required: false },
    { name: 'proposal-id', summary: 'Proposal id for show / validate.', required: false }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task ID to register or release.' },
    { flag: '--intent-file', value: 'path', summary: 'Path to WriteIntent JSON payload.' },
    { flag: '--ttl-seconds', value: 'number', summary: 'TTL lease duration in seconds for registering write intent.' },
    { flag: '--proposal-file', value: 'path', summary: 'Path to PatchProposal JSON payload.' },
    { flag: '--store', value: 'path', summary: 'Path to broker proposal store JSON.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs broker register --task TASK-GOV-0100 --intent-file intent.json --json',
    'node atm.mjs broker decision --intent-file intent.json --json',
    'node atm.mjs broker status --json',
    'node atm.mjs broker release --task TASK-GOV-0100 --json',
    'node atm.mjs broker cleanup --json',
    'node atm.mjs broker proposal create --proposal-file proposal.json --json',
    'node atm.mjs broker proposal list --json',
    'node atm.mjs broker proposal show proposal-123 --json',
    'node atm.mjs broker proposal validate proposal-123 --json'
  ]
});


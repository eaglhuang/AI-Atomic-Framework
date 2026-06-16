import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'broker',
  summary: 'Manage write intents, proposal capsules, compose merge plans, runtime activation, steward apply, and inspect the local write-broker registry.',
  positional: [
    { name: 'action', summary: 'register | decision | status | release | cleanup | proposal | compose | steward | runtime | plan-batch', required: true },
    { name: 'proposal-action', summary: 'create | list | show | validate', required: false },
    { name: 'steward-action', summary: 'plan | apply', required: false },
    { name: 'runtime-action', summary: 'activate', required: false },
    { name: 'proposal-id', summary: 'Proposal id for show / validate.', required: false }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task ID to register or release.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for runtime activate.' },
    { flag: '--intent-file', value: 'path', summary: 'Path to WriteIntent JSON payload.' },
    { flag: '--ttl-seconds', value: 'number', summary: 'TTL lease duration in seconds for registering write intent.' },
    { flag: '--proposal-file', value: 'path', summary: 'Path to PatchProposal JSON payload. Repeatable for compose / steward.' },
    { flag: '--proposal-id', value: 'id', summary: 'Proposal id for compose / steward or proposal show / validate.' },
    { flag: '--merge-plan-file', value: 'path', summary: 'Path to MergePlan JSON payload for steward plan / apply.' },
    { flag: '--scope-file', value: 'path', summary: 'Scoped file-write target allowed for steward apply or runtime activate. Repeatable.' },
    { flag: '--steward-id', value: 'id', summary: 'Neutral write steward identifier.' },
    { flag: '--evidence-out', value: 'path', summary: 'Output path for steward apply or runtime activation evidence JSON.' },
    { flag: '--run-evidence-dir', value: 'path', summary: 'Directory to write broker batch run records (default: C:\\Users\\User\\3KLife\\docs\\ai_atomic_framework\\broker-collision-evidence\\runs).' },
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
    'node atm.mjs broker proposal validate proposal-123 --json',
    'node atm.mjs broker compose --proposal-file proposal-a.json --proposal-file proposal-b.json --json',
    'node atm.mjs broker compose --store .atm/runtime/broker-proposals.json --proposal-id proposal-a --proposal-id proposal-b --json',
    'node atm.mjs broker runtime activate --task TASK-GOV-0100 --actor team-planner --scope-file src/target.ts --json',
    'node atm.mjs broker runtime activate --task TASK-GOV-0100 --actor team-planner --merge-plan-file merge-plan.json --proposal-file proposal.json --scope-file src/target.ts --evidence-out runtime-evidence.json --json',
    'node atm.mjs broker steward plan --merge-plan-file merge-plan.json --proposal-file proposal.json --scope-file src/target.ts --json',
    'node atm.mjs broker steward apply --merge-plan-file merge-plan.json --proposal-file proposal.json --scope-file src/target.ts --evidence-out steward-evidence.json --json',
    'node atm.mjs broker plan-batch --request-file tmp/request-a.json --request-file tmp/request-b.json --apply --run-evidence-dir \"C:\\Users\\User\\3KLife\\docs\\ai_atomic_framework\\broker-collision-evidence\\runs\" --json'
  ]
});

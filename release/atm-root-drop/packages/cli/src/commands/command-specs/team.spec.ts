import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'team',
  summary: 'Plan, start, or validate scoped ATM team agents for a task. Validates permissions, leases, parallel CID advisor preflight, and broker lane routing for steward/composer paths.',
  positional: [
    { name: 'action', summary: 'Team action. Supports: plan, start, status, validate. Plan and start evaluate broker lanes and fail closed on blocked CID conflicts before a run starts.' }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id to plan, validate, or start a team for.' },
    { flag: '--recipe', value: 'id', summary: 'Optional team recipe id. Defaults to a language-aware built-in recipe.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for team start.' },
    { flag: '--team', value: 'id', summary: 'Team run id for status.' },
    { flag: '--compact', summary: 'Return a compact status payload.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs team plan --task TASK-TEAM-0002 --json',
    'node atm.mjs team plan --task TASK-TEAM-0003 --json',
    'node atm.mjs team validate --task TASK-AAO-0005 --recipe atm.default.normal.typescript --json',
    'node atm.mjs team start --task TASK-AAO-0005 --actor codex-main --json',
    'node atm.mjs team status --compact --json'
  ]
});

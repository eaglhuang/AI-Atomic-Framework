import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'route',
  summary: 'Manage MAO route lifecycle records and legacy steward takeover. route pause exercises the broker freeze protocol and records a metadata-only patch envelope handoff sidecar; route handoff validates or compares envelopes without worktree apply. Worktree patch apply remains out of scope.',
  positional: [
    { name: 'action', summary: 'open | status | list | pause | resume | abandon | handoff | takeover', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--route', value: 'id', summary: 'Route context id for status, pause, resume, abandon, or handoff.' },
    { flag: '--route-id', value: 'id', summary: 'Explicit route context id when opening a route.' },
    { flag: '--task', value: 'id', summary: 'Task id for route open.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for route open or lifecycle transition.' },
    { flag: '--claim-intent', value: 'intent', summary: 'Route claim intent: read, write, review, steward, or release-sync.' },
    { flag: '--read-set', value: 'csv', summary: 'Comma-separated declared read files.' },
    { flag: '--write-set', value: 'csv', summary: 'Comma-separated declared write files.' },
    { flag: '--atom-cids', value: 'csv', summary: 'Comma-separated target atom CIDs.' },
    { flag: '--virtual-atom-cids', value: 'csv', summary: 'Comma-separated target virtual atom CIDs.' },
    { flag: '--patch-envelope-ref', value: 'ref', summary: 'Optional patch envelope file for route handoff compare.' },
    { flag: '--reason', value: 'text', summary: 'Reason for pause, resume, abandon, or handoff.' },
    { flag: '--admission-rechecked', summary: 'For route resume: confirm broker admission was re-checked before continuing after a freeze.' },
    { flag: '--ttl-seconds', value: 'seconds', summary: 'Route lease TTL in seconds.' },
    { flag: '--max-seconds', value: 'seconds', summary: 'Route lease maximum lifetime in seconds.' },
    { flag: '--merge-plan-file', value: 'path', summary: 'Path to merge plan file.' },
    { flag: '--proposal-file', value: 'path', summary: 'Path to patch proposal file.' },
    { flag: '--steward-id', value: 'name', summary: 'Steward identity name.' },
    { flag: '--evidence-out-path', value: 'path', summary: 'Path to save apply evidence.' },
    { flag: '--scope-files', value: 'csv', summary: 'Comma-separated scoped files.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs route open --task TASK-MAO-0003 --actor captain --write-set packages/cli/src/commands/route.ts',
    'node atm.mjs route status --route route-TASK-MAO-0003-captain',
    'node atm.mjs route pause --route route-TASK-MAO-0003-captain --actor captain --reason review',
    'node atm.mjs route handoff --route route-TASK-MAO-0003-captain --actor captain --patch-envelope-ref .atm/runtime/routes/route-TASK-MAO-0003-captain.patch-envelope.json',
    'node atm.mjs route resume --route route-TASK-MAO-0003-captain --actor captain --admission-rechecked',
    'node atm.mjs route abandon --route route-TASK-MAO-0003-captain --actor captain --reason superseded',
    'node atm.mjs route takeover --merge-plan-file plan.json --proposal-file prop.json'
  ]
});

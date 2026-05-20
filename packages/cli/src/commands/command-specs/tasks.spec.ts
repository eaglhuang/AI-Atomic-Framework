import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'tasks',
  summary: 'Import/verify task plans, manage reservation/claim lifecycle, and close tasks with evidence gates.',
  positional: [
    { name: 'action', summary: 'import | verify | reserve | promote | claim | renew | release | handoff | takeover | close', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--from', value: 'path', summary: 'Markdown plan path for tasks import.' },
    { flag: '--dry-run', summary: 'Parse the plan and emit a manifest without writing task files.' },
    { flag: '--write', summary: 'Write canonical task JSON files to .atm/history/tasks/ and persist import evidence.' },
    { flag: '--force', summary: 'Overwrite existing task files even when the source hash differs.' },
    { flag: '--task', value: 'id', summary: 'Task id for reserve/promote/claim/renew/release/handoff/takeover/close.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for reservation/claim/close lifecycle actions (or set ATM_ACTOR_ID).' },
    { flag: '--title', value: 'text', summary: 'Optional title for tasks reserve when creating a manual task entry.' },
    { flag: '--files', value: 'csv', summary: 'Comma-separated scope files for claim/takeover lock acquisition.' },
    { flag: '--ttl-seconds', value: 'number', summary: 'Lease ttl in seconds for claim/renew/takeover.' },
    { flag: '--to', value: 'id', summary: 'Target actor id for handoff.' },
    { flag: '--status', value: 'state', summary: 'Target status for tasks close: done|review|blocked|abandoned.' },
    { flag: '--reason', value: 'text', summary: 'Reason for release, handoff, takeover, or close.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs tasks import --from docs/plan.md --dry-run --json',
    'node atm.mjs tasks import --from docs/plan.md --write --json',
    'node atm.mjs tasks verify --json',
    'node atm.mjs tasks reserve --task ATM-GOV-0101 --actor codex-main --title "Actor model" --json',
    'node atm.mjs tasks promote --task ATM-GOV-0101 --actor codex-main --json',
    'node atm.mjs tasks claim --task ATM-GOV-0101 --actor codex-main --files packages/core/src/index.ts --json',
    'node atm.mjs tasks renew --task ATM-GOV-0101 --actor codex-main --ttl-seconds 3600 --json',
    'node atm.mjs tasks release --task ATM-GOV-0101 --actor codex-main --reason "handoff complete" --json',
    'node atm.mjs tasks close --task ATM-GOV-0104 --actor codex-main --status done --json'
  ]
});

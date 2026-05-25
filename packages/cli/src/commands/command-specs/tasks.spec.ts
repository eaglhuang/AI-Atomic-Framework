import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'tasks',
  summary: 'Create/import/mirror/verify/audit task plans, manage prompt-scoped queues and claim lifecycle, migrate legacy ledger records, and close tasks with evidence gates.',
  positional: [
    { name: 'action', summary: 'create | import | mirror | verify | audit | queue | lock | migrate-legacy-ledger | reserve | promote | reset | claim | renew | release | handoff | takeover | block | abandon | close', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--from', value: 'path', summary: 'Markdown plan path for tasks import.' },
    { flag: '--dry-run', summary: 'Parse the plan and emit a manifest without writing task files.' },
    { flag: '--write', summary: 'Write canonical task JSON files to .atm/history/tasks/ and persist import evidence.' },
    { flag: '--force', summary: 'Overwrite existing task files even when the source hash differs.' },
    { flag: '--reset-open', summary: 'Rebuild matching imported tasks as open during tasks import --write.' },
    { flag: '--apply', summary: 'Apply tasks migrate-legacy-ledger changes instead of reporting a dry-run.' },
    { flag: '--all-stale', summary: 'Clean every stale runtime task lock candidate for tasks lock cleanup.' },
    { flag: '--reserved-ok', summary: 'Allow tasks release to return a reserved task with no active claim back to open.' },
    { flag: '--staged', summary: 'Run tasks audit in staged/pre-commit mode.' },
    { flag: '--queue', value: 'id', summary: 'Task queue id for tasks queue abandon.' },
    { flag: '--task', value: 'id', summary: 'Task id for reserve/promote/claim/renew/release/handoff/takeover/close.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for reservation/claim/close lifecycle actions (or set ATM_ACTOR_ID).' },
    { flag: '--title', value: 'text', summary: 'Optional title for tasks reserve when creating a manual task entry.' },
    { flag: '--provider', value: 'id', summary: 'External provider id for tasks mirror.' },
    { flag: '--origin-task', value: 'id', summary: 'External task id for tasks mirror.' },
    { flag: '--origin-url', value: 'url', summary: 'External task URL for tasks mirror.' },
    { flag: '--sync-status', value: 'state', summary: 'Mirror sync status for tasks mirror.' },
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
    'node atm.mjs tasks create --task ATM-GOV-0100 --actor codex-main --title "Governance task" --json',
    'node atm.mjs tasks mirror --provider github --origin-task 123 --origin-url https://github.com/org/repo/issues/123 --actor codex-main --json',
    'node atm.mjs tasks verify --json',
    'node atm.mjs tasks audit --json',
    'node atm.mjs tasks audit --staged --json',
    'node atm.mjs tasks queue status --json',
    'node atm.mjs tasks queue abandon --queue queue-abc123 --actor codex-main --json',
    'node atm.mjs tasks lock cleanup --all-stale --actor codex-main --json',
    'node atm.mjs tasks migrate-legacy-ledger --actor codex-main --dry-run --json',
    'node atm.mjs tasks migrate-legacy-ledger --actor codex-main --apply --json',
    'node atm.mjs tasks reserve --task ATM-GOV-0101 --actor codex-main --title "Actor model" --json',
    'node atm.mjs tasks promote --task ATM-GOV-0101 --actor codex-main --json',
    'node atm.mjs tasks reset --task ATM-GOV-0101 --actor codex-main --to open --reason "rollback cleanup" --json',
    'node atm.mjs tasks claim --task ATM-GOV-0101 --actor codex-main --files packages/core/src/index.ts --json',
    'node atm.mjs tasks renew --task ATM-GOV-0101 --actor codex-main --ttl-seconds 3600 --json',
    'node atm.mjs tasks release --task ATM-GOV-0101 --actor codex-main --reason "handoff complete" --json',
    'node atm.mjs tasks release --task ATM-GOV-0101 --actor codex-main --reserved-ok --reason "rollback cleanup" --json',
    'node atm.mjs tasks close --task ATM-GOV-0104 --actor codex-main --status done --json',
    'node atm.mjs tasks block --task ATM-GOV-0104 --actor codex-main --reason "waiting on target evidence" --json'
  ]
});

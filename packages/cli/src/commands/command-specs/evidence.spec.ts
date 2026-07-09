import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'evidence',
  summary: 'Run validators as governed evidence, add raw/manual evidence for close/commit/PR gates, author historical-batch envelopes that feed taskflow close, or finalize diagnostic historical-batch slices. Successful fresh evidence updates the per-task bundle manifest at .atm/history/evidence/<taskId>.bundle-manifest.json.',
  positional: [
    { name: 'action', summary: 'add | run | git-head-backfill | verify | diff | validators | missing | historical-batch | historical-batch-finalize', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id to append or verify evidence.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for evidence run/add (or set ATM_ACTOR_ID).' },
    { flag: '--kind', value: 'type', summary: 'Evidence kind for raw evidence add or evidence run: test|artifact|attestation|review|commit|waiver.' },
    { flag: '--summary', value: 'text', summary: 'Optional short evidence summary.' },
    { flag: '--artifacts', value: 'csv', summary: 'Optional artifact path list recorded with the evidence.' },
    { flag: '--freshness', value: 'type', summary: 'Raw evidence add freshness: fresh|historical-reference|draft (default: fresh).' },
    { flag: '--validators', value: 'csv', summary: 'Optional validator override. Omit when the command matches a known gate or a task-card declared validator; evidence run will auto-link it.' },
    { flag: '--command', value: 'text', summary: 'Command to run/capture. With evidence add this is raw metadata and also requires exit code plus sha256 outputs.' },
    { flag: '--command-runs', value: 'json-file', summary: 'Raw evidence add only: append commandRuns from a JSON array or {commandRuns:[]} cache file.' },
    { flag: '--exit-code', value: 'number', summary: 'Raw evidence add only: exit code paired with --command evidence.' },
    { flag: '--stdout-sha256', value: 'sha256', summary: 'Raw evidence add only: stdout digest paired with --command evidence.' },
    { flag: '--stderr-sha256', value: 'sha256', summary: 'Raw evidence add only: stderr digest paired with --command evidence.' },
    { flag: '--runner-kind', value: 'kind', summary: 'Runner kind for command proof: dev-source|frozen-runner|external.' },
    { flag: '--source-commit', value: 'sha', summary: 'Source commit paired with dev-source command proof.' },
    { flag: '--reason', value: 'text', summary: 'Optional rationale for git-head-backfill.' },
    { flag: '--gate', value: 'type', summary: 'Evidence gate for verify: close|commit|pr.' },
    { flag: '--list', summary: 'List all required validators with tier and current evidence state (used with validators action).' },
    { flag: '--recent-run', summary: 'Use the most recent cached command run if available in the task evidence (used with run action).' },
    { flag: '--tasks', value: 'csv', summary: 'Task ids to slice into per-task historical-batch close-readiness evidence.' },
    { flag: '--commits', value: 'csv', summary: 'Delivery commit refs that historical-batch will inspect and match back to the listed tasks.' },
    { flag: '--delivery-repo', value: 'path', summary: 'Repository that contains the historical delivery commits matched into the historical-batch envelope.' },
    { flag: '--validator-command', value: 'text', summary: 'Validator command to run once for a historical batch; repeatable. The resulting passes are shared into task slices for later close-readiness checks.' },
    { flag: '--write', summary: 'Write the historical-batch envelope plus per-task slices that tasks close / taskflow close can consume later.' },
    { flag: '--dry-run', summary: 'Preview historical-batch matching and close-readiness evidence without writing.' },
    { flag: '--allow-unmatched', summary: 'Allow diagnostic historical batches even when some tasks have no scoped commit match.' },
    { flag: '--approved-by', value: 'actor', summary: 'Required with --allow-unmatched: approver for diagnostic-only historical batch evidence.' },
    { flag: '--approval-reason', value: 'text', summary: 'Required with --allow-unmatched: justification for recording unmatched historical batch diagnostics.' },
    { flag: '--batch', value: 'id-or-path', summary: 'Historical-batch-finalize only: batch id or envelope path for the diagnostic slice disposition.' },
    { flag: '--disposition', value: 'type', summary: 'Historical-batch-finalize only: keep-diagnostic|abandon|remove-evidence for non-close-ready task slices.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs evidence run --task ATM-GOV-0104 --actor codex-main --command "npm run typecheck" --json',
    'node atm.mjs evidence run --task ATM-GOV-0104 --actor codex-main --command "npm run validate:cli" --validators validate:cli --recent-run --json',
    'node atm.mjs evidence run --task TASK-TEAM-0014 --actor codex-main --command "node atm.mjs team patrol --task TASK-TEAM-0014 --json" --json',
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --summary "raw artifact evidence" --artifacts reports/governance.json --json',
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --freshness fresh --command "npm run typecheck" --exit-code 0 --stdout-sha256 sha256:1111111111111111111111111111111111111111111111111111111111111111 --stderr-sha256 sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 --validators typecheck --json',
    'node atm.mjs evidence git-head-backfill --actor codex-main --reason "Backfill evidence for a pre-ATM HEAD commit" --json',
    'node atm.mjs evidence verify --task ATM-GOV-0104 --gate close --json',
    'node atm.mjs evidence validators --list --task ATM-GOV-0104 --json',
    'node atm.mjs evidence missing --task ATM-GOV-0104 --actor Augment --json',
    'node atm.mjs evidence historical-batch --tasks TASK-A,TASK-B --commits abc123,def456 --actor codex-main --validator-command "npm run validate:cli" --dry-run --json',
    'node atm.mjs evidence historical-batch --tasks TASK-A,TASK-B --commits abc123,def456 --actor codex-main --validators typecheck --validator-command "npm run typecheck" --write --json',
    'node atm.mjs evidence historical-batch --tasks TASK-A,TASK-B --commits abc123 --actor codex-main --validator-command "npm test" --allow-unmatched --approved-by captain --approval-reason "diagnostic backfill" --write --json',
    'node atm.mjs evidence historical-batch-finalize --task TASK-B --batch hist-batch-2026-06-16T01-40-43-634Z --actor codex-main --disposition keep-diagnostic --reason "partial slice kept for audit only" --write --json'
  ],
  help: {
    audience: 'agent',
    requiredFlagSets: [
      { when: 'Recording governed evidence for one task', flags: ['--task', '--actor'] },
      { when: 'Running a command-backed validator', flags: ['run', '--command'] },
      { when: 'Writing a diagnostic historical batch with unmatched tasks', flags: ['--allow-unmatched', '--approved-by', '--approval-reason'] },
      { when: 'Finalizing a diagnostic historical-batch slice', flags: ['historical-batch-finalize', '--task', '--batch', '--actor', '--disposition', '--reason'] }
    ],
    relatedCommands: [
      'node atm.mjs evidence validators --list --task TASK-ABC-0001 --json',
      'node atm.mjs taskflow pre-close --task TASK-ABC-0001 --actor <actor-id> --json',
      'node atm.mjs tasks status --task TASK-ABC-0001 --residue --json'
    ],
    commonMistakes: [
      'Manually typing validator names when evidence run can auto-link a declared validator from the command.',
      'Using raw evidence add as a substitute for fresh command-backed validation when the task requires validators.',
      'Writing historical-batch evidence without checking whether the matched commits actually cover the task deliverables.',
      'Trying to use historical-batch-finalize on a close-ready slice; close-ready slices must go through taskflow close.',
      'Treating git-head-backfill as a protected-push requirement instead of a repair/diagnostic tool for legacy HEAD evidence.'
    ],
    playbookNotes: [
      'evidence validators --list is the fastest way to see what a task still needs before closeout.',
      'Use --recent-run when a matching cached command run already exists and you only need to re-link it into the current evidence update.',
      'Use historical-batch-finalize to explicitly keep, abandon, or remove diagnostic-only historical-batch residue without changing task lifecycle state.',
      'git-head-backfill is retained for repair and audit trails; same-commit governed provenance should normally come from node atm.mjs git commit instead of a follow-up backfill.'
    ]
  }
});

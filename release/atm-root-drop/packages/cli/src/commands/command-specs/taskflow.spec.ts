import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'taskflow',
  summary: 'Official operator lane for governed task open and close. taskflow open is the normal opener lane; its dry-run returns a writeReadinessHint that names exactly what is missing when --write would fail closed. taskflow pre-close is the read-only first checkpoint before historical close --write; it reports scopeTrackedDirtyFiles, unexpectedStagedTasks, mixedDeliveryCommit, staleEvidence, autoEvidencePlan, and missingApprovalLease without mutating the worktree. taskflow close expands directory-style deliverables into explicit file manifests before metadata validation and stages optional evidence bundle manifests when present; it enforces validator scope taxonomy for close gates. taskflow close --write acquires an exclusive close-window staged-index lock before staging, blocks competing stage operations, and releases the lock on commit, rollback, or abort while surfacing closeWriteTransaction phase pending, committed, or rolled_back in JSON. taskflow close --auto-evidence runs missing declared validators through evidence run before backend close; explicit evidence --validators remains an override. Use task-view for a single-task read-only dashboard (status, evidence blockers, close completion checklist, next safe command) without replacing next routing. tasks new is a low-level template generator surface (no governed lifecycle). tasks import is the runtime synchronization surface (backend). Direct tasks close, tasks reconcile, tasks repair-closure are protected backend / emergency surfaces and must not be used as normal operator paths.',
  positional: [
    { name: 'action', summary: 'open | close | pre-close', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--dry-run', summary: 'Return the orchestration plan without writing. Default when --write is omitted.' },
    { flag: '--write', summary: 'Run the governed orchestration entry when prerequisites are satisfied; otherwise fail closed.' },
    { flag: '--no-commit', summary: 'For taskflow close --write: exact-stage the target and planning repo bundle, but do not commit. Auto-commit is on by default.' },
    { flag: '--profile', value: 'path', summary: 'Path to the taskflow profile JSON file.' },
    { flag: '--task', value: 'id', summary: 'Task id for taskflow close orchestration.' },
    { flag: '--actor', value: 'id', summary: 'Actor id required for taskflow close --write.' },
    { flag: '--task-id', value: 'id', summary: 'Explicit task id forwarded to the tasks new generation surface during governed open write.' },
    { flag: '--output', value: 'path', summary: 'Explicit markdown output path forwarded to the tasks new generation surface during governed open write.' },
    { flag: '--template', value: 'name', summary: 'Template key forwarded to tasks new (default: aao-l2-split).' },
    { flag: '--title', value: 'text', summary: 'Optional title forwarded to tasks new.' },
    { flag: '--roster-index', value: 'path', summary: 'Optional roster README path override for roster sync policy.' },
    { flag: '--historical-delivery', value: 'commit', summary: 'For taskflow close: verify an earlier delivery commit through tasks close or reconcile.', repeatable: true },
    { flag: '--delivery-commit', value: 'commit', summary: 'Alias for --historical-delivery on taskflow close.' },
    { flag: '--historical-batch', value: 'batchId-or-path', summary: 'For taskflow close: consume a task slice produced by evidence historical-batch, reuse its matched delivery commits, and treat the slice as the operator close-readiness source.' },
    { flag: '--waiver-out-of-scope-delivery', summary: 'For taskflow close with historical delivery or historical batch: allow a multi-task delivery commit when this task slice has matched deliverables; requires --reason.' },
    { flag: '--waive-out-of-scope', summary: 'Alias for --waiver-out-of-scope-delivery.' },
    { flag: '--defer-foreign-staged', summary: 'For taskflow close --write: snapshot and unstage foreign task governance files in the index before acquiring the close-window staged-index lock.' },
    { flag: '--defer-governance-dirty', summary: 'For taskflow close --write: snapshot, temporarily restore, and then reapply deferrable governance dirty files such as git-head evidence.' },
    { flag: '--defer-foreign-state', summary: 'Alias for --defer-foreign-staged plus --defer-governance-dirty.' },
    { flag: '--auto-evidence', summary: 'For taskflow close --write: auto-run missing task-card declared validators through evidence run before backend close. Dry-run and pre-close always expose autoEvidencePlan when --actor is supplied; --validators on evidence run remains an override for extra evidence.' },
    { flag: '--reason', value: 'text', summary: 'Required explanation for --waiver-out-of-scope-delivery.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs taskflow open --dry-run --json',
    'node atm.mjs taskflow open --dry-run --profile planning/taskflow.profile.json --json',
    'node atm.mjs taskflow open --write --profile planning/taskflow.profile.json --task-id TASK-ADOPTER-0002 --output tasks/TASK-ADOPTER-0002.task.md --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --dry-run --json',
    'node atm.mjs taskflow pre-close --task TASK-ADOPTER-0001 --actor codex-main --historical-delivery abc123 --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --historical-delivery abc123 --write --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --historical-batch hist-batch-2026-06-16T10-00-00-000Z --waiver-out-of-scope-delivery --reason "multi-task historical delivery" --write --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --historical-batch hist-batch-2026-06-16T10-00-00-000Z --dry-run --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --historical-batch hist-batch-2026-06-16T10-00-00-000Z --write --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --defer-foreign-staged --write --json',
    'node atm.mjs taskflow close --task TASK-ADOPTER-0001 --actor codex-main --defer-foreign-state --write --json',
  ]
});

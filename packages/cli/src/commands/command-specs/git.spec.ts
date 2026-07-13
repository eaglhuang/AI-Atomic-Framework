import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'git',
  summary: 'Prepare actor git identity, evaluate pre-push git admission, recover from rejected push attempts with a fresh admission rerun, create governed commits with actor-scoped author env vars, create narrow record-only commits for low-risk .atm/history maintenance, verify ATM git-governance trailers, resolve task-scoped commit bundles, query the status of the last governed commit attempt plus live branch queue owner diagnostics, and return copyable fallback plus host-git compatibility guidance when the wrapper cannot complete.',
  positional: [
    { name: 'action', summary: 'prepare | admit | push | recover-push-fail | check | commit | record-commit | commit-status', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for git identity and trailer checks.' },
    { flag: '--task', value: 'id', summary: 'Optional task id to enforce owner/claim/trailer consistency.' },
    { flag: '--branch', value: 'name', summary: 'Branch name for git admit/push; defaults to the current HEAD branch.' },
    { flag: '--remote', value: 'name', summary: 'Remote name for git admit/push; defaults to origin.' },
    { flag: '--no-fetch', summary: 'For git admit/push: do not fetch the remote branch before diffing.' },
    { flag: '--dry-run', summary: 'For git push: run admission and write push-attempt evidence without executing host git push.' },
    { flag: '--branch', value: 'name', summary: 'Branch name for git recover-push-fail; defaults to the current HEAD branch.' },
    { flag: '--remote', value: 'name', summary: 'Remote name for git recover-push-fail; defaults to origin.' },
    { flag: '--steward-plan', summary: 'For git admit composer-routed cases: emit a neutral steward dry-run merge plan without mutating files.' },
    { flag: '--apply-to-working-tree', summary: 'For git admit composer-routed cases: explicitly apply the steward merge result to scoped working-tree files without creating a commit.' },
    { flag: '--name', value: 'text', summary: 'Override git author name for prepare/commit; with --email, also seeds the actor runtime identity profile during prepare.' },
    { flag: '--email', value: 'text', summary: 'Override git author email for prepare/commit; with --name, also seeds the actor runtime identity profile during prepare.' },
    { flag: '--session', value: 'session-id', summary: 'Optional ATM work session id for check/commit alignment.' },
    { flag: '--message', value: 'text', summary: 'Commit summary for git commit; ATM appends governed trailers automatically.' },
    { flag: '--trailer', value: 'text', summary: 'Repeatable extra trailer line for git commit (e.g. an editor-injected Co-authored-by line); folded into the governed trailer set instead of failing the commit.' },
    { flag: '--auto-stage', summary: 'Stage only the current task allowed delivery bundle before commit; report skipped external dirty files without using git add .' },
    { flag: '--defer-foreign-staged', summary: 'Snapshot and unstage foreign task governance files already in the index before resolving the bundle; never silent.' },
    { flag: '--dry-run', summary: 'Resolve the task-scoped commit bundle without staging or committing; for record-commit, validate the staged record-only scope without mutating HEAD.' },
    { flag: '--no-verify', summary: 'Emergency-only pass-through to git commit; requires --emergency-approval with backend.gitHookBypass permission and cannot override Team Broker conflicts by itself.' },
    { flag: '--emergency-approval', value: 'leaseId', summary: 'Required when --no-verify is used; must authorize backend.gitHookBypass.' },
    { flag: '--broker-conflict-override', value: 'leaseId', summary: 'High-authority override for Team Broker cross-task conflicts; must authorize backend.brokerConflictOverride and be paired with --broker-conflict-resolution.' },
    { flag: '--broker-conflict-resolution', value: 'path', summary: 'Paper-style Team Broker conflict-resolution artifact proving conflict task id, shared paths, resolution order, and validator plan.' },
    { flag: '--reason', value: 'text', summary: 'Human-readable reason for the governed hook bypass when using --no-verify.' },
    { flag: '--no-trailers', summary: 'Skip trailer checks in git check (identity/owner checks still run).' },
    { flag: '--timeout-ms', value: 'ms', summary: 'For git commit: override the default 420000ms timeout for the underlying git commit spawn (also settable via ATM_GIT_COMMIT_TIMEOUT_MS); a hung pre-commit hook fails as a retryable timeout instead of hanging forever.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs git prepare --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git prepare --actor codex-main --name "Codex Main" --email codex-main@atm.local --json',
    'node atm.mjs git admit --actor codex-main --branch main --remote origin --json',
    'node atm.mjs git push --actor codex-main --branch main --remote origin --dry-run --json',
    'node atm.mjs git push --actor codex-main --branch main --remote origin --json',
    'node atm.mjs git admit --actor codex-main --branch main --remote origin --steward-plan --json',
    'node atm.mjs git admit --actor codex-main --branch main --remote origin --apply-to-working-tree --json',
    'node atm.mjs git recover-push-fail --actor codex-main --branch main --remote origin --json',
    'node atm.mjs git check --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git check --actor codex-main --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0036 --message "atm: sync TASK-AAO-0036 ledger mirror" --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0063 --message "atm: restore TASK-AAO-0063 historical ledger packet" --json',
    'node atm.mjs git commit --actor codex-main --task ATM-GOV-0105 --message "complete ATM-GOV-0105" --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0141 --message "feat: scoped deliverable" --auto-stage --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0141 --message "feat: scoped deliverable" --dry-run --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0141 --message "feat: scoped deliverable" --auto-stage --timeout-ms 30000 --json',
    'node atm.mjs git record-commit --actor codex-main --message "atm: sync imported task records" --dry-run --json',
    'node atm.mjs git record-commit --actor codex-main --message "atm: sync imported task records" --json',
    'node atm.mjs git commit-status --actor codex-main --task TASK-AAO-0141 --json'
  ]
});

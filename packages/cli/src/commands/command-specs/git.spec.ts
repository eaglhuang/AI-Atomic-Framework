import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'git',
  summary: 'Prepare actor git identity, create governed commits with actor-scoped author env vars, verify ATM git-governance trailers, resolve task-scoped commit bundles, and return copyable fallback plus host-git compatibility guidance when the wrapper cannot complete.',
  positional: [
    { name: 'action', summary: 'prepare | check | commit', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for git identity and trailer checks.' },
    { flag: '--task', value: 'id', summary: 'Optional task id to enforce owner/claim/trailer consistency.' },
    { flag: '--name', value: 'text', summary: 'Override git author name for prepare/commit; with --email, also seeds the actor runtime identity profile during prepare.' },
    { flag: '--email', value: 'text', summary: 'Override git author email for prepare/commit; with --name, also seeds the actor runtime identity profile during prepare.' },
    { flag: '--session', value: 'session-id', summary: 'Optional ATM work session id for check/commit alignment.' },
    { flag: '--message', value: 'text', summary: 'Commit summary for git commit; ATM appends governed trailers automatically.' },
    { flag: '--auto-stage', summary: 'Stage only the current task allowed delivery bundle before commit; report skipped external dirty files without using git add .' },
    { flag: '--defer-foreign-staged', summary: 'Snapshot and unstage foreign task governance files already in the index before resolving the bundle; never silent.' },
    { flag: '--dry-run', summary: 'Resolve the task-scoped commit bundle without staging or committing.' },
    { flag: '--no-verify', summary: 'Emergency-only pass-through to git commit; requires --emergency-approval with backend.gitHookBypass permission.' },
    { flag: '--emergency-approval', value: 'leaseId', summary: 'Required when --no-verify is used; must authorize backend.gitHookBypass.' },
    { flag: '--reason', value: 'text', summary: 'Human-readable reason for the governed hook bypass when using --no-verify.' },
    { flag: '--no-trailers', summary: 'Skip trailer checks in git check (identity/owner checks still run).' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs git prepare --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git prepare --actor codex-main --name "Codex Main" --email codex-main@atm.local --json',
    'node atm.mjs git check --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git check --actor codex-main --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0036 --message "atm: sync TASK-AAO-0036 ledger mirror" --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0063 --message "atm: restore TASK-AAO-0063 historical ledger packet" --json',
    'node atm.mjs git commit --actor codex-main --task ATM-GOV-0105 --message "complete ATM-GOV-0105" --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0141 --message "feat: scoped deliverable" --auto-stage --json',
    'node atm.mjs git commit --actor codex-main --task TASK-AAO-0141 --message "feat: scoped deliverable" --dry-run --json'
  ]
});

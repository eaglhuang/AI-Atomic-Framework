# Adopter Git Boundary Setup and Runbook

This guide explains the local Git boundary MVP in operator terms.

Use it when an adopter repository wants to:

- install the ATM-managed local `pre-push` hook;
- verify that the hook still points at the current ATM CLI entrypoint;
- understand what `allow`, `block`, `composer-routed`, and post-push recovery
  mean in day-to-day Git work;
- explain to humans why this is a local collaboration aid and not a server-side
  enforcement guarantee.

## What the MVP is

The MVP is a local Git workflow aid.

- ATM can inspect local-vs-remote diffs before push.
- ATM can install a local `pre-push` hook that runs the same admission logic.
- ATM can explain whether the push is safe, blocked, or needs a deterministic
  merge helper.

The MVP is **not** a server-side policy substitute.

- A local hook can be disabled, deleted, or bypassed by the local operator.
- Protected branches, CI gates, and server-side policy are still the stronger
  deployment layer.
- Treat ATM local hooks as operator guidance plus evidence, not as tamper-proof
  enforcement.

## Setup Commands

Install the hook:

```bash
node atm.mjs integration hooks install git-pre-push --json
```

Verify the hook:

```bash
node atm.mjs integration hooks verify git-pre-push --json
```

Uninstall the hook:

```bash
node atm.mjs integration hooks uninstall git-pre-push --json
```

What verify means:

- `ok: true` means the hook exists, contains the ATM marker, and delegates to
  the current CLI entrypoint.
- `ok: false` means the hook is missing, drifted, or effectively disabled for
  MVP purposes.

## Daily Operator Flow

1. Verify the hook if the repository or CLI was recently moved or upgraded.
2. Run Git admission before push when you want a manual readout:

```bash
node atm.mjs git admit --actor <actor-id> --branch <branch> --remote origin --json
```

3. Push only when the result is `allow` or `no-op`.
4. If the result is `block` or `composer-routed`, follow the printed recovery
   path first.

## Outcome Examples

### Allow

Use when local work and remote work do not conflict in a meaningful way.

```bash
node atm.mjs git admit --actor codex-main --branch main --remote origin --json
```

Expected operator meaning:

- the push may continue;
- no deterministic merge helper is required;
- the hook should allow the push as well.

### Block

Use when ATM reports a true overlap or protected conflict.

```bash
node atm.mjs git admit --actor codex-main --branch main --remote origin --json
```

Expected operator meaning:

- stop the push;
- inspect the conflicting files and the recommended next step;
- rebase, split the work, or move through the governed conflict workflow before
  retrying.

### Composer-routed

Use when both sides touched the same file but ATM believes a deterministic merge
helper can reconcile the change.

Dry-run the steward/composer lane:

```bash
node atm.mjs git admit --actor codex-main --branch main --remote origin --steward-plan --json
```

Apply the governed working-tree result:

```bash
node atm.mjs git admit --actor codex-main --branch main --remote origin --apply-to-working-tree --json
```

Expected operator meaning:

- do not push directly yet;
- inspect the merge plan or apply result;
- rerun validation before retrying push.

### Post-push-fail recovery

Use when a real `git push` already failed and you want ATM to re-check the
branch against the refreshed remote state.

```bash
node atm.mjs git recover-push-fail --actor codex-main --branch main --remote origin --json
```

Expected operator meaning:

- ATM fetches the remote first;
- the result explains whether the failure now looks like non-fast-forward
  drift, a composer-routed same-file case, or a likely transient/no-op retry;
- follow the new recommendation instead of guessing from raw Git stderr.

## Bypass and Emergency Use

`git commit --no-verify` is not the normal fast path.

Use the ATM wrapper only when a human approved the emergency lane:

```bash
node atm.mjs git commit --actor <actor-id> --task <task-id> --message "<summary>" --no-verify --emergency-approval <lease-id> --reason "<why>" --json
```

Normal expectations:

- prefer fixing the hook failure and committing without bypass;
- use bypass only when the failure is understood and waiting would block
  governed recovery;
- audit or follow up after the emergency lane is used.

## Troubleshooting

Hook verify says missing:

- run `integration hooks install git-pre-push`;
- rerun `integration hooks verify git-pre-push --json`.

Hook verify says drifted:

- treat the hook as effectively disabled;
- reinstall it, then verify again.

Admission says `block`:

- do not push;
- inspect the listed conflicts and follow the recommended rebase or split path.

Admission says `composer-routed`:

- use `--steward-plan` or `--apply-to-working-tree`;
- rerun validators before push.

Push already failed:

- run `git recover-push-fail`;
- follow its recommendation instead of retrying blindly.

Need stronger enforcement:

- keep the local hook for operator feedback;
- add CI and branch protection in the host repository;
- do not claim the local hook alone is enough.

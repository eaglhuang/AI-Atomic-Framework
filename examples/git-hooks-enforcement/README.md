# Git Hooks Enforcement — Opt-in Host Recipe

This is an **opt-in host recipe**, not framework-managed behavior.

ATM itself stays advisory and host-neutral. The framework never installs these
hooks, never modifies `.git/hooks/`, and never assumes a host has adopted them.
Install them only in repositories where commits should be blocked when the
current Git history is not covered by ATM evidence.

The recipe is portable: host repositories may copy, adapt, or replace it as
long as they stay aligned with the contract documented in
[`docs/HOST_GOVERNANCE_INTEGRATION.md`](../../docs/HOST_GOVERNANCE_INTEGRATION.md).

## Install (manual, host-driven)

Run this from the repository root after ATM bootstrap has created `.atm/config.json`:

```bash
cp examples/git-hooks-enforcement/hooks/pre-commit .git/hooks/pre-commit
cp examples/git-hooks-enforcement/hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/pre-commit .git/hooks/post-commit
```

There is intentionally no `atm install-hooks` command. Hook installation must
be an explicit host action so the host repository remains in control of which
gates run on developer machines.

## Behavior

- `pre-commit` runs `node atm.mjs doctor --json` first.
- If staged files touch ATM framework critical source surfaces, the hook runs `node atm.mjs guard framework-development --files ... --json`.
- The hook runs `node atm.mjs tasks audit --json` so hand-edited `status: done`, missing closure packets, and static draft evidence cannot be committed as completion.
- If the current HEAD already lacks matching ATM evidence, the hook blocks the next commit.
- If HEAD is healthy, the hook records staged-tree evidence at `.atm/history/evidence/git-head.json` and stages that evidence file.
- `post-commit` runs `node atm.mjs doctor --json` again so the new HEAD is checked immediately.

The evidence uses Git tree identity plus parent commit identities because a pre-commit hook cannot know the new commit SHA before the commit exists.

## CI

Use the same shared gate in CI:

```bash
node atm.mjs doctor --json
node atm.mjs tasks audit --json
node atm.mjs guard framework-development --json
```

CI can fail on `ATM_DOCTOR_GIT_EVIDENCE_MISSING` to catch commits that bypassed local hooks.

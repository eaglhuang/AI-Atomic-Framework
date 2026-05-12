# Git Hooks Enforcement Example

This example shows how a host repository can turn ATM guidance into a local Git gate.

ATM itself stays advisory and host-neutral. These hooks are opt-in host governance: install them only in repositories where commits should be blocked when the current Git history is not covered by ATM evidence.

## Install

Run this from the repository root after ATM bootstrap has created `.atm/config.json`:

```bash
cp examples/git-hooks-enforcement/hooks/pre-commit .git/hooks/pre-commit
cp examples/git-hooks-enforcement/hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/pre-commit .git/hooks/post-commit
```

## Behavior

- `pre-commit` runs `node atm.mjs doctor --json` first.
- If the current HEAD already lacks matching ATM evidence, the hook blocks the next commit.
- If HEAD is healthy, the hook records staged-tree evidence at `.atm/history/evidence/git-head.json` and stages that evidence file.
- `post-commit` runs `node atm.mjs doctor --json` again so the new HEAD is checked immediately.

The evidence uses Git tree identity plus parent commit identities because a pre-commit hook cannot know the new commit SHA before the commit exists.

## CI

Use the same shared gate in CI:

```bash
node atm.mjs doctor --json
```

CI can fail on `ATM_DOCTOR_GIT_EVIDENCE_MISSING` to catch commits that bypassed local hooks.

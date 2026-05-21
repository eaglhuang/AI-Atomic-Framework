# Git Hooks Enforcement Recipe

This recipe is opt-in for adopter repositories and mandatory for ATM
framework-development.

ATM stays host-neutral for normal adopter work: it does not require hooks just
because a project uses ATM. When the target repository is the ATM framework and
critical non-doc source surfaces are being changed, ATM installs and verifies
the repo-local hard gate through `core.hooksPath=.atm/git-hooks`.

The recipe is portable: host repositories may copy, adapt, or replace it as
long as they stay aligned with the contract documented in
[`docs/HOST_GOVERNANCE_INTEGRATION.md`](../../docs/HOST_GOVERNANCE_INTEGRATION.md).

## Install

For an adopter repository that wants the same hard gate, copy the recipe or run:

```bash
node atm.mjs git-hooks install --json
```

For the ATM framework repository, editor integration install/verify also checks
these hooks:

```bash
node atm.mjs integration hooks install copilot --json
node atm.mjs integration hooks verify copilot --json
node atm.mjs git-hooks verify --framework-required --json
```

## Behavior

- `pre-commit` runs `node atm.mjs hook pre-commit --json`.
- The hook avoids running `doctor` before evidence is written, so the current
  HEAD evidence gap cannot deadlock a legitimate commit.
- If staged files touch ATM framework critical source surfaces, the hook runs
  framework-development detection, task audit, encoding/mojibake checks, and
  required validators.
- The hook runs `node atm.mjs tasks audit --json` semantics so hand-edited
  `status: done`, missing closure packets, and static draft evidence cannot be
  committed as completion.
- If checks pass, the hook records staged-tree evidence at
  `.atm/history/evidence/git-head.json` and stages that evidence file.
- `pre-push` or CI runs `node atm.mjs guard commit-range --base <ref> --head <ref> --json`
  to catch `--no-verify` or external commits that bypass local hooks.

The evidence uses Git tree identity plus parent commit identities because a
pre-commit hook cannot know the new commit SHA before the commit exists.

## CI

Use the same shared gate in CI:

```bash
node atm.mjs doctor --json
node atm.mjs tasks audit --json
node atm.mjs guard framework-development --json
node atm.mjs guard commit-range --base origin/main --head HEAD --json
```

CI can fail on `ATM_GUARD_COMMIT_RANGE_FAILED` to catch commits that bypassed
local hooks.

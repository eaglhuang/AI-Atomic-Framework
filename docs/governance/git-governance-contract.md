# Git Governance Contract

ATM git governance aligns actor identity, task claim ownership, and commit metadata.

## Commands

Prepare repo-local git identity:

```bash
node atm.mjs git prepare --task <task-id> --actor <actor-id> --json
```

When `git prepare` receives explicit `--name` and `--email` values, it also
seeds the repo runtime identity profile for that actor:

```bash
node atm.mjs git prepare --actor <actor-id> --name "Agent Name" --email agent@example.local --json
```

Check governance:

```bash
node atm.mjs git check --task <task-id> --actor <actor-id> --json
```

Optional relaxed mode (skip trailer checks, keep identity/owner checks):

```bash
node atm.mjs git check --task <task-id> --actor <actor-id> --no-trailers --json
```

## Required Trailers (default check)

- `ATM-Task: <task-id>`
- `ATM-Actor: <actor-id>`
- `ATM-Claim: <lease-id>` (when task claim exists)
- `ATM-Evidence: <reference>`

`git prepare` returns trailer hints so editors and humans can copy them into commit messages.
If `git commit` or the pre-commit hook still detects a missing ATM identity
profile, the failure includes a `requiredCommand` for `node atm.mjs identity set`
using the repo-local git `user.name` and `user.email` when available.

# Git Governance Contract

ATM git governance aligns actor identity, task claim ownership, and commit metadata.

## Commands

Prepare repo-local git identity:

```bash
node atm.mjs git prepare --task <task-id> --actor <actor-id> --json
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

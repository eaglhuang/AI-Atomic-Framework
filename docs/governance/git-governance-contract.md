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

## Scope Amendment Audit Lane

A claim locks a fixed list of `allowedFiles`. When linked surfaces appear during
the work (docs, help snapshots, tests, or generated artifacts), widen the scope
through the governed audit lane instead of editing the lock file by hand.

Normal audited lane — no emergency approval, fully recorded:

```bash
node atm.mjs tasks scope add \
  --task <task-id> \
  --actor <actor-id> \
  --add <comma-separated-paths> \
  --class <doc-sync|help-snapshot-sync|test-alignment|generated-artifact|linked-surface> \
  --phase <pre-implementation|during-implementation|closeout> \
  --reason "why the surface is linked" \
  --json
```

Each amendment records a `scope-amendment` event carrying its class, phase,
`mode: normal`, and reason, so a reviewer can tell why a scope grew and whether
it stayed inside the original intent. The amendment history stays visible in
`tasks status` and in the `taskflow close` close plan.

Emergency maintenance lane — protected, requires explicit approval:

```bash
node atm.mjs tasks scope repair \
  --task <task-id> \
  --actor <actor-id> \
  --add <comma-separated-paths> \
  --reason "documented governance exception" \
  --emergency-approval <lease-id> \
  --json
```

`tasks scope repair` records `mode: repair` and refuses to run without both
`--emergency-approval` and `--reason`. Use `tasks scope add` for ordinary linked
surfaces; reserve `tasks scope repair` for approved maintenance exceptions.

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

## Task-Scoped Commit Bundles

`git commit --task <id>` resolves a task-scoped bundle before writing. Use
`--dry-run` first to inspect `stageFiles`, `skippedExternalDirtyFiles`,
`unexpectedStagedTasks`, and a copyable host git command with trailers in the
message body.

Auto-stage only the current task lane:

```bash
node atm.mjs git commit \
  --task <task-id> \
  --actor <actor-id> \
  --message "<summary>" \
  --auto-stage \
  --json
```

When the index already contains another task's staged close bundle, defer it
explicitly instead of silently unstaging:

```bash
node atm.mjs git commit \
  --task <task-id> \
  --actor <actor-id> \
  --message "<summary>" \
  --defer-foreign-staged \
  --json
```

ATM executes git through `ATM_GIT_EXECUTABLE` when set, otherwise `git.exe` on
Windows, and always returns `copyableCommitCommand` using `-m` trailers when
host `--trailer` support is unavailable.

## Close Window Staged-Index Lock

`taskflow close --write` acquires an exclusive staged-index lock at
`.atm/runtime/locks/close-window-staged-index.lock.json` before any governed
staging begins. While the lock is active:

- Only the active close task may stage governed bundles.
- Foreign staged governance files block acquisition unless the operator defers
  them explicitly.
- The lock releases on committed close, rolled-back commit bundle, or aborted
  close.

Defer foreign staged governance files under operator control:

```bash
node atm.mjs taskflow close \
  --task <task-id> \
  --actor <actor-id> \
  --defer-foreign-staged \
  --write \
  --json
```

ATM snapshots deferred files under `.atm/runtime/snapshots/close-window-foreign-staged-*`
before unstaging them from the index. Do not silently unstage another agent's
close bundle outside this governed path.

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

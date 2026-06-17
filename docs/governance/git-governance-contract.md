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

### Foreign staged restore protocol

Use this when pre-close or the close-window lock reports `unexpectedStagedTasks`
or blocks acquisition because foreign governance bundles are already staged.

1. Read the owning task ids from JSON (`unexpectedStagedTasks`); do not infer
   from a raw `git status` alone.
2. Prefer waiting for the owning agent to finish its close window.
3. When you must proceed under operator control, defer explicitly:

```bash
node atm.mjs git commit \
  --task <your-task> \
  --actor <actor-id> \
  --defer-foreign-staged \
  --message "<delivery>" \
  --json
```

or during close:

```bash
node atm.mjs taskflow close \
  --task <your-task> \
  --actor <actor-id> \
  --defer-foreign-staged \
  --write \
  --json
```

4. ATM writes a snapshot under `.atm/runtime/snapshots/close-window-foreign-staged-*`
   before unstaging. After your commit or close completes, notify the deferred
   task owner so they can restage from the snapshot or their working tree.
5. Do not use broad `git restore --staged .` or `git checkout -- .` on governance
   paths. Do not delete defer snapshots until the owner confirms recovery.

`--defer-foreign-staged` is for known parallel close windows with a handoff plan.
It is not a substitute for fixing in-scope dirty files or obtaining waiver
approval for out-of-scope delivery.

Banned on the normal path: bare `git commit` for ledger mutations; silent
unstage of another task's bundle; claiming then closing while governance
artifacts remain dirty and uncommitted. See `docs/ATM_NEW_USER_WORKFLOW.md`
(Closeback operator runbook) for the full banned-pattern table.

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

## Lifecycle Owner and Claim Repair

Closeout has one lifecycle owner: the actor holding a **valid active claim** and
work session for the task. That owner alone may mutate scoped deliverables, add
command-backed evidence, and run `taskflow close --write`. Other agents remain
read-only unless the task is handed off, released, or repaired through governed
recovery.

Diagnose claim drift without mutation:

```bash
node atm.mjs tasks repair-claim --task <task-id> --actor <actor-id> --json
```

When the diagnosis reports repairable drift (expired lease, dangling lock,
stale `running` status without a claim, orphaned session) and **no valid
active claim blocks repair**, apply an auditable repair:

```bash
node atm.mjs tasks repair-claim \
  --task <task-id> \
  --actor <actor-id> \
  --write \
  --reason "documented drift recovery" \
  --json
```

`tasks repair-claim` records a `repair-claim` transition with before/after
claim state. It does not replace `taskflow close` and cannot silently take over
an active valid lease.

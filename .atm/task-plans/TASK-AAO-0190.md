---
task_id: TASK-AAO-0190
title: Fix taskflow close UX for auto-stage and --status migration
status: planned
priority: P2
owner: cursor-grok-4.5
depends_on: []
target_repo: C:\Users\User\AI-Atomic-Framework
closure_authority: target_repo
scope:
  - packages/cli/src/commands/tasks/scope-lock-diagnostics.ts
  - packages/cli/src/commands/taskflow/commit-bundle-assembly.ts
  - packages/cli/src/commands/shared.ts
  - packages/cli/src/commands/tasks/__tests__/scope-lock-diagnostics.test.ts
  - packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts
  - tests/cli/taskflow-status-migration-hint.test.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
out_of_scope:
  - release/**
  - scripts/run-validators.ts
  - tools_node/**
validators:
  - node --strip-types packages/cli/src/commands/tasks/__tests__/scope-lock-diagnostics.test.ts
  - node --strip-types tests/cli/taskflow-status-migration-hint.test.ts
  - npm run check:encoding:touched
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
backlog:
  - ATM-BUG-2026-07-12-151
---

# TASK-AAO-0190 — Fix taskflow close UX for auto-stage and --status migration

## Problem

`ATM-BUG-2026-07-12-151`:

1. `taskflow pre-close` / dirty-guard remediation suggests `node atm.mjs git commit ... --json` without `--auto-stage`, so the first attempt fails with `ATM_GIT_COMMIT_TASK_SCOPED_STAGING_REQUIRED`.
2. Passing low-level `--status done` to `taskflow close` produces a generic `ATM_CLI_USAGE` instead of a targeted migration hint.

## Goals

- Emit copy-paste-ready governed commit commands that include `--auto-stage` for target-repo remediation.
- When `taskflow` receives `--status`, print a migration hint that points operators to omit the flag on `taskflow close`, or use `tasks close --status ...` for the low-level backend lane.
- Cover both behaviors with focused regressions.

## Acceptance

- Dirty-guard `requiredCommand` includes `--auto-stage`.
- `commitCommandFor` target-repo hint includes `--auto-stage`.
- `node atm.dev.mjs taskflow close --task <id> --status done --json` returns `ATM_CLI_USAGE` with a migration hint naming `tasks close --status` / omit `--status` on taskflow.
- Validators listed above pass.

---
doc_id: doc_TASK-GIT-0036
task_id: TASK-GIT-0036
title: "Align sealed package publication membership and takeover evidence"
status: done
started_at: 2026-10-21T10:09:30Z
started_by_agent: codex-gpt-6
amendment_epoch: 1
owner: codex-gpt-6
priority: P2
depends_on:
[]
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/core/src/broker/runner-build-output-inventory.ts"
  - "packages/cli/src/commands/framework-development/runner-publication-evidence-context.ts"
  - "tests/cli/package-publication-membership.test.ts"
validators:
  - "node --strip-types tests/cli/package-publication-membership.test.ts"
  - "git diff --check"
deliverables:
  - "packages/core/src/broker/runner-build-output-inventory.ts"
  - "packages/cli/src/commands/framework-development/runner-publication-evidence-context.ts"
  - "tests/cli/package-publication-membership.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
completed_at: "2026-10-21T14:18:22.419Z"
completed_by_agent: "codex-gpt-6"
closedAt: "2026-10-21T14:18:22.419Z"
closedByActor: "codex-gpt-6"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T14-18-22-419Z-close-0a720e8e35c0"
lastTransitionAt: "2026-10-21T14:18:22.419Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "d4f5652b3ca9526e159f2e03f9d1caf4f4a95905"
---

# TASK-GIT-0036 - Align sealed package publication membership and takeover evidence

## Goal

Goal description placeholder

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-GIT-0036` and closed with `node atm.mjs taskflow close --task TASK-GIT-0036`.
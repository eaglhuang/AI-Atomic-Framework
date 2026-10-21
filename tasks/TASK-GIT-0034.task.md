---
doc_id: doc_TASK-GIT-0034
task_id: TASK-GIT-0034
title: "Keep close index snapshot failures inside the transaction boundary"
status: done
started_at: 2026-10-21T09:37:00Z
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
  - "packages/cli/src/commands/tasks/close-orchestrator/close-write.ts"
  - "docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-10-21-001.json"
validators:
  - "node --strip-types packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts"
  - "node --strip-types tests/cli/pre-team-foundation-gate.test.ts --mode validate"
  - "git diff --check"
deliverables:
  - "packages/cli/src/commands/tasks/close-orchestrator/close-write.ts"
  - "docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-10-21-001.json"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
completed_at: "2026-10-21T10:23:47.186Z"
completed_by_agent: "codex-gpt-6"
closedAt: "2026-10-21T10:23:47.186Z"
closedByActor: "codex-gpt-6"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T10-23-47-186Z-close-e2e16e290381"
lastTransitionAt: "2026-10-21T10:23:47.186Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "035aff404c425b159f4ddefd564a50ced44df817"
---

# TASK-GIT-0034 - Keep close index snapshot failures inside the transaction boundary

## Goal

Normalize git write-tree snapshot failure before ledger mutation; preserve injected lock, active claim and staged entries without touching unrelated cleanup WIP.

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-GIT-0034` and closed with `node atm.mjs taskflow close --task TASK-GIT-0034`.
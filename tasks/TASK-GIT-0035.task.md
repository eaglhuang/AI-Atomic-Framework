---
doc_id: doc_TASK-GIT-0035
task_id: TASK-GIT-0035
title: "Distinguish local planning projection from cross-authority close writes"
status: done
started_at: 2026-10-21T09:47:20Z
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
  - "packages/cli/src/commands/taskflow/close-orchestration.ts"
  - "packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts"
  - "tests/cli/target-owned-planning-route.test.ts"
validators:
  - "node --strip-types tests/cli/target-owned-planning-route.test.ts"
  - "node --strip-types packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts"
  - "git diff --check"
deliverables:
  - "packages/cli/src/commands/taskflow/close-orchestration.ts"
  - "packages/cli/src/commands/taskflow/__tests__/taskflow-close-crash-matrix.test.ts"
  - "tests/cli/target-owned-planning-route.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
completed_at: "2026-10-21T14:14:52.327Z"
completed_by_agent: "codex-gpt-6"
closedAt: "2026-10-21T14:14:52.327Z"
closedByActor: "codex-gpt-6"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T14-14-52-327Z-close-093a1d8eb400"
lastTransitionAt: "2026-10-21T14:14:52.327Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "299da0c48a1f9293fc782989250aec84b12695c7"
---

# TASK-GIT-0035 - Distinguish local planning projection from cross-authority close writes

## Goal

Allow local target-owned card projection; preserve external planning read-only behavior and align cross-authority crash fixture.

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-GIT-0035` and closed with `node atm.mjs taskflow close --task TASK-GIT-0035`.
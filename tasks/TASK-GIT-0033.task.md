---
doc_id: doc_TASK-GIT-0033
task_id: TASK-GIT-0033
title: "Recognize inherited merge-parent source in physical line admission"
status: in-progress
started_at: 2026-10-21T07:29:30Z
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
  - "packages/cli/src/commands/git-governance/commit-scope-policy.ts"
  - "tests/cli/merge-parent-line-budget.test.ts"
validators:
  - "node --experimental-strip-types tests/cli/merge-parent-line-budget.test.ts"
  - "git diff --check"
deliverables:
  - "packages/cli/src/commands/git-governance/commit-scope-policy.ts"
  - "tests/cli/merge-parent-line-budget.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
---

# TASK-GIT-0033 - Recognize inherited merge-parent source in physical line admission

## Goal

Use immutable immediate merge-parent trees as a bounded baseline for inherited source, while still rejecting actual source growth beyond the budget; reproduce PR734 without bypassing gates.

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-GIT-0033` and closed with `node atm.mjs taskflow close --task TASK-GIT-0033`.

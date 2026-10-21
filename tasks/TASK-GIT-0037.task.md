---
doc_id: doc_TASK-GIT-0037
task_id: TASK-GIT-0037
title: "Include local target-owned planning card in close bundle"
status: in-progress
started_at: 2026-10-21T14:03:30Z
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
  - "packages/cli/src/commands/taskflow/commit-bundle-assembly.ts"
  - "packages/cli/src/commands/taskflow/__tests__/commit-bundle-markdown-paths.spec.ts"
  - "tasks/TASK-GIT-0034.task.md"
validators:
  - "node --strip-types packages/cli/src/commands/taskflow/__tests__/commit-bundle-markdown-paths.spec.ts"
  - "git diff --check"
deliverables:
  - "packages/cli/src/commands/taskflow/commit-bundle-assembly.ts"
  - "packages/cli/src/commands/taskflow/__tests__/commit-bundle-markdown-paths.spec.ts"
  - "tasks/TASK-GIT-0034.task.md"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
---

# TASK-GIT-0037 - Include local target-owned planning card in close bundle

## Goal

Goal description placeholder

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-GIT-0037` and closed with `node atm.mjs taskflow close --task TASK-GIT-0037`.

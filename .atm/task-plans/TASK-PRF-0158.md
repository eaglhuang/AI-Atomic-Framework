---
doc_id: doc_TASK-PRF-0158
task_id: TASK-PRF-0158
title: "Repair PR384 duplicate import and unborn Git candidate discovery"
status: planned
owner: grok-bot
priority: P2
depends_on:
[]
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/git-governance/implementation/candidate-file-policy.ts"
  - "packages/cli/src/commands/git-governance/implementation/candidate-file-policy.spec.ts"
  - "packages/cli/src/commands/git-governance/implementation/sealed-commit-candidate-index.ts"
  - "packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts"
  - "tests/cli/taskflow-scope-untracked-glob.test.ts"
  - "packages/cli/dist/**"
  - "release/atm-onefile/**"
  - "release/atm-root-drop/**"
validators:
  - "npm run typecheck"
deliverables:
  - "packages/cli/src/commands/git-governance/implementation/candidate-file-policy.ts"
  - "packages/cli/src/commands/git-governance/implementation/candidate-file-policy.spec.ts"
  - "packages/cli/src/commands/git-governance/implementation/sealed-commit-candidate-index.ts"
  - "packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts"
  - "tests/cli/taskflow-scope-untracked-glob.test.ts"
  - "packages/cli/dist/**"
  - "release/atm-onefile/**"
  - "release/atm-root-drop/**"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
---

# TASK-PRF-0158 - Repair PR384 duplicate import and unborn Git candidate discovery

## Goal

Fix CI duplicate import and discover scoped candidate files in an unborn Git repository; regressions, typecheck, lint, sealed runner build, governed close.

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-PRF-0158` and closed with `node atm.mjs taskflow close --task TASK-PRF-0158`.

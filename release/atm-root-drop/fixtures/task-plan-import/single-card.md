---
task_id: TASK-FIXTURE-0001
title: Single-card import fixture
milestone: M1
status: open
blocked_by:
  - TASK-FIXTURE-0000
planning_repo: 3KLife
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/tasks.ts
  - packages/cli/src/commands/next.ts
planningReadOnlyPaths:
  - ../3KLife/docs/ai_atomic_framework/example/tasks/TASK-FIXTURE-0001.task.md
planningMirrorPaths:
  - docs/ai_atomic_framework/example/tasks/TASK-FIXTURE-0001.task.md
outOfScope:
  - .atm/runtime/**
nonGoals:
  - Rewrite the task lifecycle engine.
validators:
  - npm run validate:task-import
evidenceRequired: command-backed
rollbackStrategy: revert-commit
atomizationImpact:
  ownerAtomOrMap: atm.task-ledger-governance-map
  mapUpdates:
    - atomic_workbench/atomization-coverage/path-to-atom-map.json
tags: [fixture, single-card]
---

# TASK-FIXTURE-0001 Single-card import fixture

## Background

Used to verify that the import flow can ingest a task card written as a single
markdown document with YAML front matter.

## Acceptance Criteria

- [ ] Task id, title, milestone, status, and blocked_by parse correctly.
- [ ] Source trace recorded for the single-card heading.
- [ ] Importing twice without changes is idempotent.

## Deliverables

- imported task JSON
- import evidence JSON
- packages/cli/src/commands/tasks.ts
- scripts/validate-task-import.ts

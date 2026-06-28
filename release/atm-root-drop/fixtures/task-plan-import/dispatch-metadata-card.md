---
task_id: TASK-FIXTURE-DISPATCH-0001
title: Dispatch metadata preservation fixture
status: planned
assignee: "008"
planning_repo: 3KLife
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/tasks.ts
deliverables:
  - packages/cli/src/commands/tasks.ts
validators:
  - npm run validate:task-import
dispatch_pattern:
  shape: "dual-agent (Phase 0 planner + Phase 1 builder)"
  rationale: "Preserve compact dispatch metadata through tasks import."
  phase_0:
    lane: "helper (read-only sidecar)"
    allowed_files:
      - docs/ai_atomic_framework/team-agents/tasks/TASK-FIXTURE-DISPATCH-0001.task.md
    commit_budget: 0
    output: "Phase 1 brief"
  phase_1:
    lane: "external builder 008"
    allowed_files_strict: true
    forbidden_files:
      - C:/Users/User/3KLife/**
      - .atm/runtime/**
    commit_budget: 2
    commit_layout:
      - "commit_1: tasks import projection"
      - "commit_2: validator + map"
condition_review:
  - "dry-run manifest preserves dispatchPattern and conditionReview"
  - "write mode persists the same compact metadata"
---

# TASK-FIXTURE-DISPATCH-0001

## Goal

Verify dispatch metadata preservation during tasks import.

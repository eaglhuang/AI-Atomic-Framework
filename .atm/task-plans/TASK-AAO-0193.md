---
task_id: TASK-AAO-0193
title: Remind framework imports to author 3KLife planning cards first
status: in-progress
priority: P1
owner: cursor-grok-4.5
milestone: Backlog-P1
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
related_backlog: ATM-BUG-2026-07-13-176
planning_repo: 3KLife
planning_card: docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0193-planning-root-authorship-reminder.task.md
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/tasks/planning-root-authorship.ts
  - packages/cli/src/commands/tasks/import-orchestrator.ts
  - packages/cli/src/commands/tasks/legacy-impl.ts
  - packages/cli/src/commands/tasks/__tests__/planning-root-authorship.spec.ts
  - packages/cli/src/commands/command-specs/tasks.spec.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
deliverables:
  - packages/cli/src/commands/tasks/planning-root-authorship.ts
  - packages/cli/src/commands/tasks/import-orchestrator.ts
  - packages/cli/src/commands/tasks/legacy-impl.ts
  - packages/cli/src/commands/tasks/__tests__/planning-root-authorship.spec.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
validators:
  - node --strip-types packages/cli/src/commands/tasks/__tests__/planning-root-authorship.spec.ts
  - node --strip-types packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts
  - npm run check:encoding:touched
  - git diff --check
---

# TASK-AAO-0193

Canonical planning card:

`C:/Users/User/3KLife/docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0193-planning-root-authorship-reminder.task.md`

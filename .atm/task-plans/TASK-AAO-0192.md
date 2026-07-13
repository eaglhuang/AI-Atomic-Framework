---
task_id: TASK-AAO-0192
title: Allow abandoned task reopen without emergency --force
status: in-progress
priority: P1
owner: cursor-grok-4.5
milestone: Backlog-P1
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
related_backlog: ATM-BUG-2026-07-13-178
planning_repo: 3KLife
planning_card: docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0192-abandoned-reopen-without-emergency-force.task.md
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/tasks/legacy-impl.ts
  - packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
deliverables:
  - packages/cli/src/commands/tasks/legacy-impl.ts
  - packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
validators:
  - node --strip-types packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts
  - npm run check:encoding:touched
  - git diff --check
---

# TASK-AAO-0192

Canonical planning card:

`C:/Users/User/3KLife/docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0192-abandoned-reopen-without-emergency-force.task.md`

Backlog: `ATM-BUG-2026-07-13-178`

---
task_id: TASK-AAO-0191
title: Prevent defer-foreign-staged from absorbing ordinary-unowned staged files
status: done
priority: P1
owner: cursor-grok-4.5
milestone: Backlog-P1
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
related_backlog: ATM-BUG-2026-07-13-177
planning_repo: 3KLife
planning_card: docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0191-defer-foreign-staged-ordinary-unowned.task.md
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/git-governance.ts
  - tests/cli/git-commit-task-scoped-staging.test.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
deliverables:
  - packages/cli/src/commands/git-governance.ts
  - tests/cli/git-commit-task-scoped-staging.test.ts
  - docs/governance/atm-bug-and-optimization-backlog.md
outOfScope:
  - release/**
  - packages/cli/src/commands/residue.ts
  - Changing Broker conflict resolution semantics
  - Editing .atm/history or .atm/runtime by hand
validators:
  - node --strip-types tests/cli/git-commit-task-scoped-staging.test.ts
  - npm run check:encoding:touched
  - git diff --check
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert framework-claim isolated-index and mixed-scope fail-closed changes if legitimate live-index commits regress."
atomizationImpact:
  ownerAtomOrMap: atm.git-governance-map
  mapUpdates: []
  extractionCandidates:
    - disposition: inline
      path: packages/cli/src/commands/git-governance.ts
      inlineReason: "Bounded fix to framework-claim commit isolation and ordinary-unowned staged fail-closed/defer behavior."
---

# TASK-AAO-0191 Prevent defer-foreign-staged from absorbing ordinary-unowned staged files

Canonical planning card:

`C:/Users/User/3KLife/docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0191-defer-foreign-staged-ordinary-unowned.task.md`

Backlog: `ATM-BUG-2026-07-13-177`

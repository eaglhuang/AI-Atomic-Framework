---
doc_id: doc_TASK-AAO-0170
task_id: TASK-AAO-0170
title: "Harden scoped stale closure residue recovery"
status: planned
owner: atm-core
priority: P1
milestone: RFT-M
depends_on:
[]
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/framework-development/closure-packet-schema.ts"
  - "scripts/validators/task-ledger/suite-impl.ts"
validators:
  - "npm run validate:task-ledger-governance"
deliverables:
  - "packages/cli/src/commands/framework-development/closure-packet-schema.ts"
  - "scripts/validators/task-ledger/suite-impl.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the task changes fail validation or widen the accepted governance boundary."
atomizationImpact:
  ownerAtomOrMap: "atom-cli-taskflow"
  mapUpdates: []
outOfScope: []
nonGoals: []
---

# TASK-AAO-0170 - Harden scoped stale closure residue recovery

## Problem

Prove and repair main-worktree recovery for a done released task's stale close event beside unrelated active dirty delivery

## Acceptance

- Deliver the scoped change described by this task.
- Keep edits inside the declared scope unless the task is explicitly amended.
- Run the declared validator and record command-backed evidence before closeout.

## Implementation Notes

Scoped closure residue recovery

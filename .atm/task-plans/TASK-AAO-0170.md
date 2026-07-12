---
doc_id: doc_TASK-AAO-0170
task_id: TASK-AAO-0170
title: "Harden scoped stale closure residue recovery"
status: done
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
completed_at: "2026-07-12T12:46:52.470Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T12:46:52.470Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T12-46-52-470Z-close-fbcf40f13056"
lastTransitionAt: "2026-07-12T12:46:52.470Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "6795f7e785d887e7a9ae1336cb86410b820230e7"
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

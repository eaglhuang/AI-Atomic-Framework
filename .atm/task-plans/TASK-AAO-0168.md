---
doc_id: doc_TASK-AAO-0168
task_id: TASK-AAO-0168
title: "Guard source-first runner lifecycle mutations"
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
  - "packages/cli/src/commands/next.ts"
  - "packages/cli/src/commands/framework-development/closure-packet-schema.ts"
validators:
  - "npm run validate:cli"
deliverables:
  - "packages/cli/src/commands/next.ts"
  - "packages/cli/src/commands/framework-development/closure-packet-schema.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the task changes fail validation or widen the accepted governance boundary."
atomizationImpact:
  ownerAtomOrMap: "atom-cli-next"
  mapUpdates: []
outOfScope: []
nonGoals: []
completed_at: "2026-07-12T12:17:02.019Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T12:17:02.019Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T12-17-02-019Z-close-bff62318fde7"
lastTransitionAt: "2026-07-12T12:17:02.019Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "0245f6b989d35549390b1c41d11da3cce38aad08"
---

# TASK-AAO-0168 - Guard source-first runner lifecycle mutations

## Problem

Prevent atm.dev.mjs source-first routes from reaching lifecycle mutation attempts before failing

## Acceptance

- Deliver the scoped change described by this task.
- Keep edits inside the declared scope unless the task is explicitly amended.
- Run the declared validator and record command-backed evidence before closeout.

## Implementation Notes

Source-first runner lifecycle guard

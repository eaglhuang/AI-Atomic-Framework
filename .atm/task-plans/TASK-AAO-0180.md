---
doc_id: doc_TASK-AAO-0180
task_id: TASK-AAO-0180
title: "Sync role-provider parser backlog status"
status: planned
owner: atm-core
priority: P2
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
validators:
  - "git diff --check"
  - "npm run check:encoding:touched -- --files docs/governance/atm-bug-and-optimization-backlog.md .atm/task-plans/TASK-AAO-0180.md"
deliverables:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the backlog status sync if TASK-AAO-0177 does not fully cover the row."
atomizationImpact:
  ownerAtomOrMap: "atom-governance-backlog"
  mapUpdates: []
---

# TASK-AAO-0180 - Sync role-provider parser backlog status

## Problem

The role-provider parser backlog row remains marked as needing a task card even though TASK-AAO-0177 delivered and closed the parser fix.

## Acceptance

- Mark the role-provider parser backlog row as fixed in TASK-AAO-0177.
- Include the relevant delivery and closeout evidence in the row.
- Run the declared text/encoding validators and close through governed taskflow.

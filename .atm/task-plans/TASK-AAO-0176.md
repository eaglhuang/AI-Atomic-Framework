---
doc_id: doc_TASK-AAO-0176
task_id: TASK-AAO-0176
title: "Synchronize fixed backlog rows 119 and 144"
status: planned
owner: atm-governance
priority: P1
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
validators:
  - "git diff --check"
  - "npm run check:encoding:touched -- --files docs/governance/atm-bug-and-optimization-backlog.md"
deliverables:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert only the two status rows if their fix evidence is later found insufficient."
atomizationImpact:
  ownerAtomOrMap: "atom-governance-backlog"
  mapUpdates: []
---

# TASK-AAO-0176 - Synchronize fixed backlog rows 119 and 144

## Problem

Rows 119 and 144 still report Open/Needs task card even though TASK-AAO-0173 and TASK-AAO-0175 delivered and verified their fixes.

## Acceptance

- Mark row 119 fixed in TASK-AAO-0173 with its focused identity regression and typecheck evidence.
- Mark row 144 fixed in TASK-AAO-0175 with handoff route integration and ambiguity regression evidence.
- Preserve the existing follow-up wording where it remains useful and keep row 154/155 open as separate follow-up items.

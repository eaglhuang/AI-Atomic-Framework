---
doc_id: doc_TASK-AAO-0179
task_id: TASK-AAO-0179
title: "Record backlog continuation process friction"
status: planned
owner: atm-core
priority: P1
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
validators:
  - "git diff --check"
  - "npm run check:encoding:touched -- --files docs/governance/atm-bug-and-optimization-backlog.md .atm/task-plans/TASK-AAO-0179.md"
deliverables:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the backlog delivery commit if the new entries are inaccurate or duplicate existing backlog coverage."
atomizationImpact:
  ownerAtomOrMap: "atom-governance-backlog"
  mapUpdates: []
---

# TASK-AAO-0179 - Record backlog continuation process friction

## Problem

Backlog continuation work exposed multiple operator-facing ATM friction items while converting newly observed workflow problems into governed backlog entries.

## Acceptance

- Record the backlog continuation intent-routing failure with exact reproduction context.
- Record the claim option contract mismatch with exact reproduction context.
- Record the create-then-import drift and emergency-only overwrite trap.
- Record the taskflow-open profile readiness blocker in the framework repo.
- Keep the entries in the canonical ATM backlog, not in release incident files.
- Run the declared text/encoding validators and close through governed taskflow.

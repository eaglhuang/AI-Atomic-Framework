---
doc_id: doc_{{task_id}}
task_id: {{task_id}}
title: "{{title}}"
status: planned
owner: atm-core
priority: P1
milestone: RFT-M
depends_on:
{{depends_on_yaml}}
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "{{scope_path}}"
validators:
  - "{{test_path}}"
deliverables:
  - "{{scope_path}}"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the task changes fail validation or widen the accepted governance boundary."
atomizationImpact:
  ownerAtomOrMap: "{{atom_id}}"
  mapUpdates: []
outOfScope: []
nonGoals: []
---

# {{task_id}} - {{title}}

## Problem

{{goal}}

## Acceptance

- Deliver the scoped change described by this task.
- Keep edits inside the declared scope unless the task is explicitly amended.
- Run the declared validator and record command-backed evidence before closeout.

## Implementation Notes

{{capability}}

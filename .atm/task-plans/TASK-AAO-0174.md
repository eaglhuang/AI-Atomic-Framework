---
doc_id: doc_TASK-AAO-0174
task_id: TASK-AAO-0174
title: "Record closeout routing and validator readiness friction"
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
  notes: "Revert only the backlog row commit if the observed closeout friction is later consolidated into an existing item."
atomizationImpact:
  ownerAtomOrMap: "atom-governance-backlog"
  mapUpdates: []
---

# TASK-AAO-0174 - Record closeout routing and validator readiness friction

## Problem

During TASK-AAO-0173 closeout, the task-intent router classified a source-changing fix as closeout-only, the frozen runner rejected the write path only after dry-run, and the closure packet required `validate:git-head-evidence` even though pre-close marked it advisory.

## Acceptance

- Add durable backlog rows for the auto-intent misclassification and stale-runner write preflight gap.
- Add a durable backlog row for the mismatch between pre-close advisory classification and close-write closure requirements.
- Keep the entries distinct from existing rows 148 and 152 while linking their relationship in the notes.
- Encoding and diff checks pass.

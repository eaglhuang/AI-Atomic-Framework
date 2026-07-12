---
doc_id: doc_TASK-AAO-0172
task_id: TASK-AAO-0172
title: "Record validator and workflow friction in backlog"
status: done
owner: atm-core
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
  notes: "Revert the backlog delivery commit if the new entries are inaccurate."
atomizationImpact:
  ownerAtomOrMap: "atom-governance-backlog"
  mapUpdates: []
completed_at: "2026-07-12T12:54:00.001Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T12:54:00.001Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T12-54-00-001Z-close-a378d9dd2130"
lastTransitionAt: "2026-07-12T12:54:00.001Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "15ebea7035ac9d5ebbd3f57a6a4a745ba56ef2aa"
---

# TASK-AAO-0172 - Record validator and workflow friction in backlog

## Acceptance

- Record every newly observed validator or workflow friction item in the canonical ATM backlog.
- Keep backlog entries actionable with reproduction, expected behavior, and follow-up.
- Run the declared checks and close through taskflow.

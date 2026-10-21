---
doc_id: doc_TASK-PRF-0153
task_id: TASK-PRF-0153
title: 'Governance friction log: final statuses and late evidence'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0151
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0153.*
- .atm/history/task-events/TASK-PRF-0153/**
- .atm/history/tasks/TASK-PRF-0153.json
- .atm/task-plans/TASK-PRF-0153.md
- docs/governance/governance-friction-2026-10.md
- docs/governance/proposals/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
deliverables:
- docs/governance/governance-friction-2026-10.md
- docs/governance/proposals/governance-token-cost-proposals-2026-10.md
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- Design only. No product code. Hard proposals are implemented only after design review.
- Not paper text. Do not tag or publish npm.
completed_at: "2026-10-21T02:34:01.519Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T02:34:01.519Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T02-34-01-519Z-close-812defa6ee86"
lastTransitionAt: "2026-10-21T02:34:01.519Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "f3589f0af0c4ba34032bbda713677ee45677e0c1"
---

# TASK-PRF-0153 — friction log follow-up

## Authority and scope

Follow-up inside TASK-PRF-0151 (PR #380), 2026-10-21 (Asia/Taipei): add the TASK-PRF-0144 ignored-file evidence, the flaky-test evidence, F25/F26 and the merged status of #379. A closed task cannot take this commit (friction item F25).

## Acceptance

- Every observed issue has symptom, evidence (task id / commit), severity, daily flag and status.
- Each proposal has problem, approach, alternatives, risks and acceptance criteria.

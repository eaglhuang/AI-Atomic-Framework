---
doc_id: doc_TASK-PRF-0151
task_id: TASK-PRF-0151
title: 'Governance friction log and proposals (October 2026)'
status: done
owner: grok-bot
priority: P1
depends_on: []
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0151.*
- .atm/history/task-events/TASK-PRF-0151/**
- .atm/history/tasks/TASK-PRF-0151.json
- .atm/task-plans/TASK-PRF-0151.md
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
completed_at: "2026-10-21T01:13:18.744Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T01:13:18.744Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T01-13-18-744Z-close-1ec83bf37495"
lastTransitionAt: "2026-10-21T01:13:18.744Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "45e28e4ef6c1c165177f9bb8805d1c8b89a54465"
---

# TASK-PRF-0151 — governance friction log and proposals

## Authority and scope

Requested by the maintainer on 2026-10-21 (Asia/Taipei): list friction from using ATM's own governance during the paper-2.0 write-path fixes, with severity, daily-blocking flag, evidence and status; write design proposals for the hard items.

## Acceptance

- Every observed issue has symptom, evidence (task id / commit), severity, daily flag and status.
- Each proposal has problem, approach, alternatives, risks and acceptance criteria.

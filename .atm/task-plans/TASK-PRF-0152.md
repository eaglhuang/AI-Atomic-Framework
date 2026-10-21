---
doc_id: doc_TASK-PRF-0152
task_id: TASK-PRF-0152
title: 'Sealed rebuild of dist/onefile/root-drop after merging main (#378) into the governance quick-fix branch'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0150
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0152.*
- .atm/history/task-events/TASK-PRF-0152/**
- .atm/history/tasks/TASK-PRF-0152.json
- .atm/task-plans/TASK-PRF-0152.md
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
- node --strip-types scripts/preclose-check.ts
deliverables:
- release/atm-onefile/release-manifest.json
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- No source change. Do not tag or publish npm.
completed_at: "2026-10-21T02:06:01.254Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T02:06:01.254Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T02-06-01-254Z-close-156f88fd6f54"
lastTransitionAt: "2026-10-21T02:06:01.254Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "cc00da44f38abf98249fd89eb1bce4a47a25eb13"
---

# TASK-PRF-0152 — rebuild after merging main

## Authority and scope

Follow-up inside TASK-PRF-0150 (PR #379), 2026-10-21 (Asia/Taipei). Merging main (#378, 324a5877) conflicted only in generated dist/release files; a closed task cannot publish the runner, so this task rebuilds them. This is friction item F8 in docs/governance/governance-friction-2026-10.md.

## Acceptance

- Sealed build succeeds; line budget and help snapshot pre-close check pass.

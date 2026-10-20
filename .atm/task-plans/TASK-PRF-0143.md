---
doc_id: doc_TASK-PRF-0143
task_id: TASK-PRF-0143
title: 'Keep steward-transactional-apply inside the 600-line budget after #363'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0140
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0143.*
- .atm/history/task-events/TASK-PRF-0143/**
- .atm/history/tasks/TASK-PRF-0143.json
- .atm/task-plans/TASK-PRF-0143.md
- PROGRESS.md
- packages/core/src/broker/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
- node --strip-types tests/core/stale-base-translation.test.ts
- node --strip-types scripts/validate-broker-steward.ts
deliverables:
- packages/core/src/broker/steward-transactional-apply.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- No behaviour change to stale-base translation.
- Do not re-pin the hist-v2 smoke runbook. Do not tag or publish npm.
completed_at: "2026-10-20T17:37:15.346Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-20T17:37:15.346Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-20T17-37-15-346Z-close-ad8eca5418fd"
lastTransitionAt: "2026-10-20T17:37:15.346Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "2c9e7c7b8"
---

# TASK-PRF-0143 — line-budget follow-up for #363

## Authority and scope

This is a follow-up inside the user-approved #363 work (PR #377) on 2026-10-21 (Asia/Taipei). After main was merged, Product CI failed the hard 600-line physical budget: `packages/core/src/broker/steward-transactional-apply.ts` reached 602 lines.

## Design

- Compact a comment and one try/catch in `translateStaleProposals` without changing behaviour; the file drops to 595 lines.
- Rebuild the sealed dist, onefile and root-drop.

## Acceptance

- `physical-line-budget-gate` passes. Stale-base translation and broker-steward still pass.

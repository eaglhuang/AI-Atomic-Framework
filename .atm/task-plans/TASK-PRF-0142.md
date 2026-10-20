---
doc_id: doc_TASK-PRF-0142
task_id: TASK-PRF-0142
title: 'Keep claim-orchestrator inside the 600-line budget after the #373 renew guard'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0141
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0142.*
- .atm/history/task-events/TASK-PRF-0142/**
- .atm/history/tasks/TASK-PRF-0142.json
- .atm/task-plans/TASK-PRF-0142.md
- PROGRESS.md
- packages/cli/src/commands/tasks/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/rft-atomization-rollout.test.ts
- node --strip-types tests/cli/physical-line-budget-gate.test.ts
- node --strip-types tests/cli/taskflow-close-recovery.test.ts
deliverables:
- packages/cli/src/commands/tasks/renew-close-guard.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; the guard goes back inline in claim-orchestrator.
nonGoals:
- No behaviour change to tasks renew.
- Do not tag or publish npm.
completed_at: "2026-10-20T16:23:21.778Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-20T16:23:21.778Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-20T16-23-21-778Z-close-a7e3a7b32d16"
lastTransitionAt: "2026-10-20T16:23:21.778Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "fce2b9c75"
---

# TASK-PRF-0142 — line-budget follow-up for #373

## Authority and scope

This is a follow-up inside the user-approved #373 work (PR #376) on 2026-10-21 (Asia/Taipei). Product CI failed the hard 600-line atomization budget: the renew guard pushed `packages/cli/src/commands/tasks/claim-orchestrator.ts` to 655 lines.

## Design

- Move `assertRenewAllowedForCloseState` into `packages/cli/src/commands/tasks/renew-close-guard.ts`. claim-orchestrator keeps a one-line call and stays at 600 lines.
- Rebuild the sealed dist, onefile and root-drop so they match the source.

## Acceptance

- `rft-atomization-rollout` and `physical-line-budget-gate` pass. The #373 recovery tests still pass.

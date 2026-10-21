---
doc_id: doc_TASK-PRF-0145
task_id: TASK-PRF-0145
title: 'Refresh the broker --help snapshot for --ack-overlap (#360 follow-up)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0144
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0145.*
- .atm/history/task-events/TASK-PRF-0145/**
- .atm/history/tasks/TASK-PRF-0145.json
- .atm/task-plans/TASK-PRF-0145.md
- PROGRESS.md
- tests/cli-fixtures/help-snapshots/broker.json
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types scripts/validate-cli.ts --mode test
deliverables:
- tests/cli-fixtures/help-snapshots/broker.json
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- No behaviour change. Do not re-pin the hist-v2 smoke runbook. Do not tag or publish npm.
completed_at: "2026-10-21T00:17:51.930Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T00:17:51.930Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T00-17-51-930Z-close-96294813e16f"
lastTransitionAt: "2026-10-21T00:17:51.930Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "d97d35dd3ac6c6dd6eb68a9da8f5703796e5e68e"
---

# TASK-PRF-0145 — broker help snapshot follow-up for #360

## Authority and scope

Follow-up inside the user-approved #360 work (PR #378) on 2026-10-21 (Asia/Taipei). ATM Dogfood failed `validate-cli --mode test`: the `broker --help` usage snapshot does not list the new `--ack-overlap` flag.

## Design

- Regenerate `tests/cli-fixtures/help-snapshots/broker.json` from the CLI's own `broker --help` usage evidence; rebuild the sealed dist and root-drop mirror.

## Acceptance

- `validate-cli --mode test` passes.

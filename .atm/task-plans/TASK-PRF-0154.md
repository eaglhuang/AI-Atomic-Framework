---
doc_id: doc_TASK-PRF-0154
task_id: TASK-PRF-0154
title: 'Smoke kit preflight: run live-write-journal parity on Node 22 (#364 follow-up)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0146
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0154.*
- .atm/history/task-events/TASK-PRF-0154/**
- .atm/history/tasks/TASK-PRF-0154.json
- .atm/task-plans/TASK-PRF-0154.md
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- research/paper-v2/prereg-v3-smoke/kit/test/**
validators:
- bash research/paper-v2/prereg-v3-smoke/kit/preflight.sh
deliverables:
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit.
nonGoals:
- Do not re-pin the smoke runbook. Do not tag or publish npm.
completed_at: "2026-10-21T04:21:17.717Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-21T04:21:17.717Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-21T04-21-17-717Z-close-4cc028a069cd"
lastTransitionAt: "2026-10-21T04:21:17.717Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "d2035717ceb82275d8ebd91c156b8a798333d619"
---

# TASK-PRF-0154 — kit preflight parity check on Node 22

PR #381 CI job "Smoke kit preflight" (Node 22) fails: `node --strip-types` is not a Node 22 option, so the live-write-journal-parity check added by TASK-PRF-0146 aborts. Use a flag that works on Node 22 and 24. Code by the box Codex CLI.

## Acceptance
- preflight.sh passes on Node 22 and Node 24.

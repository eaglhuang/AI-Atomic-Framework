---
doc_id: doc_TASK-PRF-0158
task_id: TASK-PRF-0158
title: Preserve packaged quickfix behavior while removing ignored publication extras
status: done
owner: grok-bot
priority: P1
depends_on: []
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0158.*
- .atm/history/task-events/TASK-PRF-0158/**
- .atm/history/tasks/TASK-PRF-0158.json
- .atm/task-plans/TASK-PRF-0158.md
- .atm/task-plans/TASK-PRF-0157.md
- PROGRESS.md
- docs/governance/governance-friction-2026-10.md
- packages/cli/src/commands/taskflow/host-opener-policy.ts
- packages/cli/src/commands/taskflow/origin-task-ids.ts
- packages/cli/src/commands/plan.ts
- scripts/sealed-runner-claim-preflight.ts
- scripts/sealed-runner-publication.ts
- scripts/run-sealed-runner-build.ts
- tests/cli/origin-task-ids.test.ts
- tests/cli/sealed-runner-claim-preflight.test.ts
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/origin-task-ids.test.ts
- node --strip-types tests/cli/sealed-runner-claim-preflight.test.ts
- npm run typecheck
- npm run preclose:check
deliverables:
- packages/cli/src/commands/taskflow/host-opener-policy.ts
- scripts/sealed-runner-publication.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert follow-up commit.
completed_at: "2026-10-22T06:52:43.623Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-22T06:52:43.623Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-22T06-52-43-623Z-close-dbd719e89de2"
lastTransitionAt: "2026-10-22T06:52:43.623Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "e9e278d081dec14fdd32cfee42e63c8b8b872673"
---

# TASK-PRF-0158

## Acceptance

- Embed the task-ID scan and build claim preflight into existing tracked modules so removing newly tracked ignored artifacts cannot break packaged imports.
- Existing task-ID, two-session and claim lifetime regressions still pass, along with typecheck, eslint, publication lifecycle and preclose.
- Rebuild with this publication task, obtain runner-sync receipt, frozen smoke and normal governed close.
- Remove accidentally tracked ignored output from index in a governed follow-up commit while preserving physical build artifacts.

## Opening decision

TASK-PRF-0157 closed successfully but its broad release scope force-added 487 previously ignored outputs, including new executable helper modules. Removing those executable modules alone would break package imports. Consolidate helpers into existing modules first, then clean tracking. No new shared-write gate is introduced; normal runner-sync owns artifact publication. Stop on failed regression or unresolved authority.
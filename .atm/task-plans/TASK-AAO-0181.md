---
doc_id: doc_TASK-AAO-0181
task_id: TASK-AAO-0181
title: "Fix auto-intent claim delivery detection"
status: done
owner: atm-core
priority: P1
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/tasks/claim-intent.ts"
  - "tests/cli/tasks-claim-auto-intent.test.ts"
validators:
  - "node --strip-types tests/cli/tasks-claim-auto-intent.test.ts"
  - "npm run typecheck"
  - "npm run validate:cli"
deliverables:
  - "packages/cli/src/commands/tasks/claim-intent.ts"
  - "tests/cli/tasks-claim-auto-intent.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the claim intent resolver and regression test changes if auto-intent becomes too conservative for closeout-only claims."
atomizationImpact:
  ownerAtomOrMap: "atm.cli-tasks-claim-intent"
  mapUpdates: []
completed_at: "2026-07-12T13:46:42.111Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T13:46:42.111Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T13-46-42-111Z-close-39ba2d2919c4"
lastTransitionAt: "2026-07-12T13:46:42.111Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "973f854025b7c5390e16a51d51ae07543e9449e6"
---

# TASK-AAO-0181 - Fix auto-intent claim delivery detection

## Problem

Backlog row `ATM-BUG-2026-07-12-153` reports that `next --claim --auto-intent` can classify a source-changing backlog task as `closeout-only` before any task delivery commit exists. The current resolver treats declared non-`.atm` deliverables that already exist in `HEAD` as delivered, but source files often pre-exist before the task begins.

## Acceptance

- `--auto-intent` must resolve a planned/ready task with declared non-`.atm` deliverables and no task delivery commit to `write`, even when those deliverable files already exist in `HEAD`.
- `--auto-intent` may resolve to `closeout-only` only when delivery evidence exists for the task and all declared deliverables are present.
- Evidence must include a regression covering:
  - planned task with pre-existing deliverables and no delivery commit;
  - dirty in-scope source overriding closeout;
  - delivered task with an existing delivery commit;
  - explicit closeout-only conflict recovery for dirty in-scope source.
- Run the focused claim auto-intent test and the declared validation commands before closeout.

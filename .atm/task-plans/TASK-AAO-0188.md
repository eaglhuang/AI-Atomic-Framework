---
task_id: TASK-AAO-0188
title: Isolate task-ledger governance fixture broker base state
status: done
target_repo: C:\Users\User\AI-Atomic-Framework
closure_authority: target_repo
scope:
  - scripts/validators/task-ledger/suite-impl.ts
  - tests/cli/task-ledger-fixture-isolation.test.ts
out_of_scope:
  - docs/governance/atm-bug-and-optimization-backlog.md
  - packages/cli/src/commands/taskflow.ts
  - packages/cli/src/commands/evidence/missing-report.ts
  - packages/cli/src/commands/evidence/validator-classification.ts
  - packages/cli/src/commands/next.ts
  - release/**
validators:
  - node --strip-types tests/cli/task-ledger-fixture-isolation.test.ts
  - npm run typecheck
  - npm run check:encoding:touched
backlog:
  - ATM-BUG-2026-07-12-149
completed_at: "2026-07-13T00:24:17.785Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-13T00:24:17.785Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-13T00-24-17-785Z-close-70713ffef9a8"
lastTransitionAt: "2026-07-13T00:24:17.785Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "bb97753b6ccc4228322dfd0cef22c84e741efc22"
---

# TASK-AAO-0188 — Isolate task-ledger governance fixture broker base state

## Objective

Fix `ATM-BUG-2026-07-12-149`: task-ledger governance validator fixtures can inherit shared Broker/branch state and fail before the intended assertions run.

## Deliverables

- Add or expose a deterministic fixture-preparation helper for task-ledger governance tests that creates an isolated repo with exactly one seed `HEAD`.
- Ensure the helper clears or avoids inherited Broker queue/intent state for each fixture repository.
- Add a focused regression that proves two fixture repos are unique, have one deterministic seed commit, and do not share Broker runtime state.

## Validation

- `node --strip-types tests/cli/task-ledger-fixture-isolation.test.ts`
- `npm run typecheck`
- `npm run check:encoding:touched`

## Notes

- Use Team Agents L5 and Broker before mutation.
- Do not edit shared backlog docs during this code task.

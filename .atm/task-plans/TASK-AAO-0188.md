---
task_id: TASK-AAO-0188
title: Isolate task-ledger governance fixture broker base state
status: planned
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

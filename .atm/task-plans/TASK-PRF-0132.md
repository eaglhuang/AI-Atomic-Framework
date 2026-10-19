---
doc_id: doc_TASK-PRF-0132
task_id: TASK-PRF-0132
title: "Repair onefile atom capsule runtime closure"
status: done
owner: codex-issue345
priority: P2
depends_on:
[]
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "scripts/src/atomize-backfill.js"
  - "tests/cli/onefile-adopter-atomize-proposal.test.ts"
  - "scripts/onefile-runtime-closure.ts"
  - "packages/cli/dist"
  - "release/atm-onefile"
  - "release/atm-root-drop"
validators:
  - "node --strip-types tests/cli/onefile-adopter-atomize-proposal.test.ts"
deliverables:
  - "scripts/src/atomize-backfill.js"
  - "tests/cli/onefile-adopter-atomize-proposal.test.ts"
  - "scripts/onefile-runtime-closure.ts"
  - "packages/cli/dist"
  - "release/atm-onefile"
  - "release/atm-root-drop"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
completed_at: "2026-10-19T00:47:15.175Z"
completed_by_agent: "codex-issue345"
closedAt: "2026-10-19T00:47:15.175Z"
closedByActor: "codex-issue345"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T00-47-15-175Z-close-e191237a9743"
lastTransitionAt: "2026-10-19T00:47:15.175Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "ec9c30310a42ae8953020e85c75080b46dd8b568"
---

# TASK-PRF-0132 - Repair onefile atom capsule runtime closure

## Goal

Fix issue 350 with traceable atom capsule dependency, CID parity and recurrence guard; rebuild runner and pass adopter test and complete CLI sweep.

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task TASK-PRF-0132` and closed with `node atm.mjs taskflow close --task TASK-PRF-0132`.

## Post-close validation

Per issue #350 comment 6256104142, the full CLI sweep is a mandatory delivery
condition after normal close, rather than a pre-close validator. Preserve the
original worktree and its runtime. Create a clean detached worktree of the
exact close tip, run `npm ci`, then run
`node --strip-types scripts/run-cli-test-sweep.ts` there. A failure stops
delivery; create the incremental bundle only after the full sweep passes.

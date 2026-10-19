---
doc_id: doc_TASK-PRF-0136
task_id: TASK-PRF-0136
title: 'Shared compose inbox: empty-patch member stays identity under the strict parser (#359 follow-up)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0135
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0136.*
- .atm/history/task-events/TASK-PRF-0136/**
- .atm/history/tasks/TASK-PRF-0136.json
- .atm/task-plans/TASK-PRF-0136.md
- PROGRESS.md
- packages/core/src/broker/shared-compose-inbox-merge.ts
- packages/core/src/broker/__tests__/shared-compose-inbox.test.ts
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types packages/core/src/broker/__tests__/shared-compose-inbox.test.ts
- node --strip-types scripts/validate-hist-v2-harness.ts --mode test
deliverables:
- packages/core/src/broker/shared-compose-inbox-merge.ts
- packages/core/src/broker/__tests__/shared-compose-inbox.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; an empty member patch then fails as malformed again.
nonGoals:
- Do not loosen the strict unified-patch parser; a non-empty patch with no hunks still fails closed.
- Do not modify the sealed hist-v2 harness, runbook, or any prereg archive.
- Do not tag or publish npm.
completed_at: "2026-10-19T16:36:00.572Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T16:36:00.572Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T16-36-00-572Z-close-acd1dd875f3c"
lastTransitionAt: "2026-10-19T16:36:00.572Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "c6d375a50"
---

# TASK-PRF-0136 — empty-patch compose member stays identity

## Why

PR #370 (TASK-PRF-0135) made `parseUnifiedPatch` refuse a patch with no hunks. The shared compose inbox relied on the old `applyUnifiedPatch` returning the base for an empty patch: the hist-v2 harness v2 `rename` fixture submits `""` and the ATM arm then failed with "rename left the source path in place" (ATM Dogfood, `validate-hist-v2-harness`).

## Change

`materializeMember` treats a whitespace-only patch as a content-preserving member and returns the declared base. Everything else still goes through the strict parser, so prose without hunks still fails.

## Acceptance

- `shared-compose-inbox.test.ts` covers `''`, `'\n'`, `'  \n'` as identity and prose as a failure.
- `validate-hist-v2-harness --mode test` passes (18 tests).

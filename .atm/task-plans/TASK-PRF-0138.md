---
doc_id: doc_TASK-PRF-0138
task_id: TASK-PRF-0138
title: 'Smoke-runbook validator: prefetch pinned blobs in partial clones (#359 follow-up)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0137
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0138.*
- .atm/history/task-events/TASK-PRF-0138/**
- .atm/history/tasks/TASK-PRF-0138.json
- .atm/task-plans/TASK-PRF-0138.md
- PROGRESS.md
- scripts/validate-hist-v2-smoke-runbook.ts
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types scripts/validate-hist-v2-smoke-runbook.ts
- node --strip-types tests/cli/worktree-callsite-census.test.ts
deliverables:
- scripts/validate-hist-v2-smoke-runbook.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; the validator goes back to the TASK-PRF-0137 form without the prefetch.
nonGoals:
- Do not add a new production worktree class to the worktree call-site census.
- Do not modify the sealed hist-v2 smoke runbook, harness, or prereg bytes.
- Do not tag or publish npm.
completed_at: "2026-10-19T17:19:34.897Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T17:19:34.897Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T17-19-34-897Z-close-70abfce991b1"
lastTransitionAt: "2026-10-19T17:19:34.897Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "825542424"
---

# TASK-PRF-0138 — prefetch pinned blobs before the shared clone

## Why

After TASK-PRF-0137, ATM Dogfood on 758d1c146 failed with `unable to read sha1 file` for pinned-merge blobs in `validate-hist-v2-smoke-runbook`. CI checks out with `filter: blob:none`. The pinned blobs are not local, and a `--shared` clone cannot fetch them lazily. Reproduced locally with a blob:none clone.

## Change

Before cloning, the validator runs a binary content diff of the pinned paths between the pinned merge and HEAD in this repository. That batch-fetches both sides into this repository's object store, which the shared clone then reads.

## Acceptance

- `validate-hist-v2-smoke-runbook` passes in a full checkout and in a `--filter=blob:none` clone.
- `worktree-callsite-census` still passes.

---
doc_id: doc_TASK-PRF-0137
task_id: TASK-PRF-0137
title: 'Smoke-runbook validator: shared clone instead of a linked worktree (#359 follow-up)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0136
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0137.*
- .atm/history/task-events/TASK-PRF-0137/**
- .atm/history/tasks/TASK-PRF-0137.json
- .atm/task-plans/TASK-PRF-0137.md
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
  notes: Revert the delivery commit; the validator goes back to the linked-worktree form from TASK-PRF-0136.
nonGoals:
- Do not add a new production worktree class to the worktree call-site census.
- Do not modify the sealed hist-v2 smoke runbook, harness, or prereg bytes.
- Do not tag or publish npm.
completed_at: "2026-10-19T16:57:38.922Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T16:57:38.922Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T16-57-38-922Z-close-e6cf0a6bd0ca"
lastTransitionAt: "2026-10-19T16:57:38.922Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "7a0280fec"
---

# TASK-PRF-0137 — smoke-runbook validator without a linked worktree

## Why

TASK-PRF-0136 made `scripts/validate-hist-v2-smoke-runbook.ts` run the sealed runbook tests against a pinned-core copy made with `git worktree add`. Product CI's `worktree-callsite-census` test refuses unclassified production `worktree add` call sites. The production worktree classes are a closed set.

## Change

The validator makes a throwaway `git clone --shared --no-checkout` of this repository instead. It detaches at HEAD, restores the pinned core paths to the pinned core merge, makes a local commit, runs the runbook tests, and deletes the clone. No linked worktree is registered on this repository.

## Acceptance

- `validate-hist-v2-smoke-runbook` passes (26 tests).
- `worktree-callsite-census` passes with no unclassified call sites.

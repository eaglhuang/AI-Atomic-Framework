---
doc_id: doc_TASK-PRF-0141
task_id: TASK-PRF-0141
title: 'Governed recovery and abort for interrupted taskflow close (#373)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0139
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0141.*
- .atm/history/task-events/TASK-PRF-0141/**
- .atm/history/tasks/TASK-PRF-0141.json
- .atm/task-plans/TASK-PRF-0141.md
- PROGRESS.md
- packages/cli/src/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- docs/ERROR_CODES.md
- docs/governance/git-governance-contract.md
- scripts/**
- tests/cli/**
validators:
- node --strip-types tests/cli/taskflow-close-recovery.test.ts
- node --strip-types packages/cli/src/commands/taskflow/__tests__/taskflow-close-window-lock.test.ts
- node --strip-types packages/cli/src/commands/taskflow/close-transaction-status.test.ts
deliverables:
- packages/cli/src/commands/taskflow/close-recovery.ts
- tests/cli/taskflow-close-recovery.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; interrupted closes go back to needing a manual decision.
nonGoals:
- Do not touch another checkout's .atm state from this task.
- Do not tag or publish npm.
completed_at: "2026-10-20T15:36:43.130Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-20T15:36:43.130Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-20T15-36-43-130Z-close-2537c0fdb486"
lastTransitionAt: "2026-10-20T15:36:43.130Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "0b9e6def04e1dfc21de4ba62a7535dbf8c1229b9"
---

# TASK-PRF-0141 — governed close recovery (#373)

## Authority and scope

User-approved on 2026-10-20 (Asia/Taipei) before finishing TASK-PRF-0140 (#363). Issue: [#373](https://github.com/eaglhuang/AI-Atomic-Framework/issues/373), part of #367.

## Design

- `taskflow close --task <id> --recover|--abort` (dry-run by default, `--write` to apply) inspects the stuck close: transaction phase, close-window lock holder, close mutex lease (owner pid, expiry), ledger status at HEAD / index / working tree, the persisted pre-close snapshot and the seal receipt.
- It refuses while the holder is alive (live pid, unexpired lease without a pid, or a lock younger than the threshold).
- Roll-forward: when the close already landed on HEAD, it marks the transaction completed and releases the lock as committed. When it has not landed and the staged close state is consistent, it finishes the governed commit with recovery trailers.
- Abort: unstage the close's artifacts, restore the ledger and card to their pre-close content, archive close-created files, mark the transaction rolled back and release the lock as aborted. It is refused once the close has landed, so there is never a double close.
- Every applied recovery appends an auditable entry to `.atm/history/evidence/<id>.close-recovery.json`; a repeat run is a no-op.

## Acceptance

- #373 AC1-AC8, with tests for both observed cases (close completed by hand-governed commits with a leftover lock; interrupted at ledger-written with a partly staged bundle and a ledger reopened by renew), plus a live holder (refused) and a repeat run (no-op).

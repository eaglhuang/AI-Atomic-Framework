---
task_id: TASK-AAO-0184
title: Mark tasks import path guidance backlog fixed
status: done
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scope:
  - docs/governance/atm-bug-and-optimization-backlog.md
deliverables:
  - docs/governance/atm-bug-and-optimization-backlog.md
validators:
  - git diff --check
  - npm run check:encoding:touched
completed_at: "2026-07-12T14:02:26.729Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T14:02:26.729Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T14-02-26-729Z-close-76c071308486"
lastTransitionAt: "2026-07-12T14:02:26.729Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "a9173920806bb243be2d339cf023540168437f8c"
---

# TASK-AAO-0184 — Mark tasks import path guidance backlog fixed

## Objective

Update the ATM Bug and Optimization Backlog row `ATM-BUG-2026-07-12-156` after the source fix landed in `TASK-AAO-0183`.

## Acceptance

- Row `ATM-BUG-2026-07-12-156` status is changed from `Open` to `Fixed in TASK-AAO-0183`.
- Evidence / follow-up fields mention delivery commit `dba70e92a882e33c0a0e7a3b9e706cc9ebbc0288`, close commit `def6460850214e094ed00aabec550bfe64ea62eb`, and the focused regression coverage.
- No unrelated backlog rows are changed.

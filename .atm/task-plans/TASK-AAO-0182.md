---
doc_id: doc_TASK-AAO-0182
task_id: TASK-AAO-0182
title: "Mark auto-intent claim backlog row fixed"
status: done
owner: atm-core
priority: P2
depends_on:
  - TASK-AAO-0181
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
validators:
  - "git diff --check"
  - "npm run check:encoding:touched -- --files docs/governance/atm-bug-and-optimization-backlog.md .atm/task-plans/TASK-AAO-0182.md"
deliverables:
  - "docs/governance/atm-bug-and-optimization-backlog.md"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the backlog status sync if TASK-AAO-0181 does not fully cover ATM-BUG-2026-07-12-153."
atomizationImpact:
  ownerAtomOrMap: "atom-governance-backlog"
  mapUpdates: []
completed_at: "2026-07-12T13:50:17.821Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T13:50:17.821Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T13-50-17-821Z-close-cc566c87710f"
lastTransitionAt: "2026-07-12T13:50:17.821Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "bf40ce42dec3b74eee70d0103de9695e99196b84"
---

# TASK-AAO-0182 - Mark auto-intent claim backlog row fixed

## Problem

Backlog row `ATM-BUG-2026-07-12-153` remains `Open` after TASK-AAO-0181 delivered and closed the auto-intent claim delivery detection fix.

## Acceptance

- Mark `ATM-BUG-2026-07-12-153` as fixed in TASK-AAO-0181.
- Include delivery commit `973f854025b7c5390e16a51d51ae07543e9449e6`, close commit `551507b7f428d3beef2c3ec99c2c6b359d433a82`, and validator evidence in the row.
- Run the declared text/encoding validators and close through governed taskflow.

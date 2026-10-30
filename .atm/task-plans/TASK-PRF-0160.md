---
doc_id: doc_TASK-PRF-0160
task_id: TASK-PRF-0160
title: "Rebuild stale packages/cli/dist via sealed runner sync"
status: done
owner: grok-bot
priority: P1
milestone: RFT-M
depends_on:
[]
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - ".atm/history/evidence/TASK-PRF-0160.*"
  - ".atm/history/task-events/TASK-PRF-0160/**"
  - ".atm/history/tasks/TASK-PRF-0160.json"
  - ".atm/task-plans/TASK-PRF-0160.md"
  - "PROGRESS.md"
  - "packages/cli/dist"
  - "packages/cli/dist/**"
  - "release/atm-onefile/**"
  - "release/atm-root-drop/**"
validators:
  - "npm run validate:quick"
  - "npm run validate:governance-fix-wave"
deliverables:
  - "packages/cli/dist/atm.js"
  - "release/atm-onefile/atm.mjs"
  - "release/atm-onefile/release-manifest.json"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit to restore the previous committed dist and release runner."
atomizationImpact:
  ownerAtomOrMap: "atm.unowned"
  mapUpdates: []
outOfScope:
  - "packages/*/src/**"
nonGoals:
  - "No source behavior changes; generated outputs only."
completed_at: "2026-10-30T00:45:25.251Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-30T00:45:25.251Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-30T00-45-25-251Z-close-5b3eb2b2ce1f"
lastTransitionAt: "2026-10-30T00:45:25.251Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "63d3b1572b9217ca4677f38faad506c974fd863f"
---

# TASK-PRF-0160 - Rebuild stale packages/cli/dist via sealed runner sync

## Problem

`packages/cli/dist` was last rebuilt by TASK-PRF-0159 (96fb1ade73, 2026-10-22). Since then 23 commits changed `packages/cli/src` through quickfix and PR channels that never rebuild dist, so a local `npm run build` on main ccea864 rewrites 45 tracked dist files plus release manifests, and the frozen runner source seal reports `syncRequired`.

## Acceptance

- One sealed runner build (`ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build`) from current main source, committed as generated outputs only.
- After delivery, a fresh `npm run build` leaves the tracked tree clean.
- `node atm.mjs next` no longer reports `syncRequired` for the runner source seal.
- `npm run validate:quick` and `npm run validate:governance-fix-wave` pass with command-backed evidence.

## Implementation Notes

- Base: origin/main ccea86478b.
- Claim as grok-bot (owner-approved 2026-10-30), build with ATM_RUNNER_PUBLICATION_TASK=TASK-PRF-0160, close through taskflow close.
- Follow-up (separate quickfix): CI freshness check so dist cannot drift again.

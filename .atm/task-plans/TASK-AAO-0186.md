---
task_id: TASK-AAO-0186
title: Add holder context to team lifecycle lease errors
status: done
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scope:
  - packages/cli/src/commands/team.ts
  - tests/cli/team-plan-contract.test.ts
deliverables:
  - packages/cli/src/commands/team.ts
  - tests/cli/team-plan-contract.test.ts
validators:
  - node --strip-types tests/cli/team-plan-contract.test.ts
  - npm run typecheck
  - npm run check:encoding:touched
backlog:
  - ATM-BUG-2026-07-11-117
completed_at: "2026-07-12T14:15:32.546Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T14:15:32.546Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T14-15-32-546Z-close-c4323114c696"
lastTransitionAt: "2026-07-12T14:15:32.546Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "9453a56519b894d8909a9a52875284823eda941e"
---

# TASK-AAO-0186 - Add holder context to team lifecycle lease errors

## Objective

Fix `ATM-BUG-2026-07-11-117` so `team lease` and `team release` failures include enough holder context for the operator to recover without manually opening the team-run JSON.

## Acceptance

- `ATM_TEAM_LEASE_CONFLICT` details include current holder id, leased paths, active lease summary, and a copy-paste release command for the actual holder.
- `ATM_TEAM_LEASE_NOT_FOUND` details include active leases for the requested permission and the exact release command for each holder when present.
- Existing lifecycle behavior remains unchanged for successful lease/release.
- A focused regression covers both conflict and release-not-found detail payloads.

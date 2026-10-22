---
doc_id: doc_TASK-PRF-0157
task_id: TASK-PRF-0157
title: Avoid cross-branch task IDs and reject expiring build claims before compilation
status: done
owner: grok-bot
priority: P1
depends_on: []
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0157.*
- .atm/history/task-events/TASK-PRF-0157/**
- .atm/history/tasks/TASK-PRF-0157.json
- .atm/task-plans/TASK-PRF-0157.md
- PROGRESS.md
- docs/governance/governance-friction-2026-10.md
- packages/cli/src/commands/taskflow/host-opener-policy.ts
- packages/cli/src/commands/taskflow/origin-task-ids.ts
- packages/cli/src/commands/plan.ts
- scripts/sealed-runner-claim-preflight.ts
- scripts/run-sealed-runner-build.ts
- tests/cli/origin-task-ids.test.ts
- tests/cli/sealed-runner-claim-preflight.test.ts
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
validators:
- node --strip-types tests/cli/origin-task-ids.test.ts
- node --strip-types tests/cli/sealed-runner-claim-preflight.test.ts
- npm run typecheck
- npm run preclose:check
deliverables:
- packages/cli/src/commands/taskflow/origin-task-ids.ts
- scripts/sealed-runner-claim-preflight.ts
- tests/cli/origin-task-ids.test.ts
- tests/cli/sealed-runner-claim-preflight.test.ts
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert this delivery.
nonGoals:
- No tags or npm publication.
completed_at: "2026-10-22T00:35:19.079Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-22T00:35:19.079Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-22T00-35-19-079Z-close-88e356b525c9"
lastTransitionAt: "2026-10-22T00:35:19.079Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "516dab098603a81a6e6f8c4d1be71d8dda31b9cb"
---

# TASK-PRF-0157

## Acceptance

- Automatic task numbering excludes IDs on every origin branch, including unmerged branches and newly published remote cards; concurrent session regression fixtures verify refresh behavior.
- Sealed builds reject insufficient publication claim lifetime before expensive work, with an actionable renew command; sufficient claims proceed and publication rechecks authority.
- Typecheck, lint, regression suites, preclose, frozen smoke, sealed build and runner-sync receipt pass; task closes normally.
- Both frictions are recorded as fixed by this PR.

## Opening decision

Consumed frozen runner seal and current allocation/publication sources. Remote card path census tops out at TASK-PRF-0156. No shared gate is added; origin discovery is read-only and build claim preflight validates existing authority. Stop on ambiguous authority or failed remote discovery rather than allocate from incomplete state.

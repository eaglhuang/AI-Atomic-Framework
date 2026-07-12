---
doc_id: doc_TASK-AAO-0183
task_id: TASK-AAO-0183
title: "Improve tasks import path guidance"
status: done
owner: atm-core
priority: P2
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/tasks/import-orchestrator.ts"
  - "packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts"
validators:
  - "node --strip-types packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts"
  - "npm run typecheck"
  - "npm run validate:cli"
deliverables:
  - "packages/cli/src/commands/tasks/import-orchestrator.ts"
  - "packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the import guidance and regression changes if the diagnostics become noisy or misleading."
atomizationImpact:
  ownerAtomOrMap: "atm.cli-tasks-import"
  mapUpdates: []
completed_at: "2026-07-12T13:58:44.803Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T13:58:44.803Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T13-58-44-803Z-close-f3049ba02817"
lastTransitionAt: "2026-07-12T13:58:44.803Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "dba70e92a882e33c0a0e7a3b9e706cc9ebbc0288"
---

# TASK-AAO-0183 - Improve tasks import path guidance

## Problem

Backlog row `ATM-BUG-2026-07-12-156` reports that `node atm.mjs tasks import --from plan --write --json` treats `plan` as a literal filename and returns `ATM_TASKS_PLAN_NOT_FOUND`, without explaining that `--from` expects a markdown task-card path or showing a copyable working example.

## Acceptance

- Missing or malformed task import paths emit targeted usage guidance with `--from <path-to-task-card.md>`.
- A literal `plan` value receives a specific hint instead of only a generic file-not-found message.
- Nonexistent markdown-like paths still report the requested path and include a copyable example.
- Existing valid import behavior remains unchanged.
- Focused import-orchestrator regression and declared validation commands pass.

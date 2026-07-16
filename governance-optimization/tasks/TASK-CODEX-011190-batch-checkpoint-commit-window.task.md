---
task_id: TASK-CODEX-011190
title: Repair batch checkpoint pending commit window
status: planned
owner: codex-bug-011-190
priority: High
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/batch/implementation.ts
  - packages/cli/src/commands/hook/pre-commit/support.ts
  - scripts/validate-task-direction-governance/adopter-core.ts
  - scripts/validate-hook-batch-evidence-context.ts
  - scripts/validate-hook-batch-pending-window.ts
  - docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-16-011.json
  - docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-190.json
  - docs/governance/atm-bug-and-optimization-backlog.md
deliverables:
  - packages/cli/src/commands/batch/implementation.ts
  - packages/cli/src/commands/hook/pre-commit/support.ts
  - scripts/validate-task-direction-governance/adopter-core.ts
  - scripts/validate-hook-batch-evidence-context.ts
  - scripts/validate-hook-batch-pending-window.ts
validators:
  - node --strip-types scripts/validate-task-direction-governance.ts
  - node --strip-types scripts/validate-hook-batch-evidence-context.ts
  - node --strip-types scripts/validate-hook-batch-pending-window.ts
  - npm run typecheck
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the batch checkpoint commit-window change and backlog status updates.
atomizationImpact:
  ownerAtomOrMap: atm.batch-command-map
  mapUpdates:
    - atomic_workbench/atomization-coverage/path-to-atom-map.json
  extractionCandidates:
    - atom: atm.batch-checkpoint-commit-window
      pattern: Policy Object
      source: packages/cli/src/commands/batch/implementation.ts
      disposition: follow-up-card
      inlineReason: null
---

# TASK-CODEX-011190 Repair Batch Checkpoint Pending Commit Window

## Goal

Fix ATM-BUG-2026-07-16-011 and ATM-BUG-2026-07-15-190 by making batch checkpoint preserve a measurable post-checkpoint commit window. The window must let the just-closed queue-head deliverables, task ledger, evidence, and task-events commit before the next queue-head claim blocks that commit.

## Acceptance

- `batch checkpoint --hold` reports a commit instruction for the closed task, not the next queue head.
- Pre-commit accepts the staged just-checkpointed task bundle during the pending commit window.
- `batch checkpoint` without `--hold` preserves a pending commit window even after the next queue head is active.
- Backlog items 011 and 190 are updated together with the generated backlog projection.

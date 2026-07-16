---
task_id: TASK-CODEX-0204
title: Repair shared worktree active-task dirty guard
status: planned
owner: codex-bug-0204
priority: High
amendment_epoch: 1
depends_on: []
related_plan: docs/governance/atm-bug-and-optimization-backlog.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/next/playbook-projection/active-work-summary.ts
  - tests/cli/team-admission-projection.test.ts
  - docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-204.json
  - docs/governance/atm-bug-and-optimization-backlog.md
deliverables:
  - packages/cli/src/commands/next/playbook-projection/active-work-summary.ts
  - tests/cli/team-admission-projection.test.ts
validators:
  - node --strip-types tests/cli/team-admission-projection.test.ts
  - npm run typecheck
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the active-work dirty guard and backlog status update.
atomizationImpact:
  ownerAtomOrMap: atm.next-playbook-projection-contracts
  mapUpdates:
    - atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json
  extractionCandidates: []
---

# TASK-CODEX-0204 Repair Shared Worktree Active-Task Dirty Guard

## Goal

Fix ATM-BUG-2026-07-15-204 by making active-work recommendations account for dirty worktree files that belong to another active lock or claim, even when those files are not staged. The operator should see a concrete Broker escalation before committing or closing over another captain's uncommitted WIP.

## Acceptance

- Active-work summary can project foreign dirty WIP from active lock or claim files.
- Team level recommendation escalates when the current scope overlaps foreign dirty WIP, not only when staged files overlap.
- The recommendation exposes owner/session context already available in active locks and claims.
- Backlog item 204 is updated together with the generated backlog projection.

## Non-goals

- Do not implement destructive cleanup, stash, or restore behavior.
- Do not change runner-sync admission or release publication policy.
- Do not refactor the whole next/playbook projection surface.

## Governance Amendments

- 2026-07-16: Bump amendment epoch after the previously untracked planning source entered HEAD in commit `c30730934753b1b2ab291295dfb156842511d6b5`; content scope remains unchanged and this amendment records the governed planning-source seal transition.

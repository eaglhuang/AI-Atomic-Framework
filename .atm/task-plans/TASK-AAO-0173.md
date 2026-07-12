---
doc_id: doc_TASK-AAO-0173
task_id: TASK-AAO-0173
title: "Fix durable actor identity precedence over legacy environment"
status: done
owner: atm-core
priority: P1
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/actor-registry.ts"
  - "tests/cli/identity-per-actor-routing.test.ts"
validators:
  - "node --strip-types tests/cli/identity-per-actor-routing.test.ts"
  - "npm run typecheck"
deliverables:
  - "packages/cli/src/commands/actor-registry.ts"
  - "tests/cli/identity-per-actor-routing.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if actor resolution precedence breaks explicit actor or environment overrides."
atomizationImpact:
  ownerAtomOrMap: "atom-cli-identity-routing"
  mapUpdates: []
completed_at: "2026-07-12T13:03:42.100Z"
completed_by_agent: "codex-backlog-captain"
closedAt: "2026-07-12T13:03:42.100Z"
closedByActor: "codex-backlog-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-07-12T13-03-42-100Z-close-5f80b72a3c70"
lastTransitionAt: "2026-07-12T13:03:42.100Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "195463319bb6bbfce73cc2703a7457d713ef9088"
---

# TASK-AAO-0173 - Fix durable actor identity precedence over legacy environment

## Problem

Legacy `AGENT_IDENTITY` can override a durable repo default and silently attribute generic commands to a stale actor.

## Acceptance

- Repo default identity wins over legacy environment identity when no explicit actor or `ATM_ACTOR_ID` is supplied.
- Explicit actor and `ATM_ACTOR_ID` precedence remains unchanged.
- Focused regression and typecheck pass.

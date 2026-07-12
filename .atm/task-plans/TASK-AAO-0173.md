---
doc_id: doc_TASK-AAO-0173
task_id: TASK-AAO-0173
title: "Fix durable actor identity precedence over legacy environment"
status: planned
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
---

# TASK-AAO-0173 - Fix durable actor identity precedence over legacy environment

## Problem

Legacy `AGENT_IDENTITY` can override a durable repo default and silently attribute generic commands to a stale actor.

## Acceptance

- Repo default identity wins over legacy environment identity when no explicit actor or `ATM_ACTOR_ID` is supplied.
- Explicit actor and `ATM_ACTOR_ID` precedence remains unchanged.
- Focused regression and typecheck pass.

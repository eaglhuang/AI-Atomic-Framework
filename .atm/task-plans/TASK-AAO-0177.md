---
doc_id: doc_TASK-AAO-0177
task_id: TASK-AAO-0177
title: "Preserve empty SDK segments in role-provider parsing"
status: planned
owner: atm-team-runtime
priority: P1
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/core/src/team-runtime/provider-selection.ts"
  - "tests/cli/team-role-provider-parser.test.ts"
validators:
  - "node --strip-types tests/cli/team-role-provider-parser.test.ts"
  - "npm run typecheck"
deliverables:
  - "packages/core/src/team-runtime/provider-selection.ts"
  - "tests/cli/team-role-provider-parser.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the parser change if optional SDK/mode syntax regresses or runtime-mode fields shift."
atomizationImpact:
  ownerAtomOrMap: "atom-team-provider-selection"
  mapUpdates: []
---

# TASK-AAO-0177 - Preserve empty SDK segments in role-provider parsing

## Problem

Parsing `role=provider:model::real-agent` filters empty segments before destructuring, so `real-agent` can be consumed as the SDK field and the requested runtime mode is lost.

## Acceptance

- Preserve segment positions while parsing provider, model, optional SDK, and runtime mode.
- Normalize an empty SDK segment to the provider default without shifting the runtime mode.
- Reject missing role/provider/model and unsupported runtime modes without silently creating a malformed override.
- Add focused parser regressions for two-, three-, four-segment, empty-SDK, malformed, and runtime-mode cases.

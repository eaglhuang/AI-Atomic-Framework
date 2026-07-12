---
doc_id: doc_TASK-AAO-0175
task_id: TASK-AAO-0175
title: "Resolve handoff prompts to a unique active task"
status: planned
owner: atm-governance
priority: P1
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/next.ts"
  - "tests/cli/handoff-resume-route.test.ts"
validators:
  - "node --strip-types tests/cli/handoff-resume-route.test.ts"
  - "npm run typecheck"
deliverables:
  - "packages/cli/src/commands/next.ts"
  - "tests/cli/handoff-resume-route.test.ts"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if handoff prompts can attach to the wrong task or bypass multi-claim ambiguity."
atomizationImpact:
  ownerAtomOrMap: "atom-cli-next-routing"
  mapUpdates: []
---

# TASK-AAO-0175 - Resolve handoff prompts to a unique active task

## Problem

A prompt that names `WORKSPACE-UNFINISHED-WORK.md` can be recognized as task-scoped but fail to resolve the uniquely active governed task because the handoff filename is not itself a ledger task id or plan path.

## Acceptance

- When a handoff document is explicitly named and exactly one imported task has a running status with an active claim, route to that task with a diagnostic explaining the fallback.
- If the handoff document names one or more task ids, prefer the matching active claim; never attach to a completed or non-active task.
- When multiple active claims remain possible, return task-selection-required rather than choosing one.
- Add focused regression coverage for unique active, stale completed task, and multiple active claim cases.

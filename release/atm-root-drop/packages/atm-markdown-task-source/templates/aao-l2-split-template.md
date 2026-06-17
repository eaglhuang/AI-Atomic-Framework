---
task_id: {{task_id}}
title: "{{title}}"
status: planned
priority: P1
closure_authority: target_repo
depends_on:
{{depends_on_yaml}}
scopePaths:
  - "{{scope_path}}"
deliverables:
  - "{{scope_path}}"
validators:
  - "npm run typecheck"
  - "npm run validate:cli"
  - "npm run validate:git-head-evidence"
  - "npm run test -- {{test_path}}"
  - "git diff --check"
atomizationImpact:
  ownerAtomOrMap: "atm.cli-tasks-map"
  mapUpdates:
    - path_pattern: "{{scope_path}}"
      atom_id: "{{atom_id}}"
      capability: "{{capability}}"
      coverage_status: "active"
outOfScope:
  - "advisory check in commit hook"
nonGoals:
  - "Do not upgrade schemaVersion (keep v0.2)"
contextMap:
  primary:
    - path: "{{scope_path}}"
      reason: "primary implementation target"
  secondary:
    - path: "packages/cli/src/commands/tasks.ts"
      reason: "CLI tasks route integration point"
  tests:
    - path: "{{test_path}}"
      reason: "unit and CLI integration coverage"
  patterns:
    - referencePath: "tests/cli/*.ts"
      referenceTaskId: "TASK-AAO-0085"
      description: "uses clean mock test runner patterns"
---

## Goal
{{goal}}

## Acceptance
- `{{scope_path}}` implements the required logic successfully.
- `{{test_path}}` covers all critical cases and assertions.

## Exclusion Rules
- No code regression on existing task commands.
- No second AtomicRegistry implementation.

## Verification
Run standard AAF validators:
```bash
npm run typecheck
npm run validate:cli
npm run test -- {{test_path}}
```

## Closure & Reports
1. Provide files list and lines added.
2. Confirm validators pass.
3. Node package release sync validation.

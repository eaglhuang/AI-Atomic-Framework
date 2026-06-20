---
task_id: TASK-AAO-0146
title: "Runner arbitration and close bundle isolation unify touched-set source-first policy"
status: done
completed_at: 2026-06-20T05:04:23.741Z
completed_by_agent: "codex-gpt-5.4-mini"
delivery_commit: "dbde2ae05fc1bdd573235c5e378f1ef5a55887a4"
priority: P1
closure_authority: target_repo
depends_on:
[]
scopePaths:
  - "packages/cli/src/commands/hook.ts"
  - "packages/cli/src/commands/git-governance.ts"
  - "packages/cli/src/commands/tasks.ts"
  - "packages/cli/src/commands/evidence.ts"
  - "packages/cli/src/commands/validate.ts"
  - "packages/cli/src/commands/taskflow/historical-close-preflight.ts"
  - "packages/cli/src/commands/taskflow/commit-bundle-assembly.ts"
  - "packages/cli/src/commands/tasks/scope-lock-diagnostics.ts"
  - "packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts"
  - "packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts"
  - "tests/cli/runner-arbitration-evidence.test.ts"
  - "tests/cli/tasks-claim-auto-intent.test.ts"
  - "tests/cli/**"
  - "docs/governance/**"
deliverables:
  - "packages/cli/src/commands/hook.ts"
  - "packages/cli/src/commands/evidence.ts"
  - "packages/cli/src/commands/validate.ts"
  - "packages/cli/src/commands/git-governance.ts"
  - "packages/cli/src/commands/taskflow/historical-close-preflight.ts"
  - "packages/cli/src/commands/taskflow/commit-bundle-assembly.ts"
  - "packages/cli/src/commands/tasks/scope-lock-diagnostics.ts"
  - "packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts"
  - "packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts"
  - "tests/cli/runner-arbitration-evidence.test.ts"
  - "tests/cli/tasks-claim-auto-intent.test.ts"
validators:
  - "npm run typecheck"
  - "npm run validate:cli"
  - "npm run validate:git-head-evidence"
  - "node --strip-types packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts"
  - "node --strip-types packages/cli/src/commands/taskflow/__tests__/close-gates-focused.spec.ts"
  - "node --strip-types packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts"
  - "git diff --check"
atomizationImpact:
  ownerAtomOrMap: "atm.cli-tasks-map"
  mapUpdates:
    - path_pattern: "packages/cli/src/commands/taskflow.ts"
      atom_id: "atm.unowned"
      capability: "runner arbitration and close lane validation"
      coverage_status: "active"
outOfScope:
  - "Do not loosen validator severity for touched files."
  - "Do not special-case foreign active WIP as the primary routing rule."
nonGoals:
  - "Do not redesign unrelated broker arbitration logic."
  - "Do not convert taskflow close into a blanket source-first mode."
contextMap:
  primary:
    - path: "packages/cli/src/commands/hook.ts"
      reason: "pre-commit runner arbitration entry"
    - path: "packages/cli/src/commands/taskflow/historical-close-preflight.ts"
      reason: "pre-close runner arbitration and foreign-stage classification"
    - path: "packages/cli/src/commands/taskflow/commit-bundle-assembly.ts"
      reason: "close auto-commit path must preserve foreign staged work while isolating the bundle"
    - path: "packages/cli/src/commands/tasks/scope-lock-diagnostics.ts"
      reason: "shared dirty-file arbitration helper"
  secondary:
    - path: "packages/cli/src/commands/evidence.ts"
      reason: "auto-evidence runner-kind routing"
    - path: "packages/cli/src/commands/validate.ts"
      reason: "shared arbitration resolver"
  tests:
    - path: "tests/cli/runner-arbitration-evidence.test.ts"
      reason: "focused arbitration regression coverage"
    - path: "tests/cli/tasks-claim-auto-intent.test.ts"
      reason: "claim intent regression for source-first vs frozen routing"
    - path: "packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts"
      reason: "regression coverage for open/close lane runner behavior and foreign staged preservation"
    - path: "packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts"
      reason: "focused preservation regression for foreign staged close bundles"
    - path: "packages/cli/src/commands/taskflow/__tests__/close-gates-focused.spec.ts"
      reason: "focused close gate regression for touched-vs-frozen arbitration"
  patterns:
    - referencePath: "packages/cli/src/commands/taskflow/__tests__/*.ts"
      referenceTaskId: "TASK-AAO-0145"
      description: "focused CLI regression style with governed lane assertions"
---

## Goal
- Unify runner arbitration across `pre-commit`, `pre-close`, `close`, and `validate`.
- Enforce source-first validation for this task's touched files only.
- Keep non-touched files on the frozen runner path so foreign WIP does not block unrelated close or commit work.
- Preserve foreign staged work during taskflow close auto-commit so bundle isolation no longer requires a separate follow-up card.

## Acceptance
- This task's touched files are always classified as source-first.
- Non-touched files stay on the frozen runner path.
- `pre-commit`, `pre-close`, `close`, and `validate` share the same runner-arbitration rule.
- Focused regressions cover touched-vs-frozen routing and claim intent behavior.
- Active foreign WIP is not treated as the primary arbitration rule.
- Taskflow close auto-commit preserves foreign staged files instead of failing closed or unstaging another task's WIP.

## Exclusion Rules
- Do not broaden source-first to non-touched files.
- Do not loosen validator or close-gate strictness for touched files.

## Verification
Run focused ATM validators:
```bash
npm run typecheck
npm run validate:cli
npm run validate:git-head-evidence
node --strip-types packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts
node --strip-types packages/cli/src/commands/taskflow/__tests__/close-gates-focused.spec.ts
node --strip-types packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts
git diff --check
```

## Closure & Reports
1. Report the touched files that now resolve source-first.
2. Confirm frozen-runner routing still applies to non-touched files.
3. Confirm taskflow close auto-commit preserves foreign staged work.
4. Record the focused regressions and CLI validator results used for closeback.

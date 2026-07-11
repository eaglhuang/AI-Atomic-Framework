# Handoff: Test Governance Phase 2.5 Catalog Bridge

## Summary

This handoff covers the first shippable slice of the unified test-governance
bridge that follows the planning-repo roadmap update for Phase 2.5.

The work completed here does **not** yet wire `evidence run` and
`taskflow close --auto-evidence` to the new catalog resolver. It does establish
the shared selection source, validator facade integration, plugin contract
metadata, schema updates, and task-card `testPlan` persistence needed for the
next step.

## What Was Completed

The framework repository now has a unified test catalog seed and resolver:

- `scripts/test-catalog.config.json`
- `scripts/lib/test-catalog.ts`
- `docs/governance/atm-test-governance-management-plan.md`

The validator facade now reads the catalog and reports catalog-aware selection
and performance signals:

- `catalogSchemaId`
- `duplicateDedupeKeys`
- `slowestEntries`
- `familyHotspots`
- `optimizationCandidates`

Language static checks were seeded into the catalog for:

- JavaScript / TypeScript
- Python
- C#

The atom test runner contract was extended so plugin-backed integration tests
can carry:

- `profile`
- `suite`
- `key`
- `family`
- `tiers`
- `dedupeKeys`
- `costBudgetMs`

Task import now preserves a structured `testPlan` field when present in task
frontmatter or plugin-imported tasks.

## Key Behavior Change

Focused validator selection is now materially narrower for test-governance
surfaces.

Example: a focused run on `scripts/run-validators.ts` now shrinks from the
standard profile baseline to a single targeted validator:

```bash
node --strip-types scripts/run-validators.ts standard --focus-path scripts/run-validators.ts --json
```

That run currently resolves to `validate-test-facade` only.

## Files Intended For The Next Commit

Stage only this batch for the next commit:

- `docs/QUICK_START.md`
- `docs/governance/atm-test-governance-management-plan.md`
- `docs/governance/HANDOFF-2026-06-30-test-governance-phase2_5.md`
- `packages/cli/src/commands/command-specs/test.spec.ts`
- `packages/cli/src/commands/shared.ts`
- `packages/cli/src/commands/tasks.ts`
- `packages/cli/src/commands/test.ts`
- `packages/core/src/manager/test-runner.ts`
- `packages/plugin-sdk/src/test-runner.ts`
- `schemas/test-report.schema.json`
- `scripts/lib/test-catalog.ts`
- `scripts/run-validators.ts`
- `scripts/test-catalog.config.json`
- `scripts/validate-test-facade.ts`
- `scripts/validate-test-runner.ts`
- `scripts/validators.config.json`
- `tests/test-runner-fixtures/fixture-plugin.ts`

Also stage the planning-repo roadmap update only from `3KLife`:

- `docs/ai_atomic_framework/ATM 測試缺口矩陣與未來優化計畫書.md`

## Files Explicitly Not In Scope For This Commit

Do **not** mix in the unrelated dirty state already present in the worktree,
including:

- `package.json`
- `packages/cli/src/commands/next.ts`
- `packages/cli/src/commands/registry*.ts`
- `packages/cli/src/commands/team.ts`
- `packages/core/src/test-runner/map-integration.ts`
- `packages/core/src/test-runner/metrics-collector.ts`
- `packages/core/src/upgrade/**`
- `docs/reports/agr-conflict-arbitration-benchmark.md`
- `artifacts/generated/**`
- `artifacts/queue-drain-smoke/**`
- `eslint-current*.txt`
- `eslint-warnings*.txt`

Those changes pre-existed this commit slice or belong to parallel work.

## Validation Already Run

Passed:

```bash
node --strip-types scripts/validate-test-facade.ts --mode validate
node --strip-types scripts/validate-test-runner.ts --mode validate
node --strip-types scripts/run-validators.ts standard --focus-path scripts/run-validators.ts --json
node atm.dev.mjs test --spec tests/test-runner-fixtures/plugin.atom.json --profile quick --suite host-integration --json
```

Loaded successfully:

```bash
node --strip-types -e "import('./scripts/lib/test-catalog.ts').then(...)"
```

## Known Residual Risk

Repository-wide `npm run typecheck` is still red, but the failures are in
pre-existing parallel dirty files outside this commit slice. The current error
clusters include:

- `packages/cli/src/commands/next.ts`
- `packages/cli/src/commands/registry*.ts`
- `packages/cli/src/commands/team.ts`
- `packages/core/src/police/family.ts`
- `packages/core/src/upgrade/propose*.ts`
- several map/registry/core tests

Do not “fix everything” in the same commit just to make typecheck green unless
the next captain intentionally broadens scope.

## Most Important Remaining Work

The next milestone is to connect catalog-driven selection into closeout-time
evidence orchestration without reviving a second test model.

Priority order:

1. Teach `evidence run` to resolve required `validator` and
   `integration-test` entries from task `testPlan`.
2. Reuse the same resolver inside `taskflow close --auto-evidence`.
3. Keep validator and integration-test execution separate; only the
   orchestrator should select both.
4. Avoid touching the larger legacy evidence tier model unless the new catalog
   resolver is ready to replace the specific decision branch being edited.

## Recommended Next Commands

For the next captain:

```bash
node atm.mjs framework-mode status --json
node --strip-types scripts/validate-test-facade.ts --mode validate
node --strip-types scripts/validate-test-runner.ts --mode validate
```

When preparing the commit, stage only the files listed in the “Files Intended
For The Next Commit” section and keep the rest of the dirty tree out of scope.

## Planning Sync Note

The planning-repo document was already updated to add Phase 2.5 and the unified
test catalog direction. The framework work in this handoff is intended to match
that roadmap, not to create a separate design line.

## Governance Friction To Carry Forward

This round also reconfirmed a separate ATM governance flaw that should not be
normalized just because we found a way to recover from it.

Protected `main` push can still discover missing commit-range `git-head`
evidence after several local commits already exist. The current repair lane can
devolve into:

- backfilling a fresh `HEAD` record
- appending historical commit-range records into
  `.atm/history/evidence/git-head.jsonl`
- landing a dedicated evidence-only commit just to satisfy push protection

That is an acceptable transitional repair path, but it is a poor steady-state
workflow. Earlier commit `0164921fb` already showed the same anti-pattern, and
the 2026-06-30 push recovery repeated it across a five-commit range before the
evidence-only closeout commit `e226e7e32`.

The next owner should treat this as product/governance debt, not as operator
muscle-memory to preserve. If commit-range `git-head` evidence is required,
ATM should surface and/or auto-generate it much earlier in the normal
lifecycle. If it is not required for some commit classes, the scope should be
narrowed so ordinary work does not fall into historical backfill archaeology at
push time.

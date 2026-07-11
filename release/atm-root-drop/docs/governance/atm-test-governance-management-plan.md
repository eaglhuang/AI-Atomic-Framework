# ATM Test Governance Management Plan

## Summary

ATM now has three related testing surfaces: validator scripts, `atm test`
integration checks, and language-adapter static checks. This plan defines a
single test catalog so those surfaces do not become parallel roadmaps.

The catalog is a selection source, not a runner replacement. Validators still
run through the validator facade. Integration tests still run through `atm test`
and plugin contracts. Language adapters still declare their own static-check
commands. The catalog decides which entries are relevant for a task, profile,
scope, and changed path set.

## Model

Each catalog entry carries:

- `key`: stable entry id.
- `capability`: `validator` or `integration-test`.
- `family`: managed selection group such as `language-static`,
  `integration-parity`, or `map-integration`.
- `source`: validator script, language adapter, ATM test runner, or plugin.
- `scope`: `task-local`, `global-advisory`, `release-blocking`, or
  `diagnostic`.
- `tiers`: externally visible `quick`, `standard`, and `full` profile levels.
- `pathTriggers`: changed-file patterns that make the entry relevant.
- `dedupeKeys`: semantic keys used to avoid repeating equivalent checks.
- `costBudgetMs`: advisory runtime budget for performance diagnostics.

## Capability Boundaries

Validators cover deterministic contracts: schema, governance, static checks,
adapter contracts, and release blockers. Language static checks are modeled as
`validators.language-static` entries.

Integration tests cover runtime behavior: atom test runner flows, map
integration, propagation, edge contracts, frontend or domain integration tests,
and plugin-provided host behavior. Validators do not call integration tests, and
integration tests do not call validators. A future orchestrator may select both
capabilities for one task.

## Profile Semantics

`quick` is the smallest task-relevant set. It should prefer touched scope,
language static checks, and narrowly targeted validators.

`standard` is the normal closeout set for command-backed evidence. It can
include lightweight integration checks, but should still remain task-scoped.

`full` is the release or adapter-development set. It may run broad integration
and release-blocking entries, but should not be the default during ordinary
implementation.

## Language Static Mapping

Language adapters keep their native names:

- `fastStaticCheck`
- `defaultStaticCheck`
- `allStaticCheck`

The catalog maps them outward as:

- `fastStaticCheck` -> `quick` validator candidate.
- `defaultStaticCheck` -> `standard` validator candidate.
- `allStaticCheck` -> `full` validator candidate.

Missing tools must report `diagnostic` or `not_applicable`; they must not be
reported as a pass.

## Task Test Plan

Task cards may carry a structured `testPlan`:

```json
{
  "schemaId": "atm.taskTestPlan.v1",
  "selectionMode": "task-scoped",
  "validators": {
    "defaultTier": "quick",
    "requiredKeys": [],
    "requiredFamilies": ["language-static"],
    "allowedScopes": ["task-local"]
  },
  "integrationTests": {
    "defaultTier": "quick",
    "requiredKeys": [],
    "requiredFamilies": []
  }
}
```

The existing `validators` field remains compatible during migration, but new
selection behavior should prefer `testPlan`.

## Performance Diagnostics

Catalog-based runs must emit enough information to manage the test portfolio:

- `slowestEntries`
- `budgetViolations`
- `familyHotspots`
- `duplicateDedupeKeys`
- `optimizationCandidates`

Budget violations are advisory by default. An entry only blocks execution when
it explicitly declares `performanceGate: "blocking"`.

## Implementation Milestones

1. Add `scripts/test-catalog.config.json` and `scripts/lib/test-catalog.ts`.
2. Project `validators.config.json` into catalog entries instead of manually
   duplicating every validator.
3. Teach `scripts/run-validators.ts` to select validator entries from the
   catalog while preserving existing profile, filter, and focus behavior.
4. Extend the test-runner plugin contract with profile, suite, family,
   `dedupeKeys`, and cost metadata.
5. Add task-card `testPlan` persistence and surface the selected plan from
   `next --claim`.
6. Route `evidence run --all-required` and `taskflow close --auto-evidence`
   through the same resolver.

The first shipped increment covers milestones 1 through 4 and keeps milestones
5 and 6 as follow-up integration work so the selection source is stable before
closeout enforcement depends on it.

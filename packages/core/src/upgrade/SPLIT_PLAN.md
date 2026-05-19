# `propose.ts` Split Plan (proposal analysis / gate / output)

Status: **planned (not yet implemented)**.
Tracked by TASK-ATD-0018.

## Current state

`packages/core/src/upgrade/propose.ts` is 942 lines and exposes one public
entry point (`proposeAtomicUpgrade`) backed by ~25 internal helpers. They
cluster into three concerns:

### 1. Analysis — normalize inputs and shape the proposal

| Helper | Lines | Purpose |
|---|---|---|
| `normalizeRequest` | ~25 | Coerce caller request into the typed proposal request shape. |
| `normalizeInputDocument` | ~25 | Normalize each input document (schemaId, kind, payload). |
| `inferInputKind` | ~45 | Map schemaId or explicit kind to the canonical input-kind enum. |
| `findInput` / `requireInput` | ~10 | Look up an input by kind. |
| `buildInputRefs` | ~30 | Build the input-ref summary embedded in the proposal. |
| `createInputSummary` | ~30 | Render the human-readable input description. |
| `resolveInputSchemaId` | ~10 | Pick the right schemaId from a document. |
| `normalizeTarget` / `normalizeRequestedReplacementMode` | ~30 | Coerce target metadata into the proposal contract. |

### 2. Gates — produce one gate-result per quality / risk check

| Helper | Lines | Purpose |
|---|---|---|
| `buildGateResult` | ~10 | Generic gate-result envelope builder. |
| `buildQualityComparisonGate` | ~15 | Wraps quality comparison report. |
| `buildRegistryCandidateGate` | ~12 | Wraps registry candidate verification. |
| `buildMapEquivalenceGate` | ~30 | Map-equivalence semantics. |
| `buildPolymorphImpactGate` | ~60 | Polymorph impact assessment. |
| `buildRollbackProofGate` | ~45 | Rollback proof gate. |
| `buildPropagationReportGate` | ~30 | Propagation report gate. |
| `buildReviewAdvisoryGate` | ~35 | Review advisory gate. |
| `buildHumanReviewGate` | ~45 | Human review gate. |
| `buildRetirementProofGate` | ~40 | Retirement proof gate. |
| `normalizeGateResult` | ~25 | Consistent gate-result post-processing. |
| `gateFailureSummary` / `qualityComparisonFailureReason` | ~25 | Failure-reason renderers. |

### 3. Output — assemble the final proposal envelope

| Helper | Lines | Purpose |
|---|---|---|
| `buildRequiredJustification` | ~80 | Aggregate gate decisions into the required-justification object. |
| `proposeAtomicUpgrade` (top-level) | ~250 | The main entry that orchestrates analysis → gates → output. |

## Target submodule layout

```
packages/core/src/upgrade/propose.ts          (entry orchestration, ~120 lines)
packages/core/src/upgrade/propose/
├── analysis.ts        # normalizeRequest, normalizeInputDocument,
│                      # inferInputKind, find/requireInput, buildInputRefs,
│                      # createInputSummary, resolveInputSchemaId,
│                      # normalizeTarget, normalizeRequestedReplacementMode
├── gates.ts           # buildGateResult + per-gate builders + normalizeGateResult
├── failure-reason.ts  # gateFailureSummary, qualityComparisonFailureReason
└── output.ts          # buildRequiredJustification + envelope assembly
```

`propose.ts` keeps `proposeAtomicUpgrade` and only that — every other
function is imported from a submodule. External callers that import
`proposeAtomicUpgrade` (and only that) are unaffected.

## Acceptance gates

1. `npm run validate:schemas` — every fixture under
   `fixtures/upgrade/proposals/` produces the same JSON as before.
2. `npm run validate:type-schema-sync` — TypeScript types stay aligned with
   the upgrade-proposal schema.
3. `npm run validate:standard` — 53/53 (current baseline) maintained.
4. Negative fixtures still fail with the same gate name and message code.

## Invariant exposure

- **I2** (schema additive-first): the proposal JSON shape MUST NOT change.
  Field renames / removals require an explicit migration note and a new
  schema version.
- The split is internal — `proposeAtomicUpgrade` signature stays identical.

## Why this is deferred

Same reason as TASK-ATD-0016 (`upgrade.ts` split): the working tree had
pre-existing merge conflicts in `packages/plugin-sdk/` that broke 5 skew
smoke validators in this session. A 900-line refactor on a broken baseline
would hide the source of any new failure. The plan is staged so a future
card can land it once the baseline is green.

## Depends on

- **TASK-ATD-0016** (`upgrade.ts` split) — landing first would clarify which
  helpers in `propose.ts` are still called from the CLI side.
- **TASK-ATD-0015** (first unit tests) — once the analysis helpers have unit
  coverage, the split can be verified at the function level rather than only
  the proposal envelope level.

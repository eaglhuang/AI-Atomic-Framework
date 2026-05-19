# `map-generator.ts` Split Plan (allocation / scaffold / provenance)

Status: **planned (not yet implemented)**.
Tracked by TASK-ATD-0022.

## Current state

`packages/core/src/manager/map-generator.ts` is 607 lines exposing 2 public
functions and ~25 internal normalizers:

### Public entry points

| Function | Purpose |
|---|---|
| `generateAtomicMap(request, options)` | The full generator — request normalization, allocation, scaffold, quality target plumbing, provenance. |
| `createMinimalAtomicMapSpec(request)` | Minimal spec for tests / fixtures. |

### Internal helpers (~400 lines)

- **Request normalization** (~150 lines): `normalizeRequest`,
  `normalizeMembers`, `normalizeEdges`, `normalizeEntrypoints`,
  `normalizeQualityTargets`, plus a cluster of per-field normalizers
  (`normalizeAtomId`, `normalizeMapId`, `normalizeSemver`,
  `normalizeRequiredText`, `normalizeSpecVersion`, `inferSpecVersion`,
  `assertSpecVersionSupportsMapSurface`).
- **Replacement / lineage normalization** (~80 lines):
  `normalizeOptionalMemberRole`, `normalizeOptionalEdgeKind`,
  `normalizeReplacement`, `normalizeLegacyUris`,
  `normalizeReplacementMode`, `normalizeEvidenceRefs`.
- **Provenance / quality targets** (~120 lines): the actual allocation
  step (calls `map-id-allocator`), the scaffold writer (calls
  `scaffold.ts`), and the provenance + quality-target output assembly.

The file is the most concentrated example in `packages/core/` of "request
normalization + allocation + scaffold + provenance" co-mingled.

## Target submodule layout

```
packages/core/src/manager/map-generator.ts          (entry orchestration, ~120 lines)
packages/core/src/manager/map-generator/
├── normalize-request.ts        # normalizeRequest + normalizeMembers / Edges / Entrypoints / QualityTargets
├── normalize-fields.ts         # the small per-field normalizers (atomId, mapId, semver, text, specVersion)
├── normalize-lineage.ts        # replacement / legacyUris / evidenceRefs / member-role / edge-kind
├── allocate.ts                 # the allocation step (thin wrapper over map-id-allocator)
├── scaffold.ts                 # call into existing scaffold.ts + post-processing
└── provenance.ts               # provenance object construction + quality-target attachment
```

The top-level `map-generator.ts` keeps `generateAtomicMap` and
`createMinimalAtomicMapSpec` only and imports from the new submodules.
External callers see no signature changes.

## Acceptance gates

1. `npm run validate:quick` — the map-equivalence and map-curator
   validators must produce identical outputs.
2. `npm run validate:standard` — full suite green.
3. Map-equivalence regression: any fixture under `fixtures/registry/maps/`
   that the generator produces must hash-equal before and after the split.

## Invariant exposure

This card lists no invariant_risk, but in practice the map output is
consumed by upgrade/propose (I2) and registry-diff (I2). The split is
purely internal — no field rename, no order change — so the existing
fixtures already gate the change.

## Why deferred

Same baseline state as TASK-ATD-0021. A 600-line generator split with
"output must be byte-identical" as the gate cannot be reliably verified on
a working tree with pre-existing merge conflicts.

## Order of operations for the future card

1. Extract the per-field normalizers first (`normalize-fields.ts`) — they
   have no cross-helper dependencies.
2. Run `validate:quick` → confirm green.
3. Extract `normalize-lineage.ts` (replacement / legacy URIs / evidence
   refs). Still no cross-deps to the request normalizer.
4. Run `validate:quick` → confirm green.
5. Extract `normalize-request.ts` (depends on the per-field normalizers).
6. Run `validate:quick` → confirm green.
7. Extract `allocate.ts`, `scaffold.ts`, `provenance.ts` in any order.
8. Run full `validate:standard` → confirm 53/53.
9. Diff map fixtures pre/post to confirm provenance / quality-target
   output is byte-identical.

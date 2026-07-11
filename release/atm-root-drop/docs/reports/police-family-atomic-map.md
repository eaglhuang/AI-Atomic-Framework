# Police Family Atomic Map (TASK-RFT-0006)

Strategy Map per police role + shared Result Contract Object (`PoliceFamilyReport` / `SharedGateReport`), behind a Facade (`family.ts`).

## Pre / Post

| Module | Pre (lines) | Post (lines) |
|---|---:|---:|
| `packages/core/src/police/family.ts` | 2012 | ~355 (Facade + aggregation + advisory/contract helpers) |
| `packages/core/src/police/types.ts` | — | ~397 (type-only) |
| `packages/core/src/police/suppression-keys.ts` | — | ~42 |
| `packages/core/src/police/shared.ts` | — | ~130 |
| `packages/core/src/police/constants.ts` | — | 2 |
| `packages/core/src/police/role-registry.ts` | — | 31 |

## Role modules (13)

| Role id | Module | Approx lines |
|---|---|---:|
| dedup | `packages/core/src/police/roles/dedup.ts` | 115 |
| demand | `packages/core/src/police/roles/demand.ts` | 57 |
| quality | `packages/core/src/police/roles/quality.ts` | 110 |
| map-integration | `packages/core/src/police/roles/map-integration.ts` | 101 |
| atomization | `packages/core/src/police/roles/atomization.ts` | 91 |
| decomposition | `packages/core/src/police/roles/decomposition.ts` | 148 |
| evolution | `packages/core/src/police/roles/evolution.ts` | 127 |
| polymorph | `packages/core/src/police/roles/polymorph.ts` | 164 |
| rollback | `packages/core/src/police/roles/rollback.ts` | 120 |
| evidence-integrity | `packages/core/src/police/roles/evidence-integrity.ts` | 119 |
| reversibility | `packages/core/src/police/roles/reversibility.ts` | 58 |
| noise-control | `packages/core/src/police/roles/noise-control.ts` | 54 |
| adopter-neutrality | `packages/core/src/police/roles/adopter-neutrality.ts` | 58 |

## Public surface

Callers continue to import from `packages/core/src/police/family.ts` (and existing `index.ts` police checks). Types live in `types.ts` and are re-exported via `export type * from './types.ts'`.

## Registry

`POLICE_ROLE_REGISTRY` / `POLICE_ROLE_IDS` enumerate the 13 roles in deterministic order for `role-registry.spec.ts` and `validate-police-atomic-map.ts`.

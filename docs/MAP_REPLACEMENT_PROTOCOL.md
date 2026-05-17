# Atomic Map Replacement Protocol

## Purpose

Atomic maps are the governed composition surface for larger capabilities. When a new feature or a legacy feature is decomposed into atoms, the result should not be a loose set of unrelated atoms. It should be represented by a canonical atomic map that carries the feature entrypoints, member roles, edge semantics, validation evidence, rollout state, and rollback requirements.

This document is the public, repository-neutral explanation of that protocol. Internal implementation task cards and planning notes should live in downstream workspaces, not in the framework core repository.

## Core Idea

An atom owns the smallest governed capability. A map owns the composition semantics that make several atoms behave as one larger feature.

A replacement-capable map answers these questions:

1. Which feature or legacy surface does this map represent?
2. Which atoms participate in the feature?
3. Which member atom is the entry adapter?
4. What does each edge mean: data flow, control flow, validation, fallback, side effect, or rollback?
5. Which evidence proves the map behaves like the feature it replaces?
6. What rollout mode is currently allowed?
7. What rollback or retirement proof is required before the old surface can be removed?

## Replacement Surface Requirements

A map can be treated as a replacement surface only when it has all of the following:

- a canonical map workspace under `atomic_workbench/maps/<mapId>/`;
- explicit member roles, such as `entry-adapter`, `domain-step`, `validator`, `side-effect`, or `rollback-adapter`;
- explicit edge kinds, such as `data-flow`, `control-flow`, `event-flow`, `validation`, `fallback`, `side-effect`, or `rollback`;
- a replacement contract that identifies the legacy or feature surface being replaced;
- integration evidence for the map itself;
- equivalence evidence when replacing an existing feature;
- propagation evidence when member atoms change;
- rollback or retirement proof before the legacy surface is removed.

## Draft Schema Direction

The current `atomic-map.schema.json` contract is intentionally strict. Any additional replacement fields require a formal schema version bump instead of ad-hoc extension.

A future `0.2.0` map schema is expected to add:

- `members[].role`
- `edges[].edgeKind`
- `replacement.legacyUris[]`
- `replacement.mode`
- `replacement.evidenceRefs[]`

The structural fields that define map semantics should be part of the map hash boundary. Operational rollout state and evidence references should remain outside the stable hash boundary so that evidence can accumulate without changing the map identity.

## Rollout Lane

Replacement rollout state is separate from registry lifecycle state.

Suggested replacement modes:

1. `draft`: the map exists but is not yet a replacement candidate.
2. `shadow`: the map runs beside the legacy surface and compares results.
3. `canary`: the map handles a constrained set of scenarios while rollback remains available.
4. `active`: the map is the official feature entry surface.
5. `legacy-retired`: the old surface has been retired or preserved only as lineage evidence.

Registry states such as `draft`, `validated`, `active`, `deprecated`, or `expired` must not be reused as replacement rollout states. The two lanes may influence each other, but they are different contracts.

The current M6 implementation exposes that separation explicitly: `atm replacement-lane transition` advances only the replacement lane, appends a transition record into `atomic_workbench/maps/<mapId>/lineage-log.json`, and leaves registry lifecycle status unchanged unless another workflow updates it.

## Evidence Gates

A replacement map should be promoted only through deterministic gates:

- `draft -> shadow` requires passing map integration evidence.
- `shadow -> canary` requires passing map equivalence evidence, or reviewed and accepted known divergences.
- `canary -> active` requires passing equivalence, propagation, review advisory, and human review.
- `active -> legacy-retired` requires rollback proof or retirement proof.

The upgrade proposal pipeline should consume map-level evidence directly. For map replacement work, the important input kinds are expected to include `map-equivalence`, `polymorph-impact`, and `rollback-proof`. When a replacement map contains members that participate in a polymorphic template group, `active` proposals should require a passing polymorph impact report in addition to equivalence evidence.

## CLI Workflow Direction

A minimal workflow can be implemented without introducing a runtime orchestration engine:

```bash
node atm.mjs create-map --from-plan <decomposition-plan.json>
node atm.mjs create-map --spec <map-spec.json>
node atm.mjs test --map <mapId> --json
node atm.mjs replacement-lane transition --map <mapId> --to shadow --evidence atomic_workbench/maps/<mapId>/map.test.report.json --json
node atm.mjs test --map <mapId> --equivalence-fixtures <fixtures.json> --json
node atm.mjs replacement-lane transition --map <mapId> --to canary --evidence atomic_workbench/maps/<mapId>/map.equivalence.report.json --json
node atm.mjs upgrade --propose --target map --map <mapId> --replacement-mode active --equivalence-report atomic_workbench/maps/<mapId>/map.equivalence.report.json --polymorph-impact-report atomic_workbench/maps/<mapId>/polymorph-impact-report.json --json
node atm.mjs replacement-lane transition --map <mapId> --to active --evidence atomic_workbench/maps/<mapId>/map.equivalence.report.json --evidence .atm/history/reports/review-advisory.json --json
node atm.mjs upgrade --propose --target map --map <mapId> --replacement-mode legacy-retired --rollback-proof .atm/history/reports/rollback-proof.json --json
node atm.mjs replacement-lane transition --map <mapId> --to legacy-retired --evidence .atm/history/reports/rollback-proof.json --json
```

The current M4 implementation uses delegated executors from the fixture set: one `mapExecutor`, one `legacyExecutor`, plus lineage from `replacement.legacyUris`. It writes `map.equivalence.report.json` into the canonical map workbench path and treats reviewed known divergences as promotable evidence.

The current M5/M8 implementation keeps upgrade proposals additive and review-first: map proposals remain `status: "pending"` when automated gates pass, but they hard-block with machine-readable `requiredJustification` when `active` is requested without passing `map-equivalence`, when template-bound members lack a passing `polymorph-impact` report, or when `legacy-retired` is requested without passing `rollback-proof`.

The current M6 implementation adds an explicit forward-only replacement lane validator and CLI. Each transition records `from`, `to`, `reason`, `evidenceRefs`, `actor`, and `timestamp` into the map lineage log so replacement promotion history remains deterministic and reviewable.

The current M7 implementation adds `atm.decompositionPlan` plus `create-map --from-plan <path>`, so a large-feature decomposition can deterministically materialize a canonical replacement map instead of leaving only loose atoms. The plan path also feeds the generated draft map back through `create-map --spec` for round-trip verification.

The current M9 implementation hardens `create-map --spec <path>` into a schema-validated deterministic artifact lane for both `0.1.0` and `0.2.0` map documents, including Windows PowerShell paths with spaces. The replacement-facing CLI surface also emits machine-readable `nextActionHint` data so `create-map`, `test --map --equivalence-fixtures`, and blocked `upgrade --propose --replacement-mode ...` flows can point callers at the next deterministic CLI step without introducing prompt-only orchestration.

The first implementation should favor deterministic artifacts over runtime magic. A map may initially describe delegated or documented execution. Full orchestrated execution can arrive later once map execution contracts are mature.

## Open Source Boundary

This repository should keep the protocol documentation, schemas, examples, and public contributor guidance. Project-specific execution task cards should stay in the host or downstream workspace that is coordinating the work.

For public contributors, ATM should eventually provide a short task-card template or example. It should not require contributors to use one private task workflow, nor should it carry internal execution cards in the framework core repository.

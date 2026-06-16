# Broker Format Adapter Dogfood Report (TASK-CID-0098)

Dogfood benchmark of the broker format-adapter subsystem (TASK-CID-0092..0098)
exercising the default adapter registry end-to-end through `planMutationBatch`.

Benchmark source: `packages/core/src/broker/__tests__/dogfood-adapter-benchmark.test.ts`
(synthetic fixtures under `packages/core/src/broker/__tests__/fixtures/`; the real
`atomic_workbench/atomization-coverage/path-to-atom-map*` files are NOT touched).

## Scenario results

| # | Scenario | Expected | Actual | Pass/Fail |
|---|----------|----------|--------|-----------|
| 1 | same-file different JSON rows (owner-shard) | one `mergeable` batch via `path-to-atom-map` adapter | 1 batch, verdict `mergeable`, 0 queued | PASS |
| 2 | same-row conflict (`path_pattern, atom_id` collide) | conflicting request queued, not merged | 1 batched, 1 queued | PASS |
| 3 | text range overlap (`replaceRange 2:4` vs `3:5`) | overlap = conflict, one deferred | `text-range` adapter, 1 batched, 1 queued | PASS |
| 4 | numeric increment (two `increment` on same scalar) | `commutative-merge`, deltas summed | `numeric-scalar` adapter, verdict `commutative-merge`, both batched | PASS |
| 5 | unknown format (`.bin`, two writes) | fallback adapter fail-closed | `fallback-file-lock`, 1 batched, 1 queued | PASS |
| — | architecture invariant | compose/decision/conflict-matrix contain zero adapter references | verified clean | PASS |

## Architecture invariant

The benchmark asserts that `compose.ts`, `decision.ts`, and `conflict-matrix.ts`
contain ZERO format-specific tokens (`adapters/`, `*Adapter`, `planMutationBatch`,
`computeCasResult`). The broker core remains format-agnostic; all format knowledge
lives behind the `FileMutationAdapter` interface and the adapter registry. This was
verified by an in-test grep over the three files and passes.

## Conflict-key scheme (TASK-CID-0094, locked option A)

The path-to-atom-map domain adapter keys a row mutation on its identity
`record:${path_pattern}::${atom_id}` (scope `record`), so two edits to the same row
collide deterministically while edits to different rows merge — stable across field
edits. Metadata-level fields (`schemaId`, `version`, `timestamp`, `sharding`,
`summary`, `owner`, `schemaSource`) widen to `{scope: 'file', key: shardPath}` so they
serialize against any row write in the same shard.

## Compare-and-swap (TASK-CID-0097)

`computeCasResult` compares the `sha256:<hex>` hash of the file actually read at apply
time against the base hash the plan was built on. A mismatch blocks the stale write
(lost-update prevention). The CLI `plan-batch --apply` path performs a single bounded
re-read+compare per batch with no internal retry loop; a mismatch records mutation
evidence with verdict `blocked` rather than overwriting.

## Known limits / deferred follow-ups

- **Projection regeneration is out of scope.** This batch's broker write path writes
  only the owner-shard files. Regenerating the derived projection
  `atomic_workbench/atomization-coverage/path-to-atom-map.json` via
  `writeProjectionFromShards` (in `path-to-atom-map-shards/merge.js`) is a DEFERRED
  follow-up CLI step, intentionally NOT wired into the broker apply path here.
- **No multi-round serialization scheduler.** Queued requests (those that conflict
  with an emitted batch) are reported but not automatically re-planned across rounds;
  the caller re-invokes `plan-batch` after the first round applies.
- **`adapter-registry.schema.json` not authored** (per plan); the registration
  contract lives in the TS interface + contract test.

## Schema registration note (plan deviation)

The plan left it to implementation discretion whether to register the broker schemas
in `scripts/validate-schemas.ts`. All four (`mutation-request`, `conflict-key`,
`merge-decision`, `mutation-batch-plan`) are now registered, since each already
satisfies the validator's metadata enforcement (`schemaId`/`specVersion`/`migration`
in `required`) and `validate-type-schema-sync` only cross-checks the explicitly listed
governance schemas, so registering carries no breakage risk and gains real validation.

## Rollback guidance

Each task card is an independent revert target. To roll back, `git revert` the Phase C
commit; the Phase B base (commit 31fd89ff0) remains intact and the broker core is
unaffected because all additions are additive (new files + optional type fields). No
data migration is required — the optional `mutationEvidence` field is omitted when not
provided, so existing evidence consumers are unaffected.

## Recommendation: SHIP

Rationale: all five dogfood scenarios and the format-agnostic architecture invariant
pass; the subsystem is additive-only, fail-closed on unknown formats, and CAS prevents
lost updates. The only non-shipped piece (projection regeneration) is an explicitly
deferred, clearly-scoped follow-up that does not affect the safety of the owner-shard
write path.

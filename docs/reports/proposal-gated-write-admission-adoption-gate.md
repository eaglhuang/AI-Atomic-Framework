# Proposal-Gated Write Admission Adoption Gate

## Scope

This report records the current ATM adoption recommendation for proposal-gated write admission after implementing the TASK-CID-0115 through TASK-CID-0119 path in the framework repository.

## Validated product paths

- Hot-file first writer enters `proposal-submitted` before any live same-file mutation is admitted.
- Late joiner on the same file with disjoint bounded regions is rearbitrated before apply and promoted to `composer-routed`, then completes through `broker steward apply`.
- Late joiner on the same bounded region is blocked as `blocked-before-write`.
- A same-file joiner can also surface `parked-for-rearbitration` when the first writer has not yet provided enough bounded-region detail.
- `collect-broker-evidence` continues to ingest team-run brokerLane rows together with broker operation run evidence.

## Default / opt-in boundary

- Default for shared hot files:
  `tasks.ts`, `next.ts`, `evidence.ts`, `hook.ts`, `team.ts`, `broker.ts`
- Default for other files only when broker already sees overlap-risk or same-file shared-surface pressure with bounded-region hints.
- Keep direct fast path for files that are not hot, have no shared-surface collision signal, and remain `parallel-safe`.
- Keep broad repository-wide mandatory proposal-first as opt-in for now; the validated mechanism is selective, not universal.

## Adoption recommendation

- Make proposal-first the default admission path for the current hot-file set.
- Keep deterministic-composer plus neutral steward as the governed apply path for disjoint same-file work.
- Keep hard early block for same bounded-region overlap.
- Continue collecting field evidence with controlled same-file collisions before expanding the hot-file allowlist.

## Minimum live collision recipe

1. Register or plan a first writer on a hot file so broker records `proposal-submitted`.
2. Start a second writer on the same file with bounded-region metadata.
3. Expect `composer-routed` for disjoint regions or `blocked-before-write` for overlapping regions.
4. For the disjoint path, run `node atm.mjs broker steward apply ...` and preserve the resulting apply evidence plus collected broker evidence bundle.

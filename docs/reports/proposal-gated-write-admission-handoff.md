# Proposal-Gated Write Admission Handoff

## Task status

- `TASK-CID-0115`
  Runtime contract and admission states are implemented in broker core types, decision logic, registry persistence, and CLI status surfaces.
- `TASK-CID-0116`
  `team start` and `broker register` now support proposal-first gating for hot files and bounded-region metadata.
- `TASK-CID-0117`
  Proposal overlap arbitration now distinguishes disjoint bounded regions, true overlap, and park-first-writer rearbitration.
- `TASK-CID-0118`
  Governed handoff from proposal-gated admission into composer plus steward apply is validated as a real apply path.
- `TASK-CID-0119`
  Adoption guidance and dogfood validation artifacts now exist, including hot-file first writer, composer-routed success, blocked-before-write, and parked-for-rearbitration traces.

## Implemented state machine

- `proposal-submitted`
  First writer is admitted only into a proposal-first holding state.
- `provisional-write-lease`
  Reserved for first-writer non-final write authority; the contract exists even if current validation emphasizes `proposal-submitted`.
- `write-admitted`
  Direct path remains available for non-hot, non-overlap-risk writes.
- `composer-routed`
  Same-file disjoint bounded regions are escalated before uncontrolled dual-write mutation.
- `blocked-before-write`
  Same bounded region or equivalent early collision is blocked before apply.
- `parked-for-rearbitration`
  A late joiner can force park-and-rearbitrate when the first writer has not yet supplied enough bounded-region detail.
- `applied`
  Governed steward apply completes after composer routing.

## Current trigger policy

- Default proposal-first triggers:
  `tasks.ts`, `next.ts`, `evidence.ts`, `hook.ts`, `team.ts`, `broker.ts`
- Additional proposal-first triggers:
  bounded-region metadata or same-file overlap-risk metadata on non-hot files
- Direct fast path remains:
  non-hot, non-overlap-risk, `parallel-safe` writes

## Verification runbook

- `npm run typecheck`
- `npm run validate:cli`
- `npm run validate:team-agents -- --case capture-broker-evidence`
- `node --strip-types scripts/validate-team-brokered-write.ts --mode validate`
- `git diff --check`
- `node atm.mjs evidence run --task TASK-CID-0115 --actor captain --command "node --strip-types scripts/validate-team-brokered-write.ts --mode validate" --json`

## Minimum live collision recipe

1. Use a hot file such as `packages/cli/src/commands/broker.ts`.
2. Start or register the first writer so broker records `proposal-submitted`.
3. Submit a second writer with bounded-region metadata on the same file.
4. Expect `composer-routed` for disjoint regions, `blocked-before-write` for overlap, or `parked-for-rearbitration` when the first writer lacks bounded-region detail.
5. For the disjoint path, run `node atm.mjs broker steward apply ...` and preserve:
   - the steward apply evidence
   - the broker operation run record
   - the collected broker evidence bundle

## Recommended next paper-evidence pass

1. Run one real Codex plus another-AI collision on a hot file using the bounded-region recipe above.
2. Archive the resulting team-run, broker run, steward apply evidence, and collected broker evidence bundle together.
3. Extract one positive trace and one blocked trace for the paper:
   - `proposal-submitted -> composer-routed -> applied`
   - `proposal-submitted -> blocked-before-write`
4. Add one park-first-writer trace where the first writer lacks final bounded-region detail and the late joiner forces rearbitration.

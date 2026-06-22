# Broker Guide

This guide documents the write-broker surface that coordinates concurrent agent writes: `WriteIntent`, `calculateBrokerDecision()`, the proposal-gated admission contract, and the candidate bridge.

CID terminology used by this guide:

- `Candidate CID` is the broker admission identifier for a discovered candidate.
- `Capsule CID` is the content-addressed version anchor for atom capsule export/import/rescue flows.
- `Synthetic broker atomCid` is the internal lane bookkeeping value emitted by `team-lane.ts`; it is not a capsule CID and not a candidate CID.

## Write Intents and Decisions

`packages/core/src/broker/types.ts` defines `WriteIntent` (task, actor, base commit, target files, atom refs, shared surfaces, requested lane) and `BrokerDecision`. `calculateBrokerDecision(newIntent, registry)` in `decision.ts` checks the new intent against all active intents and returns one of four primary verdicts:

| Verdict | Lane | Meaning |
|---|---|---|
| `parallel-safe` | `direct-brokered` | No CID, shared-surface, or file overlap; write proceeds in parallel |
| `needs-physical-split` | `deterministic-composer` | Same physical file but CID-disjoint; routed to the composer |
| `blocked-cid-conflict` | `blocked` | Atom ID or semantic CID collision with an active intent |
| `blocked-shared-surface` | `blocked` | Generator / projection / registry / validator / artifact collision |

## Proposal-Gated Admission v1

The broker contract now has a separate admission vocabulary in `BrokerDecision.admission` and `TeamBrokerLaneEvidence.admission`. This vocabulary is additive: it does not replace the existing conflict verdicts or lanes.

Admission triggers:

| Trigger | Meaning |
|---|---|
| `not-required` | Normal fast path; no proposal-first gate is active |
| `hot-file` | Same-file surface is governance-hot and should submit a proposal summary first |
| `same-file-overlap-risk` | Broker sees a pre-write overlap risk on the same file |
| `shared-surface-risk` | Shared projection / registry style surfaces need proposal-aware admission |
| `manual-review-surface` | Caller explicitly requests proposal-aware admission |

Admission states:

| State | Meaning |
|---|---|
| `proposal-submitted` | Proposal-first trigger is active, but only a summary/proposal has been admitted so far |
| `provisional-write-lease` | First writer has a bounded provisional lease, not a full free-write admission |
| `write-admitted` | Direct broker path is fully admitted |
| `composer-routed` | Same-file work is routed to the deterministic composer before live write |
| `blocked-before-write` | Broker blocked the lane before apply-time mutation |
| `parked-for-rearbitration` | Existing writer must pause so broker can rearbitrate |
| `applied` | Governed write reached the final applied state |

Current v1 rule boundary:

- Proposal gating is conditional escalation, not the default for every file.
- Existing direct broker flows stay valid when `trigger = not-required`.
- Hot-file and overlap-risk lanes can carry proposal-first evidence without changing the envelope shape used by downstream evidence capture.
- When two writers still share the same coarse owner map, bounded-region proposal evidence may refine that owner-level conflict: disjoint regions can route to composer, overlapping regions remain blocked.

## Candidate Bridge (TASK-ASP-0004)

`packages/core/src/broker/candidate-bridge.ts` converts atom candidates discovered by language adapters (plugin-sdk `AtomCandidate`, TASK-ASP-0001) into a well-formed `WriteIntent`, so callers no longer hand-build `atomRefs`, `targetFiles`, and `sharedSurfaces`:

```typescript
import { candidatesToWriteIntent, calculateBrokerDecision } from '@ai-atomic-framework/core';

const intent = candidatesToWriteIntent(candidates, {
  taskId: 'TASK-X',
  actorId: 'agent-a',
  baseCommit: 'abc123'
});
const decision = calculateBrokerDecision(intent, registry);
```

Behavior:

- **Deterministic `atomCid`** - SHA-256 of the canonical candidate contract `(kind || symbol || sourcePaths || detectionMethod)`, where `sourcePaths` is the deduplicated, sorted union of the candidate's `filePath` and `suggestedSourcePaths`. The same candidate yields the same CID across runs, which is what lets the broker detect two agents claiming the same semantic unit.
- **`atomId`** - uses the candidate's `suggestedAtomId` when present, otherwise falls back to `ATM-AUTO-<cid-prefix>`.
- **`targetFiles`** - deduplicated, sorted union of each candidate's `filePath` and `suggestedSourcePaths`.
- **`sharedSurfaces`** - empty by default; pass `ctx.sharedSurfaces` to declare generators, projections, registries, validators, or artifacts.
- **`requestedLane`** - `'auto'` by default (the broker decides); override with `ctx.requestedLane`.
- **Read-only and pure** - the bridge never mutates candidate input, never calls an LLM, and needs no language-specific semantics.

## Adapter Symbol Canonicalization Manifest

`packages/plugin-sdk/src/language-adapter.ts` now exposes `LanguageAdapter.manifest.symbolCanonicalization` so language adapters can declare their symbol-identity boundaries explicitly instead of having the broker guess.

The manifest fields are:

- `policy` - the adapter's canonical naming policy, currently declared-name based for both JS and Python.
- `reExportAliasBehavior` - whether the adapter only sees alias syntax or can resolve alias provenance semantically.
- `decoratorResolutionStance` - whether decorator semantics are unsupported, syntax-only, or fully semantic.

Broker rules for using this manifest:

- Treat the manifest as an honesty contract, not as extra candidate hash input.
- Do not widen symbol identity beyond what the adapter declares.
- Do not assume re-export alias resolution or decorator resolution is available unless the manifest explicitly says so.
- If the manifest says `syntactic-only` or `not-supported`, keep CID/AGR reasoning at the declared symbol surface and do not infer semantic equivalence across alias or decorator forms.

Current adapter declarations:

- JS adapter: `policy = declaration-name`, `reExportAliasBehavior = syntactic-only`, `decoratorResolutionStance = not-supported`.
- Python adapter: `policy = declaration-name`, `reExportAliasBehavior = not-supported`, `decoratorResolutionStance = not-supported`.

For the separate team-lane bookkeeping path, see `packages/core/src/broker/team-lane.ts`: it derives a synthetic broker `atomCid` from `taskId` slugification so lane evidence can stay stable without pretending to be a content-addressed capsule ID.

## Enclose Capability Preflight

`enclose(file, line)` is an optional `AtomizationPlanningAdapter` capability. The broker must feature-detect it before attempting any Layer 1 virtual-atom refinement.

Capability states used by this guide:

| State | Meaning | Broker posture |
|---|---|---|
| `full` | Adapter returns a valid `EnclosingUnit` for the requested locus. | May use the enclosure as Layer 1 evidence. |
| `partial` | Adapter can still discover candidates or produce dry-run plans, but `enclose()` is absent or returns `null` for some loci. | Treat as advisory only; do not infer a safe virtual atom boundary from it. |
| `unsupported` | The adapter does not expose a usable enclosure path for the requested locus. | Fail closed and fall back to the existing broker decision path. |

Current adapter support matrix:

| Adapter | discoverAtomCandidates | planAtomize | enclose | State |
|---|---|---|---|---|
| JS | yes | yes | no | `partial` |
| Python | yes | yes | no | `partial` |
| Any adapter without `AtomizationPlanningAdapter` | no | no | no | `unsupported` |

Fail-closed rules:

- Do not promote an adapter to `parallel-safe` just because `enclose()` is missing or returned `null`.
- Use enclosure evidence only to refine a Layer 1 boundary; never widen symbol identity or CID scope from an absent capability.
- If the broker already has a stronger verdict, keep that verdict: atom/CID overlap remains `blocked-cid-conflict`, shared-surface overlap remains `blocked-shared-surface`, and ambiguous same-file overlap stays on the deterministic-composer path (`needs-physical-split`) instead of being upgraded to optimistic parallel admission.
- Record missing or null enclosure as evidence of the fallback path so the lane remains auditable.

Because `@ai-atomic-framework/plugin-sdk` depends on core, the bridge declares a structural `BridgeAtomCandidate` mirror instead of importing the SDK type; plugin-sdk `AtomCandidate` values are directly assignable (covered by `__tests__/candidate-bridge.test.ts`).

## Tests

```bash
node --strip-types packages/core/src/broker/__tests__/candidate-bridge.test.ts
```

Scenarios covered: multi-candidate intent shape, deterministic CID, parallel-safe, CID conflict (`blocked-cid-conflict`), same-file CID-disjoint routing (`needs-physical-split`), and read-only input.

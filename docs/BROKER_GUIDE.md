# Broker Guide

This guide documents the write-broker surface that coordinates concurrent agent writes: `WriteIntent`, `calculateBrokerDecision()`, the proposal-gated admission contract, and the candidate bridge.

CID terminology used by this guide:

- `Candidate CID` is the broker admission identifier for a discovered candidate.
- `Capsule CID` is the content-addressed version anchor for atom capsule export/import/rescue flows.
- `Synthetic broker atomCid` is the internal lane bookkeeping value emitted by `team-lane.ts`; it is not a capsule CID and not a candidate CID.

## Write Intents and Decisions

`packages/core/src/broker/types.ts` defines `WriteIntent` (task, actor, base commit, target files, atom refs, shared surfaces, requested lane) and `BrokerDecision`. `calculateBrokerDecision(newIntent, registry)` checks active intents and pending native serial tickets:

| Verdict | Lane | Meaning |
|---|---|---|
| `parallel-safe` | `direct-brokered` | No CID, shared-surface, or file overlap; write proceeds in parallel |
| `needs-physical-split` | `deterministic-composer` | Same physical file but CID-disjoint; routed to the composer |
| `blocked-cid-conflict` | `blocked` | Atom ID or semantic CID collision with an active intent |
| `blocked-shared-surface` | `blocked` | Generator / projection / registry / validator / artifact collision |
| `serial` | `serial` | A cold logical write collision or earlier conflicting native ticket must wait before mutation |

## Native Cold Serial Queue

Cold means neither writer declares a proposal-first trigger, submitted proposal summary, or hot-file metadata. With `requestedLane: "auto"`, a cold same-atom/CID collision on a shared write surface, or a proven overlapping source range, selects `lane: "serial"` and canonical admission `disposition: "queue"`. Explicit `requestedLane: "serial"` also permits a conservative same-file fallback when bounds are unavailable. A requested lane never overrides a lease, read dependency, shared-surface guard, or hot/proposal-first route.

The compose boundary remains explicit:

- Disjoint files and disjoint bounded cold regions remain parallel eligible
- Unbounded same-file work with distinct atoms and automatic lane selection remains composer-routed
- Compatible bounded proposal regions retain deterministic composition
- Hot/proposal-first overlapping regions retain their existing fail-closed re-arbitration behavior
- Reads and independent private preparation do not acquire native serial tickets

`calculateBrokerDecision` and `evaluateBrokerAdmission` are pure previews. Durable admission occurs through `createBrokerTransactionAuthority(...).register(...)`, also used by `broker register`. Queue tickets live in the existing write-broker registry's `serialQueue`, under the same original-snapshot CAS transaction as registration and release. A waiter is not an `activeIntents` writer lease.

Tickets retain an owner, exact scope digest, committed monotonic sequence, original intent, blockers, enqueue/eligibility/grant times and expiry. FIFO is conflict-local: an unrelated resource can proceed, while a multi-resource request cannot jump earlier overlapping tickets. Enqueue, eligibility, grant, cancellation, release and expiry events are distinct. Repeated submissions retain ticket identity and order. A live writer must finish/release before queuing a changed scope, avoiding hold-and-wait cycles.

### Release and resume

Release only makes the next conflicting ticket **eligible for revalidation**. It never grants an old intent automatically. The eligible window is at most 30 seconds, bounded by the original queue lifetime. Expired/cancelled tickets release their place. A granted ticket becomes terminal when its matching writer lease expires or is released; retained terminal history and events are bounded.

1. Submit the prepared write intent with `broker register --task <task> --actor <owner> --intent-file <intent.json> --json`
2. If `evidence.admission.disposition` is `queue`, retain its ticket ID and inspect `broker status --json`. The result has `writeAuthorized: false`; CLI `ok: false` prevents legacy consumers from treating accepted queue placement as permission to write
3. The active owner runs `broker release --task <task> --actor <owner> --json`. Queue-related release/cancellation requires the explicit owner
4. Re-read current source and refresh the intent's base commit, preserving its exact write/read/region/proposal scope. Run `broker register --task <task> --actor <owner> --intent-file <refreshed-intent.json> --queue-ticket <ticket-id> --json`
5. Proceed only after canonical direct/proposal admission and the existing downstream write checks succeed. The CLI checks the actual repository HEAD again during each CAS retry. The core API requires `currentBaseCommit` or a `resolveCurrentBaseCommit` reader on resume

Scope changes require cancelling the old ticket and submitting a new intent; changing the base alone never authorizes broader paths or atoms. Resume repeats the current lease, read/write, shared-surface and FIFO checks. A replay of a successful resume can confirm its still-live, exact-scope grant without renewing the lease or emitting another grant. Queue admission does not apply a patch or replace file-preimage/content-hash CAS, validators, or steward controls. A new base commit is not proof that an old patch remains valid.

`broker status` exposes `serialQueueTickets[].position`, `waitMs`, `blockerIntentIds`, expiry and an authority digest. `evidence.admission.metrics.queueWaitMs` and `queuePosition` are available to a native consumer. Registry events establish eligibility and grant order. Status and decision commands do not persist cleanup; explicit cleanup and lifecycle writes use original-snapshot CAS. A crashed process that leaves the registry's compare/write lock remains fail-closed and needs governed recovery; automatic lock theft is not part of this queue.

The bounded equivalent benchmark is `node --strip-types scripts/validate-broker-native-serial-queue.ts`. It includes six simultaneous real CLI enqueue processes, restart/resume/release through separate processes, native wait telemetry, preserved FIFO grants and no lost counter updates. It never retries `true-conflict` in a harness overlay. Its reported wall/wait times include CLI process startup and are diagnostic measurements, not throughput claims or a performance comparison.

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
- Blocked same-owner overlaps may also emit a structured split suggestion (`decompositionRequest.suggestedAtoms`) so the map curator can promote the coarse owner map into finer child atoms without guessing the first cut by hand.
- The curator bridge now treats that broker split suggestion as a review-only atom-map patch draft, pointing at the owner shard plus projection rebuild path, so reviewers can approve a concrete split patch before the next collision reuses the same coarse owner map.

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

- **Deterministic `atomCid` (`cid.v2`)** - SHA-256 of `(cid.v2 || languageId || sourcePaths || kind || symbol || ordinal)`, where `sourcePaths` is the deduplicated, sorted union of the candidate's `filePath` and `suggestedSourcePaths`, and `languageId` is inferred from the file extension when absent. Line numbers and `detectionMethod` are not part of the identity, so inserting lines above an atom or upgrading the detector keeps its CID. `normalizeDerivedCandidates` merges consecutive same-name candidates (TypeScript overloads) and assigns a source-order `ordinal` only to remaining same-kind, same-symbol duplicates in one file; `computeAtomContentVersion` tracks body changes separately with LF-normalized hashing. The same code always yields the same CID, which is what lets the broker detect two agents claiming the same semantic unit.
- **`atomId`** - uses the candidate's `suggestedAtomId` when present, otherwise falls back to `ATM-AUTO-<cid-prefix>`.
- **`targetFiles`** - deduplicated, sorted union of each candidate's `filePath` and `suggestedSourcePaths`.
- **`sharedSurfaces`** - empty by default; pass `ctx.sharedSurfaces` to declare generators, projections, registries, validators, or artifacts.
- **`requestedLane`** - `'auto'` by default (the broker decides); override with `ctx.requestedLane`.
- **Read-only and pure** - the bridge never mutates candidate input, never calls an LLM, and needs no language-specific semantics.

## Derived Atoms: Two-Phase Symbol-Level Occupancy (TASK-ASP-0006..0011)

Derived atoms let tasks that change different functions of one file run in parallel without rewriting source or storing a second registry. They are computed from code on demand with the cid.v2 identity above.

- **Claim: reserve.** `node atm.mjs next --claim --task <id> --actor <id> --atoms alpha,beta --json` resolves each symbol in the task scope files at the base commit and registers the matching atoms (`operation: 'modify'`, with source ranges) on the task's broker intent. A reservation is an intent ceiling, not an exclusive guarantee. Two tasks that reserve disjoint atoms of one file are admitted as `parallel-safe` by the existing physical-overlap check. Symbols that do not exist yet are reported as `unresolved` and confirmed at commit time. Without `--atoms`, the claim stays file-level and shareable; the decision is deferred to commit.
- **Commit: confirm.** The governed `node atm.mjs git commit --task <id>` derives the atoms the staged diff actually touched (the index post-image, or the worktree for `--auto-stage`, which stages exactly that content). Old-side atoms catch deletions and new-side atoms catch new code. If another active task reserved or confirmed one of those atoms, the commit is refused with `ATM_GIT_DERIVED_ATOM_CONFLICT` before anything is written. Otherwise the confirmed atoms are merged into the task's broker intent, which the existing VirtualAtomInUse projection already exposes; reservations are released with the intent at close.
- **Preamble.** Imports and top-level statements before the first atom form one `#preamble` pseudo-atom per file. A preamble change commutes only when it purely adds import lines; removing or editing an import, or adding another top-level statement, keeps the preamble exclusive.
- **Fallbacks.** Unsupported languages (today only JavaScript and TypeScript are derivable), binary content, low-confidence candidates, changed non-blank lines outside every atom, and files of stale formal atoms stay file-level, which is the behaviour before this plan. Derivation failures never block a commit. `ATM_DERIVED_ATOMS=off` disables the feature.
- **Formal atoms.** Registry atoms are file-level today (`location.codePaths`), so they are ownership annotations and never swallow the derived atoms of their files. A formal atom whose code path no longer exists is stale: `atm doctor` reports `ATM_ATOM_FORMAL_STALE`, its files fall back to file-level, and ATM never rewrites formal atoms automatically. Promotion of a derived atom to a formal atom always goes through `atm create` / `behavior.atomize` and review.
- **Semantic revalidation.** Disjoint atoms can still break each other (for example a changed signature). Parallel commits land sequentially, so the later task's close-time validator evidence runs on a HEAD that contains both changes; steward-composed writes keep using the existing post-compose semantic validation (`post-compose-semantic-validation.ts`). No new validation entry point is added.

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
- If the broker already has a stronger verdict, keep that verdict: cold logical overlap queues before write, protected atom/read conflicts remain blocked, shared-surface overlap remains `blocked-shared-surface`, and automatic ambiguous same-file overlap stays composer-routed instead of becoming optimistic parallel admission.
- Record missing or null enclosure as evidence of the fallback path so the lane remains auditable.

Because `@ai-atomic-framework/plugin-sdk` depends on core, the bridge declares a structural `BridgeAtomCandidate` mirror instead of importing the SDK type; plugin-sdk `AtomCandidate` values are directly assignable (covered by `__tests__/candidate-bridge.test.ts`).

## Tests

```bash
node --strip-types packages/core/src/broker/__tests__/candidate-bridge.test.ts
```

Scenarios covered: multi-candidate intent shape, deterministic CID, parallel-safe, CID conflict (`blocked-cid-conflict`), same-file CID-disjoint routing (`needs-physical-split`), and read-only input.

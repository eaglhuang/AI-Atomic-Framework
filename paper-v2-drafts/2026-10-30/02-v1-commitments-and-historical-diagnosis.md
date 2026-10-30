# 2. ATM v1 Commitments and Historical Diagnosis

> Status: DRAFTED (from DRAFT-zh §2.1–§2.7). Motivation numbers are **author-reported** (old marker oracle, Oct-6 core@0.1.2 / v0.1.17); sources: `HOT_FILE_LATENCY.md`, `T6_R1_DENOMINATOR_AUDIT.md`, `runs/hot-file/t6_r1_raw_counts.json`, probe sealed in r1: `P/generations/r1-reviewed-2026-10-07/harness/runs/composer-probe/probe.mts`, `…/summaries/runs/composer-probe/`, `…/raw/b-probes.tgz` (`P/EVIDENCE_INDEX.md` §3 row B1–B4; 3 historical-probe checksums were missing from the review pack). M1 sources: `R1/docs/T6_R1_DENOMINATOR_AUDIT.md`, `R1/summaries/runs/hot-file/t6_r1_raw_counts.json`; raw in `P/archive/support-raw-r1/` (motivation only, not RQ evidence).

## 2.1 What v1 promised about the commit layer

ATM v1 (Huang, arXiv:2607.00041v1, cs.SE) contributes a seven-layer pre-write admission gate with a virtual-atom fallback, a spec-to-evidence governance substrate, and an atomization abstraction bounded by adapter contracts. Three of its commitments bear directly on this paper:

1. **Role separation.** Agents only propose; even composable proposals are written by a neutral steward, the sole formal apply authority (v1 §3.2).
2. **Same-file disjoint edits are composed, not written directly.** Bounded disjoint same-file edits route to `needs-physical-split`, and the deterministic composer plus neutral steward produce a single governed apply path (v1 §3.4, Algorithm 1 safety note; Table 4).
3. **Apply-time line shifts are absorbed** by the composer, steward and CAS base-hash revalidation (v1 §3.5), with the POS2 field case as positive evidence.

v1 evaluated deterministic scenarios, field cases, an external adopter study and OperationalBench, and explicitly did not claim broad superiority over other concurrency-control systems. It did **not** systematically measure whether several real patches composed by the steward preserve all non-conflicting changes independently of order.

## 2.2 Version anchors

Historical source, current main, candidate PRs and measurement artefacts are distinct objects; green CI, a merged PR, or a small fixture is not a completed experiment. Every table states which layer it is bound to.

| Object | Anchor | Use |
|---|---|---|
| v1 framework | `v0.9.0-alpha.1`; tag object `0b31aa86`, peeled source commit `a897f144` | Scope anchor for v1 claims (earlier drafts mistook the tag object for a commit) |
| Historical problem baseline | tag `v0.1.17`, commit `8dd6a1c6` | Probe (§2.4) and most background numbers |
| Review-time main snapshot | `3b0f7660` (2026-10-07 19:49 Asia/Taipei) | Contains FileHeat (PR #197) and native hot parking (PR #199); text-steward path identical to v0.1.17 |
| Fix candidate | PR #198, merged as `5692474f` (2026-10-07) | Immutable-base composition; single-process apply assumption (r2) |
| Commit-layer validation pins (r3–r6) | `bea35380` (PR #213), `2118bc66` (PR #214), `37847584` (PR #216), `b35a6141` (PR #238) | 06a; merge commits on main, not tagged/published |
| HIST v1.1 pins | pre-registered `20effd45` (stopped on counterexample), result pin `b1fd9d22` (PR #252), old pin `5692474f` | 06b |

[TODO-VERIFY: this draft did not check how the v0.9.x framework tag line maps onto the v0.1.x core tag line; state it explicitly before submission.]

## 2.3 Motivation: fault-injection negative control (author-reported)

In atm-bench, real ATM broker decisions drive a hot-file scenario (`overlap=high`, hot_ratio 1.0, 8 agents, 50 trials, 354 offered intents per repetition), comparing two writers:

- **sync writer (ideal reference):** read-modify-write at apply time, equivalent to an idealized instant rebase. It is a harness correctness reference, not an upper bound on real merging.
- **stale writer (admission only / raw overwrite):** reads the base after admission and writes base + own edit back after the hold, i.e. uses ATM admission but deliberately omits composer/steward composition and the commit protocol.

**Table M1. Hot-file stale vs. sync (author-reported).**

| Scenario | control lost rate | stale lost rate (native / loop) | sync lost |
|---|---|---|---|
| h1-a8 (Oct 6, core@0.1.2) | 71.5% | 64.9% / 65.2% | 0 |
| h1-a8 (v0.1.17) | 71.5% | 65.0% / 63.6% | 0 |
| h1-a6 (Oct 6) | 63.9% | 55.5% / 54.4% | 0 |
| h08-a8 (Oct 6) | 68.0% | 64.6% / 56.0% | 0 |

Caveats. (1) Stale/raw overwrite is a negative control: it shows the consequence of omitting the layer, not a capability limit of ATM, and is not a fair comparison against correct concurrency control. (2) Every historical "0 lost" was bound to the sync writer, which never exercised `composeBrokerProposals`/steward apply. (3) sync and stale share seeds and admission settings, but writer speed feeds back into later admission decisions, so the realized admission sequences differ (e.g., h1-a8 native composer_merge 210/rep vs. stale 206/rep). (4) Denominator: 64.9% is lost/commits, ratio-of-sums 518/798 over three reps (mean 172.7 lost/rep); 172.7/354 ≈ 48.8% would be lost/offered. Different denominators must not be chained into a single improvement percentage.

## 2.4 Historical probe (pinned to v0.1.17 `8dd6a1c6`)

A read-only probe builds a throw-away git repo, imports only v0.1.17 core sources, and for each scenario submits two `PatchProposal`s against the same 10-line file and base, then calls compose and steward apply.

**Table P1. v0.1.17 compose/steward-apply probe.**

| # | Scenario | compose verdict / applyMethod | apply result | A / B kept |
|---|---|---|---|---|
| 1 | Disjoint equal-length replacements (lines 2, 8) | `parallel-safe` / `patch-apply` | `applied` | yes / yes |
| 2 | Disjoint; first-ordered patch is above and inserts a line | `parallel-safe` / `patch-apply` | **throws** context mismatch at line 8 | no / no |
| 3 | Same patches as #2, anchor order puts the lower patch first | `parallel-safe` / `patch-apply` | `applied` | yes / yes |
| 4 | Overlap (both edit line 5) | `needs-steward` / `steward-authored-final-patch` | **throws** context mismatch (no blocked receipt; file unchanged) | no / no |
| 5 | `stewardId = 'agentA'` (the proposer) | `parallel-safe` | **`applied`** | — |

## 2.5 Interpretation

1. **Order dependence (#2 vs #3).** The text path sequentially reduces patches over an intermediate file (`steward-transactional-apply.ts:148`) instead of resolving all edits on one immutable base, and sorts by `targetFile → firstAnchorKey (string) → proposalId` (`merge-plan.ts:26-55`), not by file position. `serializabilityProof.permutationStable: true` is hard-coded (`:116-121`) and proves nothing.
2. **No side effect, but not observable (#4).** The canonical file is untouched, but the caller receives an exception, not `verdict: 'blocked'` with conflict details, so it cannot re-propose.
3. **No role check (#5).** `checkStewardPermission` is only called from `arbitrateStewardRequest`; `applyStewardPlan`, `executeBrokerScopedWrite` and CLI `broker steward apply` do not compare roles.
4. **`needs-steward` passes planning** without any implementation of a steward-authored final patch.
5. **Test blind spot** is specific to multi-proposal real apply of same-file text `PatchProposal`s; the structured `MutationRequest` composer already had multi-author tests.

This section describes v0.1.17 only; it is not a verdict on current main.

## 2.6 Repair list (end-to-end validation of v1, issue #196)

| ID | Layer | Gap (v0.1.17) | Direction (proposal) |
|---|---|---|---|
| P0-1 | core | sequential reduce; shift-induced failure; order-dependent result | resolve on one base; chosen compatibility rule; output by base position |
| P0-2 | core | composition failure ends in throw | catch → `ok:false, verdict:'blocked'` + reason code + proposalId |
| P0-3 | core | `needs-steward` passes without final patch | block non-deterministically-composable cases (`steward-final-patch-required`) |
| P0-4 | core + CLI | proposer can self-apply | role-consistency check on every write entry point (`invalid-steward-identity`) |
| P0-5 | harness | benchmark never drove real compose/steward | steward arm + strong baselines |
| P0-6 | tests | no multi-proposal same-file real-apply acceptance | S1–S5 + property/metamorphic tests (§4) |

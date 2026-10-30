# 4. Composition Contract and Implementation (ATM System Design)

> Status: DRAFTED; the proposition is stated with proof obligations only (proof pending, milestone M1). Sources: DRAFT-zh §4.1–§4.11; PR #297 test names as listed in DRAFT-zh §4.9; commit-layer components on ATM main `b1fd9d22` per DRAFT-zh §4.11. The main proposition is stated on the **conservative** contract (the one adopted by the r1 design draft, `R1/paper/ATM_PAPER_V2_DRAFT_zh.md` L180); the PR #198 precise contract is presented as a refinement (§4.12). A proof sketch is given; a full written proof and an independent oracle remain milestone M1.

## 4.1 Baseline path facts (v0.1.17)

| Fact | Location |
|---|---|
| Text composition is a sequential reduce over the intermediate file | `steward-transactional-apply.ts:148` |
| `permutationStable` is hard-coded `true` | `:116-121` |
| Sort key `targetFile → firstAnchorKey → proposalId` (string order, not file position) | `merge-plan.ts:26-55` |

## 4.2 Patch model

A hunk is described on the base by a **changed span** (base lines it replaces or deletes), a **context span** (unchanged lines used for anchoring) and, for pure insertions, an **insertion gap** (the position between two base lines). Supported: equal-length replacement, insertion, deletion, multiple hunks per proposal, and the `\ No newline at end of file` marker (attaches to the previous line; fixed in `b1fd9d22`). Rejected explicitly: rename, binary, mode change, CRLF change, and any syntax outside this subset. Two insertions into the **same** gap are rejected because their relative order is not determined by the base.

## 4.3 Compatibility contract

**Conservative contract (used for the main result).** Two hunks are compatible iff their *base footprints* are disjoint, where the footprint of a hunk is its changed span plus its context span on B, and a pure insertion additionally occupies its insertion gap. Two insertions into the same gap are incompatible. A set P is compatible iff it is pairwise compatible. Rationale (DRAFT-zh L388; r1 draft `R1/paper/ATM_PAPER_V2_DRAFT_zh.md` L180, L189, L327): every accepted hunk's context is verified on B and is not modified by any other accepted hunk, so no hidden "context rewritten by another patch" case exists. Cost: some semantically mergeable adjacent edits are rejected (false rejections, to be quantified).

The precise contract of PR #198 is a strict relaxation and is treated in §4.12.

## 4.4 Proposition (single file, same base, conservative contract)

Let B be the base, P = {p1…pk} proposals each produced against B and pairwise compatible under the conservative contract, every hunk's context matching B byte-exactly. Let R(P) be the composer's output. Then:

1. **Composition determinism:** R(P) depends only on the set P, not on arrival or iteration order.
2. **Exactly-once effect:** every hunk of every pi appears exactly once in R(P).
3. **Frame property:** every base line outside all changed spans is preserved, in base order.
4. **No side effect before rejection:** if any check fails, the canonical file is byte-identical to its pre-batch state and a blocked receipt is emitted.

Items 1–3 are properties of the abstract composer; item 4 is an engineering property of the commit layer (§4.6, §4.11), validated by tests and fault runs, not by this proof.

**Proof sketch (items 1–3; abstract composer).**
- *L1, unique resolution.* Each hunk h carries base coordinates on B and its context matches B exactly, so h resolves to exactly one base interval I(h) (or one gap g(h) for a pure insertion). No intermediate file is involved, so resolution is independent of other hunks.
- *L2, unambiguous partition.* Footprints are pairwise disjoint (contract) and gaps are distinct (same-gap insertions excluded). Therefore the intervals {I(h)} and gaps {g(h)} are totally ordered by base position, and B decomposes uniquely into an alternating sequence of untouched segments and owned segments, each owned segment belonging to exactly one hunk.
- *L3, output invariance.* Define R(P) as the concatenation, in base order, of untouched segments copied from B and, for each owned segment, the replacement text of its owning hunk. This definition refers only to base positions, which are fixed by L1 and totally ordered by L2; any permutation of P produces the same sequence and hence the same bytes (item 1). Each hunk owns exactly one segment, so its effect appears exactly once (item 2). Untouched segments are copied verbatim in order (item 3).
- *EOF.* Per component (e) at `b1fd9d22` (DRAFT-zh L497), the `\ No newline at end of file` marker attaches to the preceding line (deleted line → old side, added line → new side, context line → both sides), and a hunk that does not reach end of file keeps B's end-of-file state. The marker is thus part of the footprint of the unique hunk (by L2) that touches the last base line, or is copied from B with the last untouched segment, so it is resolved exactly once. (DRAFT-zh §1.2's "unsupported syntax must be rejected" predates this fix; the marker is now *supported*, not rejected.)

**What the sketch does not cover (TODO, M1):** (i) that the implementation computes this abstract R(P): v0.1.17 sorted by `targetFile → firstAnchorKey → proposalId` in string order (§4.1), which is not base order, so conformance of current main must be shown by an independent oracle and property/metamorphic tests; (ii) a written proof at the level of the patch parser (count omission, zero-length ranges); (iii) item 4.

Composition determinism is **not** serializability: it says the composer is order-independent for a compatible set, not that the outcome equals some serial execution of the agents' intentions.

## 4.5 Fail-closed behaviour

Any unsupported syntax, anchoring ambiguity, same-gap insertion, digest mismatch or missing final patch yields `verdict: 'blocked'` with a reason code and the offending proposal id, never an exception.

## 4.6 Four separated write guarantees

(i) composition correctness (§4.4), (ii) commit atomicity with respect to other governed writers (§3.4), (iii) rejection without side effect, (iv) receipt completeness. **Not claimed:** crash/power-loss atomicity and multi-file atomicity.

## 4.7–4.9 Acceptance scenarios and test mapping

| Scenario | Intent | PR #297 test |
|---|---|---|
| S1a/S1b | disjoint same-file proposals compose in one batch, order-independent | `assertDisjointComposeStillParallelSafe`, `testArrivalOrdersShareSetKey` |
| S2 | same-region but mergeable | `testSameRegionMergeable` |
| S3 | conflict → maximal legal subset accepted, rest blocked | `testConflictAcceptsMaximalSubset` |
| S4 | full rejection has no side effect | `testFullRejectHasNoSideEffects` |
| S5a | late joiner / new base recompute | `testImmediateWindowRecomputesOnNewBase`, `testWindowExpiryRecomputesLateProposal` |
| S5b | crash and recovery, idempotence | `testCrashPeerRecovers`, `testCrashExplicitCleanup`, `testResubmitIsIdempotent` |
| — | two independent processes meet at a barrier | `testTwoProcessBarrier` |

[TODO-VERIFY: exact S-label ↔ test mapping against DRAFT-zh §4.7–§4.9 and the PR #297 test file; the table above follows this draft's reading.] Passing these tests is necessary, not sufficient, for C2; they are fixtures, not experiments.

## 4.10 Current implementation status

Text composition on one immutable base, blocked receipts (P0-2/P0-3) and the role-consistency check (P0-4) landed via PR #198 (`5692474f`) and later commit-layer PRs. The cross-process batch closer landed as PR #297.

## 4.11 Commit-layer components (ATM main `b1fd9d22`)

| ID | Component | Introduced / validated |
|---|---|---|
| (a) | Region recompose when the canonical file moved but the target region did not | `bea35380` (r3) |
| (b) | Early stale detection → recompose instead of block | `2118bc66` (r4) |
| (c) | Bounded retry: `maxRecomposeAttempts` 4 (5 attempts total), `recomposeBackoffMs` 4 (wait 4k ms before retry k), `recomposeJitterMs` 3; exhaustion reason `re-compose attempts exhausted after N of M`; ablatable via `ATM_STEWARD_RECOMPOSE_POLICY` (JSON) | `2118bc66` (r4); ablated r4/r5 |
| (d1) | Repo-scoped lock at `.atm/runtime/steward-commit-locks/<sha256(realpath)>` (fixes per-TMPDIR lock) | `2118bc66` |
| (d2) | Kernel advisory lock via `lock.sqlite` `BEGIN IMMEDIATE` (fcntl), `lockWaitMs` 2,000, then `recovery-required` (the lock follows the open file descriptor, so a dead holder, including SIGKILL, is released by the kernel and processes in different PID namespaces see the same lock; the `owner` file is diagnostic only). Fixes the r4 cross-PID-namespace counterexample **F6** and forged-owner theft | `37847584` (r5) |
| (d3) | Orphan temp cleanup only while holding the lock; `cleanupOrphanCanonicalTemps` reports `skippedLiveHolder` | `37847584` |
| (d4) | Per-target FIFO apply queue (`ATM_STEWARD_APPLY_QUEUE` on/off, wait 10,000 ms); falls back to the file lock on `SQLITE_BUSY`/`LOCKED` | queue `37847584`; SQLITE_BUSY fallback `b35a6141` (PR #238, r6; fixes r5 availability defect D6) |
| (e) | EOF marker attaches to the previous line | `b1fd9d22` (PR #252) |

Correctness still rests on (d2) plus base-hash comparison; the queue (d4) only orders competing applies. (a)(b)(d1)–(d3) cannot be switched off without code changes; only (c) is ablatable by configuration, and (d1) can be defeated with `ATM_STEWARD_COMMIT_LOCK_ROOT` (not used in r5). The difference between `37847584` and `b1fd9d22` is the (d4) exception handling and (e) (DRAFT-zh §4.11).

**Label drift.** In the r4 record, the apply queue was called "(d3)" and listed as *not implemented* (`P/EVIDENCE_INDEX.md` §9, r4 row "最佳化 (a)–(d)"); the current labels (d1)–(d4) are those of DRAFT-zh §4.11. The paper must use one labelling.

**Labelling used in this paper.** (a)–(e) and (d1)–(d4) as in the table above (DRAFT-zh §4.11) are the only labels used in 03–07. When citing the r4 record we write "the apply queue (component (d4); called '(d3)' and listed as not yet implemented in the r4 record, `P/EVIDENCE_INDEX.md` §9)".

## 4.12 Refinement: the precise contract of PR #198 (future work)

PR #198 ("fix(broker): steward composes same-file patches against one base, fails closed, forbids self-apply (#196)", 2026-10-07) proposed a more permissive rule. Conditions, per the r1 review of its head `65e8aab3` (`R1/paper/ATM_PAPER_V2_DRAFT_zh.md` L175–179, L328, L355; DRAFT-zh L204, L389). DRAFT-zh L391 likewise states that the §4.4 proposition applies to either rule once "compatible" is defined by it:
1. changed spans pairwise disjoint;
2. hunks may share base context **only if that context is unmodified by every accepted hunk**;
3. two insertions into the same gap remain incompatible;
4. resolution of all hunks is done on B, never re-verified on an intermediate file;
5. its permutation check is bounded (all permutations for n ≤ 4; n + 1 rotations plus reversal for n > 4) and is therefore a test, not a proof.

Under conditions 1–4 the L1–L3 argument above goes through unchanged if "footprint" is replaced by "changed span plus gap" (shared context is copied once as an untouched segment, since by condition 2 no hunk owns it). The precise contract would reduce false rejections on adjacent edits (scenario S1d: context overlap, disjoint changed spans). Adopting it requires: an independent oracle deciding admit/reject, quantification of the extra admitted batches, and confirmation of which rule current ATM main implements. **[TODO-VERIFY: which contract the code at `b1fd9d22` enforces; not determined from the sealed material read for this draft.]** Until then, all results in 06 are interpreted under the conservative statement, and any batch admitted only by the precise rule is outside the proposition.


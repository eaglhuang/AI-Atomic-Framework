# 1. Introduction and Scope

> Status: DRAFTED (translation + tightening of DRAFT-zh §1.1–§1.6). Evidence: DRAFT-zh §1, §2.3; `P/EVIDENCE_INDEX.md` §17–§18; `P/benchmark-prereg/2026-10-14-hist-v2.0/` (PR #293). Literature claims trace to `P/related-work/2026-10-15-r2/README.md` and `P/related-work/2026-10-15-r2/pr-conflict-evidence.md` (quoted as reported by those papers, not re-measured by us).

## 1.1 Problem: after admission, who owns the final integration?

When multiple agents modify the same file, "no conflict" has two meanings. At the **admission layer**, two intents do not overlap in semantic atom, bounded region, shared surface, or read/write dependencies, and may therefore proceed concurrently. At the **commit layer**, the two patches that are actually produced enter the canonical file such that every accepted edit takes effect exactly once, neither overwrites the other, the result does not depend on arrival order, and rejected proposals leave no side effects.

ATM v1 implemented the first layer as a replayable admission vocabulary (`parallel-safe`, `needs-physical-split`, `SERIAL`, `blocked-*`; v1 §3.4, Table 4) and **delegated** the second layer to a deterministic composer and a neutral steward (v1 §3.2, §3.4 Algorithm 1 safety note, §3.5). "Admission is not commit safety" is a useful diagnostic principle rather than a new general law. Our contribution is to turn v1's promise about the second layer into a checkable protocol and contract, and to measure its cost against fair baselines.

The problem is not hypothetical. Studies of agent-authored pull requests report that concurrently active agent PR pairs are common and frequently textually conflicting (e.g., arXiv:2607.04697 reports 40.2% of repositories with concurrently active agent PR pairs and a 41.7% cross-agent textual conflict rate; AgenticFlict, arXiv:2604.03551, reports 27.67% textual conflicts against base; Campos Junior & Murta, SBES 2026, report 29.5% conflicting internal merges, 96.1% of them resolved by human commits). CooperBench (arXiv:2601.13295) attributes 33.2% of failures to duplicated implementation that overwrites details. These figures are quoted from the cited papers (`P/related-work/2026-10-15-r2/README.md`); we did not re-measure them.

**Terminology.** "Parallel" in this paper refers only to the *preparation* of proposals. Composition happens in **batches**, and the canonical commit is performed by a **single governed write path**. We avoid the earlier phrase "truly parallel merge", which suggests that the canonical file accepts multiple writers at once.

## 1.2 Scope and threat model

- **Single host, single governance domain** (as in v1 §3.7), single target file. Multi-file commit is a limitation and future work.
- **Cooperative processes**: every writer goes through the broker/steward path. Malicious root, processes bypassing the broker, identity forgery, and network partitions are out of scope.
- **Trusted steward and trusted local file system.**
- **Restricted patch subset**: textual unified diffs with equal-length replacement, insertion, deletion and multiple hunks; the `\ No newline at end of file` marker is supported as of `b1fd9d22` (§4, 06b). Rename, binary, mode and CRLF changes must be **explicitly rejected**.

Within this scope we do **not** claim a multi-agent sandbox, OS-level permission isolation, crash/power-loss durability, or semantic correctness of arbitrary programs. Stronger permission claims would require OS accounts or container permissions, actor–process binding, canonical-path write restrictions, and symlink/hardlink/path-escape/TOCTOU tests.

## 1.3 Research questions

- **RQ1 (preservation and correct rejection).** Under the stated patch subset and fault model, does the method retain every committed valid edit and correctly reject incompatible proposals?
- **RQ2 (safe progress vs. strong baselines).** Relative to a whole-file lock and lock-protected textual three-way merge, how much work completes safely, at what latency, retry and rejection cost?
- **RQ3 (inflection conditions).** Which patch structures, arrival intervals, batch windows and process counts change performance or coverage?
- **RQ4 (verifiable governance).** To what level can receipts and write entry points be verified, and which guarantees still depend on cooperative processes or OS permissions?

The RQs are pre-ordered by priority. They are answered by the frozen HIST-v2 pre-registration (§5), not by the voided Phase 3 matrix. HIST v1.1 answers neither cross-writer preservation (RQ1) nor RQ2 under fair atomic commit (§1.6).

## 1.4 Contributions

| ID | Contribution | Status in this draft |
|---|---|---|
| C1 | Governed composition-commit protocol: roles, state machine, batch closure, late joiners, retries, timeout terminals, receipts (§3) | Specification draft; awaits author sign-off on contract fields that still differ from PR #198 |
| C2 | Checkable preservation contract for a restricted patch subset: composition determinism, exactly-once effect, frame property, no side effect before rejection (§4) | Proposition and proof obligations stated; proof, independent oracle and property tests pending (M1) |
| C3 | Empirical safety/progress cost vs. strong baselines (§5–§6) | Methods frozen (HIST-v2.0); **no results yet** |
| C1′ | Evaluation hypothesis: no lost effects, no corrupted files | Placeholder |
| C2′ | Evaluation hypothesis: compatible proposals from independent processes commit in the same batch (observed `batchSize ≥ 2` in coordinator receipts) | Placeholder; a zero compose window seals singleton batches and cannot count |
| C3′ | Evaluation hypothesis: the accepted set S is a legal subset and the file equals R(S) | Placeholder |

C1–C3 are the paper's structure; C1′–C3′ are behaviours HIST-v2 will observe separately. The absence of C1′–C3′ results must not be read back as evidence that C1–C3 already hold.

Fixes to v0.1.17 gaps (order-dependent application, hard-coded `permutationStable: true`, exceptions instead of blocked receipts, missing proposer/steward role check; §2) are **not** listed as new contributions: they are end-to-end validation of mechanisms v1 already promised. If the final results show only "v1's promised mechanism, now fixed" without a separable difference from the file-lock or textual-merge arms, the submission venue/format (correction note, reproduction, or experience report) will be decided after HIST-v2 is sealed.

## 1.5 What the current evidence can support

- **Motivation (author-reported):** fault-injection negative control, stale/raw overwrite vs. ideal sync writer (§2).
- **Historical gaps (qualitative, re-runnable):** five-scenario probe pinned to v0.1.17 (§2).
- **Commit-layer correctness under multi-process replay (r1–r6; author-run, not independently reproduced):** see 06a.
- **External real-PR workload (HIST v1.1):** historical record of a defective method; see 06b. Not evidence for C1′–C3′.
- **HIST-v2 and C1′–C3′:** all placeholders (06c).
- **Real-agent track (prereg-v3):** pilot/diagnostic only; no formal data (09).
- **Phase 3 "450-run" matrix:** void; no cells reserved.

## 1.6 What was wrong with the earlier method

HIST v1.1 (run 2026-10-10) cannot answer "what is preserved when several proposals are composed on one immutable base". The problem is method, not arithmetic:

1. **Batch size was always 1.** Each writer process owned its own compose window and submitted with `expectedCount = 1`, so each proposal sealed its own batch. The nominal 100 ms window never gathered two writers. What was measured is protected single-proposal application plus concurrent cross-process commit.
2. **OCC and git three-way commit windows were not atomic.** Version comparison or `git merge-file` ran outside the lock; another writer could change the file after the candidate was computed and before rename. Their losses are artefacts of this harness, not properties of OCC or Git merging under fair atomic commit. HIST-v2 replaces both with one arm, `textual_merge_file`, which discards and recomputes a stale out-of-lock candidate inside the lock (prereg R4-D2).
3. **The semantic scorer counted skip and xfail as pass.** An external static review of `semantic_multi.py` (2026-10-10) found Django skip/expected-failure and pytest XFAIL classified as pass; no-test or collection-error cases could yield an empty failure set; new failures were computed without requiring observed passes on every reference. Table R12's zeros are therefore weak evidence until negative controls separate the states (§5.5).

**The Phase 3 "450-run" matrix is void.** Its name did not match its own arithmetic (3 workloads × 2 topologies × 5 arms × 10 seeds × 3 restarts = 900, plus 3 diagnostic arms × single process = 270; total 1,170), and it measured author-designed long runs rather than short real-PR bursts. It will not be run or back-filled. The r4 "E4 replay 450 = 6 arms × 75" is a separate validation round and keeps its historical numbers.

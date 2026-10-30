# 7. Limitations and Threats to Validity

> Status: DRAFTED (DRAFT-zh §7.1 plus post-10-14 findings). Sources cited inline.

## 7.1 Scope limitations (by design)

- **Single host, single governance domain, single target file.** No multi-file atomicity; no distributed steward.
- **Cooperative writers.** The role-consistency check is not authentication; a process bypassing the broker, a malicious root, or identity forgery are out of scope. "Not observed on monitored paths" does not mean "cannot write".
- **No crash/power-loss durability claim.** Rename + fsync + best-effort parent fsync; rollback is exception compensation, not crash atomicity (`R1/summaries/runs/steward-writer/STEWARD_WRITER_B5_B8.md`, per `P/EVIDENCE_INDEX.md` §3).
- **Restricted patch subset.** Rename, binary, mode and CRLF changes are rejected; same-gap insertions are rejected. This reduces coverage: in HIST v1.1, 120 steward intents were blocked as new-file creations (06b).
- **No semantic correctness.** Textual composition can produce code that compiles but is wrong; CooperBench-style semantic conflicts are outside the contract.

## 7.2 Internal validity

- **Method defects in HIST v1.1** (batch size 1; out-of-lock OCC/git; skip/xfail = pass) — v1.1 must not be used for C2′ or for baseline comparisons (06b §6.2.7).
- **Scheduling noise.** Identical settings differed by 54 completed intents across time slots (r5; `R5/.../R5_TABLES.md`); 234 of 2,500 HIST runs changed counts between generations without any relevant code change (`benchmark-main/2026-10-10-hist-main-v2/GENERATION.md`). Completion differences of a few percent are not interpretable without the HIST-v2 component bootstrap.
- **Harness-induced blocks.** Harness relocation stops (4,468 of 5,223 steward blocks in v1.1) precede any ATM call and dominate O1/O2.
- **Observability gaps.** File-lock fallbacks after `SQLITE_BUSY` are not counted (D6); CI does not prove that the `unshare` namespace test interlocked; the r6 core diff contains an unrelated `sqlite-runtime.ts` change (D5).
- **Proof incomplete.** The composition proposition (§4.4) is stated on the conservative contract with a proof sketch for the abstract composer; implementation conformance, a parser-level proof and an independent oracle are pending (M1). Batches admitted only by the PR #198 precise contract (§4.12) are outside the proposition.
- **Oracle/scorer semantics.** The prereg-v3 pilot scorer counted an unsubmitted test hunk as a "lost" edit (`P/prereg-v3-pilot/2026-10-23-pilot/VERDICT.md`). This paper uses one definition throughout (06a §6.1 preamble): lost = acknowledged as applied but absent from the final bytes; the prereg-v3 scorer must adopt it before that registration freezes.
- **Harness timing defect (explained, not yet fixed).** HIST-v2 pilot-r2 recorded a 110.327 s submit gap against a 506.5 ms designed delay (`P/benchmark-trials/2026-10-15-hist-v2-pilot-r2.NOTE.md`), producing an `inconsistent:ack`. Read-only root cause (`pilot-r2-rootcause.md`): a host wall-clock discontinuity, plus arms that enforce a per-writer stop instead of the item-level T_stop the registration and scorer use. Amendment v2.1 (05 §5.11, A8–A9) pre-declares the fix (shared monotonic T_stop) and an outcome-blind clock-validity exclusion; until a pilot on harness v4 passes, interval-based RQ3 results are at risk.
- **Pre-registration deviations.** The registration was amended after freeze (v2.1; 05 §5.11). Some changes were informed by pilot data, none by main or held-out data; readers should weigh confirmatory claims accordingly.
- **Motivation numbers** (Table M1) are author-reported under an old marker oracle, and sync/stale admission sequences differ.

## 7.3 External validity

- Six Python projects (v1.1) and a planned flask/requests holdout (v2); no other languages, monorepos or binary assets.
- Historical replay ≠ live agents; the real-agent track (09) is unfrozen and has no formal data.
- Class C (true conflicts) has 1 item of 4,095 in classify-v8 (05 §5.2), so correct rejection on real conflicts is barely exercised by historical data.
- r1–r6 use one author-designed replay workload (E4) on one host with load average up to ~11.5 under stress.

## 7.4 Construct validity

- "Completed" counts only committed intents; a fail-closed block is counted as non-completion even when it is the correct outcome. HIST-v2 therefore separates insufficient progress (legal non-maximal set) from safety failure.
- Pair-level CIs in v1.1 ignore 183 shared-PR clusters among 300 pairs; HIST-v2 resamples components.

## 7.5 Reproducibility and independence

All rounds are author-executed and not independently reproduced; r1's original `reproduce.sh` rewrote fingerprints in verify mode (fixed from r2 via separate verify/analyze/rerun/seal; `P/README.md`). The v0.1.17 probe is sealed in r1 (`R1/harness/runs/composer-probe/probe.mts`, `R1/summaries/runs/composer-probe/`, `R1/raw/b-probes.tgz`), but 3 historical-probe checksums were missing from the external review pack (`P/EVIDENCE_INDEX.md` §3, row B1–B4). The motivation raw data is uploaded but marked "not RQ evidence" (`P/EVIDENCE_INDEX.md` §5).

# 6.1 Results I: Commit-Layer Write Safety under Multi-Process Replay (r1–r6)

> Status: DRAFTED from sealed generations. All numbers are **author-executed, single host, not independently reproduced; no significance or non-inferiority tests; no win claim** (`P/README.md` header). Path shorthands follow `P/EVIDENCE_INDEX.md` line 17: `R1=generations/r1-reviewed-2026-10-07`, `R2=generations/r2-2026-10-08`, `R3=generations/r3-2026-10-08`, `R4=generations/r4-2026-10-08`, `R5=generations/r5-2026-10-08`, `R6=generations/r6-2026-10-09` (all under `P/`). Each generation is verified read-only with its own `verify.sh`. Completion and loss are always reported separately; a completion gain never offsets a lost effect or corrupted file (DRAFT-zh §5.7 counterexample rule).

These rounds are **validation of the commit layer**, not the C3 evaluation. They answer: once proposals from independent processes race for the same canonical file, does any accepted effect disappear?


**Definition — "lost effect".** An intent counts as *lost* iff the system returned an applied/committed verdict for it and its effect is absent from the final file bytes (fault harness: `verdict === 'applied' && !has(marker)`, `R5/harness/R5_CHANGES.patch` L572; the E4/HIST analyses sum the same per-run field, `R5/harness/analysis/r5_compare.py` L119). Blocked, rejected or timed-out intents and edits that were never submitted are **non-completion, not loss**. HIST-v2 uses the same notion per accepted proposal (`lost-accepted-proposal`, 05 §5.6). The prereg-v3 pilot scorer's arm-B "lost = 1" counts an unsubmitted test hunk and is therefore not a lost effect under this definition (`P/prereg-v3-pilot/2026-10-23-pilot/VERDICT.md` L16).
## 6.1.1 Workload and oracle

The main instrument is the **E4 multi-process replay** (r1 configuration, 75 runs per arm, 2,610 intents per arm; r6 doubles to 150 runs / 5,220 intents). It is complemented by deterministic **barrier interleavings** (seam, stale-proposal, before-precheck), **fault scenarios** F1–F7 (kill before rename, cross-PID namespace via real `unshare -Urpf --mount-proc`, forged owner, orphan/live temp files), an **r1 E4 18-cell rerun**, a **single-process regression** and **E5 fault injection**.

From r2 on, the oracle is full-bytes + frame + structure (`R2/harness/src/oracle_v2.mjs`; 10 contract cases pass). Re-scoring all r1 stages changed 0 verdicts; one r2 replay cell changed 10 verdicts from correct to frame_violation (3,164 → 3,154) (`P/EVIDENCE_INDEX.md` §7).

## 6.1.2 r1–r2: the counterexample (pin `5692474f`, PR #198)

External review of r1 flagged **E4 p2 s17 lost = 1** (`R1/review/EXTERNAL_REVIEW_2026-10-07.md`). r2 forensics (`R2/summaries/runs/r2-e4-forensics/E4_FORENSICS.md`) confirmed a **real multi-process lost update**: intent `s17-t000-i0` was overwritten by another process's `s17-t000-i6` on the same base `3c1ad38d`. Root cause: the harness did not place steward apply under the apply lock; contributing cause: the pinned steward apply was check-then-write and non-atomic. Replaying the r1 configuration for 75 runs gave **4 failed runs, 6 lost effects and 1 torn write**; with a harness lock (`slock`) 0 — recorded as a mitigation candidate only. The r2 E4 table was rewritten as a counterexample table (p2/p4/p8/SP completed 63/106, 60/106, 56/106, 94/106; p2 lost = 1).

## 6.1.3 r3: atomic commit section (`bea35380`, PR #213)

Deterministic seam barrier: `5692474f` **40/40 lost** → `bea35380` **0/40** (same region: follower blocked, only leader kept; separated regions: both kept after re-compose). E4 replay: `5692474f` 8 failed runs / 12 lost; `bea35380` 0/0, 0 corrupted, 18 re-composes counted as non-completion. r1 18-cell rerun: `5692474f` 1 lost (fault_naive p8 s23), `bea35380` 0. Single-process regression: identical correctness counts across 15 groups (`R3/summaries/runs/r3-analysis/r3-2026-10-08/r3-compare/R3_TABLES.md`; `P/EVIDENCE_INDEX.md` §8).

## 6.1.4 r4: completion optimisation and the F6 counterexample (`2118bc66`, PR #214)

E4 replay (75 runs/arm; `R4/summaries/runs/r4-analysis/r4-2026-10-08/r4-compare/R4_TABLES.md`):

| Pin | Completed /2,610 | Failed runs | Lost | Blocked |
|---|---|---|---|---|
| `2118bc66` | 1,748 | 0/75 | 0 | 862 (all `steward-final-patch-required`) |
| `bea35380` | 1,553 | 0 | 0 | 1,057 |
| `5692474f` | 1,580 | 5/75 | 6 | 1,024 |

Retry ablation 0/1/4: 1,718 / 1,752 / 1,748 (attempts 3–5 never triggered); `2118bc66` + harness lock 1,841, 0 lost. Barrier: `5692474f` seam total 40 lost, others 0. Single-process regression: steward `total_ms` mean +2.4% (`P/EVIDENCE_INDEX.md` §9).

**F6 counterexample.** With the lock holder and the contender in different PID namespaces (same worktree, same tmp), the PID-liveness-based lock recovery reclaimed a **live** holder's lock: `2118bc66` lost one effect in **10/10 runs in each direction** (`R4/summaries/runs/r4-validation/faults/`). This is a deployment-relevant counterexample, recorded per the §5.7 rule and not offset by the completion gain.

## 6.1.5 r5: the F6 fix (`37847584`, PR #216)

The fix replaces PID-liveness lock recovery with a **kernel advisory lock** (`lock.sqlite` `BEGIN IMMEDIATE`, component d2), adds lock-held orphan-temp cleanup (d3) and an optional per-target apply queue (d4) (§4.11).

**Table R3/R4 — E4 replay, four pins in one session** (75 runs and 2,610 intents per arm; `R5/summaries/runs/r5-analysis/r5-2026-10-08/r5-compare/R5_TABLES.md`):

| Pin / arm | Completed | Failed runs | Lost | Blocked (of which hash drift) | Exceptions | Re-compose events / succeeded |
|---|---|---|---|---|---|---|
| `5692474f` | 1,515 (58.1%) | 6/75 | 6 | 1,089 (795) | 0 | — |
| `bea35380` | 1,534 (58.8%) | 0 | 0 | 1,076 (768) | 0 | 19 / 2 |
| `2118bc66` | 1,727 (66.2%) | 0 | 0 | 883 (0) | 0 | 103 / 29 |
| `37847584` queue on | 1,716 (65.8%) | 0 | 0 | 894 | 3 | 0 |
| `37847584` queue off | 1,705 (65.3%) | 0 | 0 | 905 | 0 | 105 / 35 |

Remaining blocked intents on the fixed pins are all `steward-final-patch-required`. Re-compose ablation: queue on + 0/1 retries gave 1,719 / 1,746 with 0 re-compose events (**no discriminating power**). Post-hoc † exploratory queue-off arms: default/0/1 retries 1,759 (67.4%) / 1,679 (64.3%; 109 "recompose exhausted") / 1,723 (66.0%). The **same** queue-off setting gave 1,705 vs. 1,759 in different time slots (difference 54), so completion differences of this size are within scheduling noise.

**Table R5 — faults** (`R5/summaries/runs/r5-validation/faults/`, `…/barrier/`): seam barrier `5692474f` 40/40 lost, others 0; cross-PID namespace (real `unshare`) `2118bc66` **20/20 lost → `37847584` 0/20**, namespace separation confirmed 60/60; forged owner 10/10 lost → 0; orphan temp left by kill-before-rename 10/10 retained → deleted after lock acquisition 20/20; live temp files never deleted (60/60 = 3 placements × 10 runs × 2 arms, queue-on and queue-off; i.e. 30/30 per arm, which is how DRAFT-zh Table R5 reports it; `R5/summaries/runs/r5-validation/faults/main.summary.json`, scenario `O2-live-writer-temp`); E5 injections 12/12 on all five arms.

**Known limitation D6 (availability, not a §5.7 counterexample).** In the queue-on arm, an `SQLITE_BUSY` exception in the apply queue left **8 intents uncompleted** (fail-closed, 0 lost) and leaked presence files (`R5/summaries/runs/r5-validation/forensics/sqlite-busy/`).

## 6.1.6 r6: D6 fix (`b35a6141`, PR #238)

**Table R6** (150 runs and 5,220 intents per arm; `R6/summaries/runs/r6-analysis/r6-2026-10-09/r6-compare/R6_TABLES.md`):

| Pin / arm | Completed | Failed runs | Lost | Blocked | SQLite exceptions | Presence residue | Re-compose |
|---|---|---|---|---|---|---|---|
| `37847584` queue on | 3,490 (66.9%) | 0/150 | 0 | 1,730 | 1 (`ERR_SQLITE_ERROR database is locked`, 1 run) | 1 | — |
| `b35a6141` queue on | 3,500 (67.0%) | 0/150 | 0 | 1,720 | 0 | 0 | — |
| `b35a6141` queue off | 3,458 (66.2%) | 0/150 | 0 | 1,762 | 0 | 0 | 217 / 58 |

Full E4 cells: 213 / 209 / 210 of 318, 0 lost, 0 exceptions (`R6/raw/r6-matrix.tgz`). Queue stress (`R6/summaries/runs/r6-validation/forensics/sqlite-busy/`): pre-registered 8 processes × 300 × 3 = 7,200 applies, `37847584` 1 exception vs. `b35a6141` 0; † exploratory 16 × 1,000 × 3 = 48,000, 78 vs. 0 (presence residue 78 vs. 0). Faults on `b35a6141` (queue on/off): 0 lost, 0 frame damage; F6 namespace separation 40/40 with `both_inside_lock` 0; orphan temp deleted after lock 20/20; live temp 60/60 kept. Barrier: 6 cases × 10, 0 lost. Counterexamples: none — lost, corrupted and frame-damaged all 0.

Caveats (DRAFT-zh §6, R6): the core diff `37847584..b35a6141` also contains a deferred-load change to `sqlite-runtime.ts` outside PR #238 (D5); load average peaked around 11.5 during stress; the number of fallbacks to the file lock is **not observable** (D6); green CI does not prove the `unshare` test actually interlocked; single-process steward `total_ms` regressed 87.6 → 93.7 ms (+6.9%).

## 6.1.7 The EOF-newline bug (found by HIST v1.1, fixed in `b1fd9d22`)

The real-PR workload of 06b, pre-registered on pin `20effd45`, produced a counterexample on `sympy:26412_26438`: in 4 of 5 seeds the steward arm lost 1 effect and corrupted 1 file (steward totals over the 500 completed runs: **4 failed runs, 4 lost, 4 corrupted**, 1/100 pairs; the defect is deterministic and also present at `5692474f`) (`P/benchmark-main/2026-10-10-hist-main/GENERATION.md` results table; `…/STOP_REPORT.md`). The stopped run had completed only Django + SymPy (100 pairs × 5 arms × 5 seeds = 2,500 of 9,750 planned runs). Cause: the shared unified-diff parser mishandled `\ No newline at end of file`. Fix (component e, PR #252, `b1fd9d22`): the marker attaches to the previous line (deleted line → old side, added line → new side, context → both); hunks not reaching EOF inherit the base's trailing-newline state; deleting a final line without trailing newline keeps the previous line's newline; `applyUnifiedPatch`, the same-base composer and region re-compose share one decision. On the 100 overlapping pairs (500 runs), steward failed runs went **4/500 → 0/500**, completion 9,037 → 9,011; 234 of 2,500 runs changed counts through scheduling alone; only 1 of the 330 pairs can trigger the bug (`P/benchmark-main/2026-10-10-hist-main-v2/GENERATION.md` line 91; DRAFT-zh Table R10). The run was restarted on `b1fd9d22` as a recorded deviation (§17/§18 of `P/EVIDENCE_INDEX.md`).

## 6.1.8 What r1–r6 do and do not show

**Show:** on the final pins (`b35a6141`, `b1fd9d22`) and in the tested configurations, no lost effects, corrupted files or frame damage were observed; each counterexample found (r2 check-then-write, r4 F6, HIST EOF) was reproduced and then not re-observed after its fix.
**Do not show:** a proof of correctness; behaviour under crash/power loss, external writers, real containers or multi-file commits; statistical superiority of any pin. Every round's baseline variance is large (see 6.1.9). Completion of the steward is lower than a harness-locked arm (r4: 1,748 vs. 1,841).

## 6.1.9 Note on baseline variance across rounds

The same `5692474f` pin on the same E4 replay configuration yielded: r2 4 failed / 6 lost; r3 8 failed / 12 lost; r4 1,580 completed, 5/75 failed, 6 lost; r5 1,515 completed, 6/75 failed, 6 lost. Paper tables must report per-round values, never pool them.

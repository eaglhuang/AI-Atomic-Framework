# 6.2 Results II (historical record): HIST v1.1 Real-PR Workload

> Status: DRAFTED as a **historical, method-limited** result. It is not evidence for C1′–C3′ and must be presented after the three method defects (§1.6). Sources: pre-registration `P/benchmark-main/2026-10-10-hist-prereg-v1.1/PREREG_v1.1_zh.md` (pin `20effd45`); stopped generation `P/benchmark-main/2026-10-10-hist-main/` (`GENERATION.md`, `STOP_REPORT.md`); result generation `P/benchmark-main/2026-10-10-hist-main-v2/` (pin `b1fd9d22`, PR #252; `GENERATION.md`, `analysis/TABLES.md`, `DEVIATIONS.md`); DRAFT-zh Tables E4, R7–R12. Index: `P/EVIDENCE_INDEX.md` §17–§18. Author-executed, not independently reproduced, descriptive only.

## 6.2.1 Design (as pre-registered)

Six Python projects (Django, SymPy, xarray, pytest, Sphinx, FastAPI). Pairs of real merged PRs touching the same file, stratified by overlap: **O1** same hunk, **O2** nearby (1–3 lines), **O3** other region, plus **O0** controls. Main sample 300 pairs (O1 72 / O2 51 / O3 177), of which 189 pairs under rule v1.0 (final PR versions) and 111 under rule v1.1-P (option P: pre-rebase heads); 30 O0 pairs. Five seeds × five arms (`steward`, `file_lock`, `occ`, `git_three_way`, `bare_composer`). Runs: 7,500 main + 750 O0 + 1,500 old-pin (`5692474f`, steward only) = 9,750. Method follows STALE [Xia, Wu, Park, EXPRESS '26] (method only; no STALE data used).

**Why option P.** Under rule v1.0 only 7 O1 pairs existed, of which 1 had differing content; of 1,205 pairs excluded for drift, 1,164 (96.6%) came from rebasing. Using pre-rebase heads yields 62 differing O1 pairs (DRAFT-zh Table E4).

**Deviation.** The pre-registered pin `20effd45` was stopped on the EOF counterexample (06a §6.1.7) after 2,500 of 9,750 runs; the full run was redone on `b1fd9d22`. Both generations are sealed; the deviation is recorded in `DEVIATIONS.md`.

## 6.2.2 Main set (pin `b1fd9d22`; 1,500 runs and 34,300 intents per arm)

**Table R7** (`analysis/TABLES.md` §set: main; intent CI = pair bootstrap 95%, run CI = Wilson 95%):

| Arm | Completed | Failed runs | Failed pairs | Lost | Blocked | Corrupted |
|---|---|---|---|---|---|---|
| steward | 29,077 (84.8%; 81.2–88.0) | 0/1,500 | 0/300 (CP ≤ 1.2%) | 0 | 5,223 | 0 |
| file_lock | 29,691 (86.6%; 82.8–89.8) | 0/1,500 | 0/300 (CP ≤ 1.2%) | 0 | 4,609 | 0 |
| occ | 29,710 (86.6%; 83.0–89.8) | 10/1,500 | 10/300 | 32 | 4,558 | 0 |
| git_three_way | 31,215 (91.0%; 87.6–93.7) | 16/1,500 | 16/300 | 36 | 3,049 | 0 |
| bare_composer | 28,303 (82.5%; 78.9–85.6) | 2/1,500 | 1/300 | 0 | 5,994 | 3 |

bare_composer's 3 corrupted files are a duplicated 12-line insertion on `django:20101_20282` (seeds 0 and 1), identical to the stopped generation. Structure violations and extra files: 0 in all arms.

**Table R8 — steward blocked by final reason:** harness relocation 4,468, ATM hash drift 483, ATM re-compose mismatch 140, new file 120, other 12 (total 5,223). Harness relocation is a fail-closed stop in the shared harness **before** any ATM call (exact context, no fuzz) and is a harness design limit, not an ATM decision. (DRAFT-zh reports "4,480 harness relocation (85.8%)", i.e. 4,468 + the 12 "other"; see INDEX inconsistency list.)

**Table R9 — by stratum (steward):** O1 7,817/11,445 (68.3%); O2 6,600/7,580 (87.1%); O3 14,660/15,275 (96.0%); 0 failed runs in each. On O1, steward/file_lock/occ completion (68.3/68.3/68.7%) is bounded by the same relocation stops. On O3, steward's 615 blocks are ATM fail-closed decisions (453 hash drift, 117 re-compose, 45 new file), while file_lock completes 100.0%; occ lost 31 effects in 9 O3 runs, git_three_way 34 in 15 O3 runs. By writer version: final-version pairs 16,346/17,900 (91.3%), pre-rebase pairs 12,731/16,400 (77.6%).

**Paired (pair, seed) completed intents, steward higher / same / lower:** vs file_lock 23/1,148/329; vs occ 25/1,153/322; vs git_three_way 68/968/464; vs bare_composer 291/1,090/119. Descriptive; no test.

## 6.2.3 O0 controls and old pin

**O0** (30 pairs, 150 runs/arm): all arms 0 failed runs; steward and bare_composer 1,825/1,845 (98.9%), the 20 blocks are all new-file creations ATM cannot perform; other arms 100%.

**Old pin `5692474f`** (steward only, secondary; this is the single HIST v1.1 old-pin generation, not a pool of the r2–r5 E4 rounds, which 06a §6.1 reports per round): 28,803/34,300 (84.0%), 25/1,500 failed runs on 18/300 pairs, 57 lost effects, 5 corrupted files (4 = the EOF defect on `sympy:26412_26438`; 1 on `sphinx:11936_12959` with a structure violation); 19 of the failed runs are O3 (DRAFT-zh Table R11; `GENERATION.md`).

## 6.2.4 EOF counterexample and fix (Table R10)

See 06a §6.1.7: steward lost 4 / corrupted 4 → 0 / 0 on the 2,500 overlapping runs; completion 9,037 → 9,011 and blocked 1,799 → 1,829 (scheduling variation); 234 of 2,500 runs changed counts in baseline arms too.

## 6.2.5 Semantic endpoint (Table R12; weak evidence)

STALE method, union test patch, final/final pairs only. 219 pairs attempted (189 main v1.0 + 30 O0); 52 base-valid; 125 base-invalid (excluded), 28 without test modules, 14 with union-patch conflicts. Evaluable runs (any blocked intent ⇒ not evaluable): steward 168 (of 260), file_lock 250, occ 249, git_three_way 233, bare_composer 134. 0 arm regressions and 0 gold-relative regressions in every arm; every evaluated run matched gold bytes except 9 git_three_way runs that differ in bytes without a test regression. **Because the scorer counted skip/xfail as pass (defect 3), these zeros are weak evidence** as originally scored; the re-scoring below bounds them.

**Table R12-corrected — re-scored from sealed outputs (no rerun).** Rule: skip, xfail, xfail-not-run and module-skip are not-pass; a run whose status could have collapsed is "indeterminate". Raw test logs were not sealed (only `semantic/out/*.json`, which record failure sets but not per-test statuses), so exact separation is impossible; we use bounds. R1: a run whose final file is byte-identical to the gold merge executes identical code to the gold run, so it cannot show an arm regression under *any* status mapping. R2: a byte-differing run whose outcome rests on statuses the old parser collapsed (Django `expected failure`/`skipped` → pass; pytest XFAIL → pass; pytest SKIPPED was never parsed, so already not-pass) is indeterminate. R3: base-validity itself used the old mapping, so the 52-pair denominator is conditional. Script and output: `rescore-v1.1/rescore_v11.py`, `rescore-v1.1/out/rescore_v11.json` (input sha256s recorded), `rescore-v1.1/out/RESCORE.md`.

| Arm | Evaluable (original) | Arm regressions (original) | No regression, status-independent (R1) | Indeterminate (R2) | Regression | Not evaluable |
|---|---|---|---|---|---|---|
| steward | 168 | 0 | 168 | 0 | 0 | 92 |
| file_lock | 250 | 0 | 250 | 0 | 0 | 10 |
| occ | 249 | 0 | 249 | 0 | 0 | 11 |
| git_three_way | 233 | 0 | 224 | 9 | 0 | 27 |
| bare_composer | 134 | 0 | 134 | 0 | 0 | 126 |

The original counts reproduce exactly. The 9 indeterminate runs are all git_three_way on pytest-family pairs (`pytest_13955_13956` seeds 1–4, `xarray_9378_9482` seeds 0–4), where only an XFAIL collapse could hide a regression. **Corrected reading:** the zero-regression finding for steward, file_lock, occ and bare_composer survives the corrected mapping *conditional on the 52-pair base-valid set*; for git_three_way, 9 of 233 runs are undetermined. The endpoint remains descriptive and weak (final/final pairs, union test patch, conditional denominator).

## 6.2.6 Independence

The 300 main pairs involve 483 distinct PRs forming 183 shared-PR clusters (largest: 7 pairs) (DRAFT-zh §6). Intervals above are pair-level and therefore optimistic; HIST-v2 resamples shared-PR components instead.

## 6.2.7 Limitations specific to v1.1 (must accompany every citation)

1. **Batch size was always 1** (`expectedCount = 1`): this measures protected single-proposal apply plus concurrent cross-process commit, **not** cross-writer composition. No C2′ evidence.
2. **occ and git_three_way compared/merged outside the lock**: their 32 and 36 lost effects are harness artefacts, not properties of OCC or three-way merge under fair atomic commit. They must not be used as "baselines lose, ATM does not".
3. **Semantic scorer defect** (skip/xfail = pass; empty failure sets possible). Re-scoring from sealed outputs (Table R12-corrected) leaves 0 regressions in every arm, but 9 git_three_way runs are indeterminate and base-validity is conditional; raw logs would be needed for an exact re-score.
4. **Harness relocation** dominates O1/O2 blocks for all text-applying arms; O1 completion therefore says little about ATM.
5. **steward completes less than file_lock** (84.8% vs 86.6%; O3 96.0% vs 100.0%): fail-closed hash-drift/re-compose blocks have a measurable progress cost.
6. Single host, author-run, five seeds; scheduling alone changed 234/2,500 run outcomes.

**What v1.1 legitimately supports:** on the current pin, across 300 real-PR pairs × 5 seeds, the steward commit path showed 0 lost effects and 0 corrupted files (one-sided CP ≤ 1.2% failed pairs, pair-level), and the workload found one real parser bug (EOF) that the synthetic r1–r6 rounds had missed.

# Generation: benchmark-main/2026-10-10-hist-main-v2: HIST-PAIRS main run, full rerun on the EOF-fixed ATM (b1fd9d22)

ATM paper 2.0 (DRAFT). Historical real-PR workload under prereg v1.1 (`benchmark-main/2026-10-10-hist-prereg-v1.1/`, PR #243,
merge d2542646). **Author-executed, not independently reproduced.** CI only checks SHA256SUMS; it reruns nothing.
Descriptive only. No significance tests and no win claims. The 450-run matrix is still not done.

- **Why this generation exists.** The first main run (`benchmark-main/2026-10-10-hist-main/`, PR #250; left unchanged as the
  "before fix" record) was stopped by §5.7. The cause was ATM's EOF-newline defect on `sympy:26412_26438`. The user decided to fix
  ATM (PR #252, merge b1fd9d22) and then rerun all 9,750 runs on the fixed version as a new generation.
- **Gate before the run** (`forensics/`). At b1fd9d22, the single-writer repro of writer 26412's `actuator.py`
  gives steward bytes == oracle expected == `git apply` (0-byte difference). 20effd45 still gives +1 byte. Writer 26438's two files
  also match. The 25-run single-pair batch (`forensics/pair_run/`) has 0 lost effects and 0 corrupted files.
- **Run.** 2026-10-10 03:05:03 – 03:50:55 Asia/Taipei (write safety); semantic endpoint 03:50:55 – 06:02:37. ATM pin b1fd9d22.
  The harness is exactly as frozen: 38 files re-verified against the PINS hashes, no change. node v24.21.0, concurrency 3, seeds
  k = 0..4 from the frozen seed table. Inputs are byte-identical to the prereg sample.
- **Complete.** All 9,750 runs are present: main 300 pairs × 5 arms × 5 seeds = 7,500; O0 30 × 5 × 5 = 750; old pin 5692474f
  steward-only 300 × 5 = 1,500. Every run has a result.json; there are 0 harness errors and 0 timeouts.
- **§5.7: 0 steward counterexamples at b1fd9d22** (main and O0): 0 lost effects, 0 corrupted files, 0 failed runs.

## Main set (300 pairs, 1,500 runs per arm)
| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs | lost effects | blocked intents | corrupted files |
|---|---|---|---|---|---|---|
| steward | 29,077/34,300 = 84.8% (81.2–88.0%) | 0/1,500 (0.0–0.3%) | 0/300 (CP ≤1.2%) | 0 | 5,223 | 0 |
| file_lock | 29,691/34,300 = 86.6% (82.8–89.8%) | 0/1,500 (0.0–0.3%) | 0/300 (CP ≤1.2%) | 0 | 4,609 | 0 |
| occ | 29,710/34,300 = 86.6% (83.0–89.8%) | 10/1,500 (0.4–1.2%) | 10/300 | 32 | 4,558 | 0 |
| git_three_way | 31,215/34,300 = 91.0% (87.6–93.7%) | 16/1,500 (0.7–1.7%) | 16/300 | 36 | 3,049 | 0 |
| bare_composer | 28,303/34,300 = 82.5% (78.9–85.6%) | 2/1,500 (0.0–0.5%) | 1/300 | 0 | 5,994 | 3 |

Blocked intents by final reason. "Harness relocation" (including 12 overlap/reorder relocation stops counted as "other") is the
shared harness's fail-closed stop **before any ATM call**: exact context, no fuzz. It is a harness design limit, not an ATM
decision.
| arm | harness relocation | ATM hash drift | ATM re-compose mismatch | new file (ATM cannot create) | git conflict | git base drift | other (relocation overlap/reorder) |
|---|---|---|---|---|---|---|---|
| steward | 4,468 | 483 | 140 | 120 | 0 | 0 | 12 |
| file_lock | 4,597 | 0 | 0 | 0 | 0 | 0 | 12 |
| occ | 4,546 | 0 | 0 | 0 | 0 | 0 | 12 |
| git_three_way | 0 | 0 | 0 | 0 | 2,770 | 279 | 0 |
| bare_composer | 2,815 | 1,408 | 1,639 | 120 | 0 | 0 | 12 |

steward per stratum:
- **O1:** 7,817/11,445 (68.3%), 0/360 failed runs. Blocks: 3,587 relocation, 0 hash drift, 1 re-compose, 40 new file.
- **O2:** 6,600/7,580 (87.1%), 0/255 failed runs. Blocks: 881 relocation, 30 hash drift, 22 re-compose, 35 new file.
- **O3:** 14,660/15,275 (96.0%), 0/885 failed runs. Blocks: 0 relocation, 453 hash drift, 117 re-compose, 45 new file.

On O1 the completion of steward, file_lock and occ (68.3% / 68.3% / 68.7%) is bounded by the same relocation stops. On O3,
steward's 615 blocks are ATM fail-closed decisions (hash drift, re-compose, new file). file_lock completes 100% of O3; occ and
git_three_way lose effects there.

steward by writer version: final 16,346/17,900 (91.3%), pre-rebase (option P) 12,731/16,400 (77.6%); 0 failed runs in both.

Paired completed intents per (pair, seed), steward higher / same / lower:
- vs file_lock: 23 / 1,148 / 329
- vs occ: 25 / 1,153 / 322
- vs git_three_way: 68 / 968 / 464
- vs bare_composer: 291 / 1,090 / 119

Baseline losses, reported as is (they do not trigger §5.7):
- git_three_way: 36 lost effects in 16 runs (15 O3, 1 O2).
- occ: 32 lost effects in 10 runs (9 O3, 1 O2).
- bare_composer: 3 corrupted files, a duplicated 12-line insert on django:20101_20282 seeds 0 and 1, the same as in the stopped
  generation.

## O0 controls (30 pairs, 150 runs per arm)
All arms have 0 failed runs. steward and bare_composer complete 1,825/1,845 (98.9%); their 20 blocks are all new file (ATM cannot
create files). The other arms complete 100%.

## Old pin 5692474f (steward only, secondary; not a §5.7 condition)
28,803/34,300 = 84.0%. 25/1,500 failed runs (Wilson 1.1–2.4%) on 18/300 pairs, with 57 lost effects and 5 corrupted files.
- 4 of the corrupted files are the EOF defect on sympy:26412_26438.
- 1 is on sphinx:11936_12959, with a structure violation.
- 19 of the failed runs are O3.

So the older ATM loses effects on this workload and the current pin does not. This is reported, not claimed as a win.

## Semantic endpoint (STALE method, union test patch; final/final pairs only)
- **Coverage:** 219 pairs attempted (main rule v1.0 189 + O0 30). 52 are base-valid (both writers have fail-to-pass tests, as the
  prereg defines). 125 are base-invalid (excluded per prereg), 28 have no test modules, and 14 have a union test patch conflict.
- **Base-valid pairs, evaluated arm runs (runs with any blocked intent are not evaluable):** steward 168, file_lock 250, occ 249,
  git_three_way 233, bare_composer 134.
- **Regressions:** 0 arm regressions and 0 gold-relative regressions in every arm.
- **Bytes vs gold:** every evaluated run matches gold bytes, except 9 git_three_way runs, which differ in bytes but have no test
  regression.

Env deviations are in `DEVIATIONS.md`.

## Before/after vs the stopped generation (Django + SymPy, 2,500 overlapping runs): `analysis/BEFORE_AFTER.md`
steward:
- lost effects 4 → 0
- corrupted files 4 → 0
- failed runs 4 → 0
- completed intents 9,037 → 9,011, blocked 1,799 → 1,829 (scheduling variation)

On sympy:26412_26438, the four steward seeds that failed before (5 completed / 1 lost / 1 corrupted) now complete 6/6 committed
intents with 0 lost (seed 2 is 4 completed / 4 blocked in both). Runs are concurrent, so outcome counts also change in baseline
arms (234 of 2,500 runs changed counts). This is scheduling variation, not an effect of the ATM change.

Files:
- `raw/`: per-run results, oracle rows, worker logs, steward evidence, content-addressed final bytes, driver logs.
- `analysis/`: unchanged analysis script, before_after.py and their outputs.
- `semantic/`: script, lists, outputs, env freezes, probes.
- `forensics/`: the gate.
- `DEVIATIONS.md`, `PINS.json`, `build.sh`, `seal.py`.

Verify: `sh verify.sh .`

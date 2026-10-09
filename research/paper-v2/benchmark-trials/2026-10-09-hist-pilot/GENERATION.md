# Generation: benchmark-trials/2026-10-09-hist-pilot — 試跑 (TRIAL RUN / pilot), excluded from formal results

ATM paper 2.0 (DRAFT). Historical real-PR workload (STALE-style, arXiv:2609.25396 method cited, no STALE data used).
**Author-executed, not independently reproduced.** GitHub CI only checks that these files match SHA256SUMS; it does not rerun
the experiment. No win claims; descriptive only. Pilot pairs never enter the main sample. The main run (~9,750 runs) has NOT
been started and needs the author's sign-off.

- Stage: Django pilot (prereg §7.2): 30 pairs (O2 = 7, O3 = 10 + 13 backfilled from O3; O1 empty) x 5 arms x 2 seeds = 300 runs.
- ATM pin: b35a6141bd5bfbaec654f1cd3079323581b04074 (main after #238). `PINS.json`.
- Selection: `harness/hist-tools/SELECTION_RULES.md` (same frozen rules as the smoke generation; full mining data is in the
  smoke generation's `selection/`; this generation carries `selection/pairs_pilot_annot.jsonl` + `sample.json`).
- Deviations: `DEVIATIONS.md`.

## Results (raw: `raw/`, tables: `summaries/SUMMARY.md`)
| arm | completed/total intents | failed/total runs | lost effects | blocked intents | corrupted files |
|---|---|---|---|---|---|
| steward | 933/964 | 0/60 | 0 | 31 | 0 |
| file_lock | 962/964 | 0/60 | 0 | 2 | 0 |
| occ | 962/964 | 0/60 | 0 | 2 | 0 |
| git_three_way | 946/964 | 2/60 | 5 | 13 | 0 |
| bare_composer | 872/964 | 0/60 | 0 | 92 | 0 |

Blocked intents by final reason (hash-drift separate):
- steward: file-hash-drift = 22; compose-context-mismatch (re-compose) = 5; ATM cannot create a new file via steward patch = 4.
- bare_composer: compose-context-mismatch = 64; file-hash-drift = 24; new-file = 4.
- file_lock, occ: relocate-context-not-found = 2 each (harness relocation, fail-closed). git_three_way: git-base-drift = 13.

- steward (ATM, main method): 0 lost effects, 0 corrupted files, 0 structure violations, 0 extra/orphan files in 60 runs.
  No counterexample at b35a6141 on this workload.
- git_three_way (baseline, check-then-write without cross-process lock): 2 failed runs, 5 lost effects in total
  (django:18314_18384 seed 1: 4; django:19793_19873 seed 1: 1). Both writers committed the same file within ~40 ms; the later
  rename overwrote the earlier write (classic lost update). Expected for this baseline; reported, does not trigger §5.7.
- Identity completed + lost + blocked = total holds in all 300 runs; no timeouts; no harness errors.
- Semantic endpoint: base-valid 10/30 pairs, 2 not evaluable (union test patch conflict). Every evaluated arm run whose intents
  all completed was byte-identical to the gold composition; arm-attributed new failures = 0, gold-relative new failures = 0,
  historical interference (gold fails, solos pass) = 0.
- Independent oracle check: 239/241 fully-correct runs byte-identical to git's gold composition, 2 without gold, 0 disagree.
- Cost (for main-run estimate): 300 write-safety runs in 72 s wall at concurrency 3 (~0.5 s per run); semantic endpoint ~12 min
  for 30 pairs (3 parallel), under concurrent r6 load.

Interpretation limits: O1 (same-hunk) pairs are absent, so this pilot exercises same-file/different-region concurrency only;
completion differences between arms come mostly from fail-closed hash-drift and re-compose blocks, not from losses.

Verify (read-only): `sh verify.sh` in this directory.

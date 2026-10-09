# Generation: benchmark-trials/2026-10-09-hist-smoke — 試跑 (TRIAL RUN), excluded from formal results

ATM paper 2.0 (DRAFT). Historical real-PR workload (STALE-style, arXiv:2609.25396 method cited, no STALE data used).
**Author-executed, not independently reproduced.** GitHub CI only checks that these files match SHA256SUMS; it does not rerun
the experiment. No win claims. Smoke pairs never enter pilot or main samples.

- Stage: smoke (prereg §7 stage 1 pre-check, author-approved "small first"): Django, 3 pairs x 5 arms x 1 seed = 15 arm runs,
  plus 15 planted-fault runs (5 kinds x 3 pairs) to prove the oracle flags lost effects and corruption.
- ATM pin: b35a6141bd5bfbaec654f1cd3079323581b04074 (main after #238). Pins, tool versions, harness hashes: `PINS.json`.
- Selection: `harness/hist-tools/SELECTION_RULES.md` (frozen; hashes in `SELECTION_RULES.sha256`), full mining data in
  `selection/` (PR snapshot, eligibility with reason codes, all candidate pairs, sample). Upstream code excerpts: `third_party/django/NOTICE.md`.
- Deviations: `DEVIATIONS.md` (notably: O1 same-hunk stratum is EMPTY for Django 2024-2025 under the frozen rules).

## Results (raw: `raw/`, tables: `summaries/SUMMARY.md`, `summaries/summary.json`)
| arm | completed/total intents | failed/total runs | lost effects | blocked intents | corrupted files |
|---|---|---|---|---|---|
| steward | 69/71 | 0/3 | 0 | 2 (ATM cannot create a new file via steward patch: `file-hash-drift: Target file does not exist`) | 0 |
| file_lock | 71/71 | 0/3 | 0 | 0 | 0 |
| occ | 71/71 | 0/3 | 0 | 0 | 0 |
| git_three_way | 71/71 | 0/3 | 0 | 0 | 0 |
| bare_composer | 61/71 | 0/3 | 0 | 10 (8 compose-context-mismatch re-compose, 2 new-file) | 0 |

- No structure (ast) violations, no extra files, identity completed+lost+blocked=total holds in every run. No counterexample.
- Planted faults: 15/15 detected (raw overwrite -> 5/7/9 lost effects; reverted hunk -> 1 lost; flipped frame byte -> 1 corrupted
  file; torn tail -> corrupted + lost; foreign file / orphan `.atm-tmp` -> run failed).
- Semantic endpoint (new failures after merging only): 1 of 3 pairs base-valid; 0 new failures in any evaluated arm run.
- Independent check: every fully-correct run is byte-identical to git's gold composition (7) or differs only by a PR-created empty
  file that has no hunks (3); 0 disagreements (`raw/crosscheck_gold.json`).

Verify (read-only): `sh verify.sh` in this directory.

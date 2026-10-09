# Generation: benchmark-trials/2026-10-10-hist-confirm-v1.1 — 試跑 (TRIAL, small confirmation), excluded from formal results

ATM paper 2.0 (DRAFT). HIST-PAIRS prereg v1.1 small confirmation before the main run. **Author-executed, not independently
reproduced.** CI only checks SHA256SUMS. No win claims. These pairs were drawn AFTER the main sample from the residual option-P
pool (PCG64(20261010), `benchmark-main/2026-10-10-hist-prereg-v1.1/scripts/sample_main_v11.py`), so they are not in the main sample.

- Run 2026-10-10 00:14–00:16 Asia/Taipei, ATM pin 20effd45 (core == b35a6141), old pin 5692474f, pilot harness unchanged
  (PINS.json), node v24.21.0, concurrency 3. Harness contract tests: 19/19 pass (`raw/contract_test_output.txt`).
- Pairs (`inputs/pairs_confirm.jsonl.gz`): xarray:8750_8758 (O1 divergent, pre-rebase writer, 18 intents),
  xarray:10137_10251 (O1 divergent, pre-rebase, 41), sphinx:12796_12888 (O3, P, 2), fastapi:11194_12103 (O3, P, 11),
  django:17554_19685 (O3, P, 74; includes 1 new file).
- Runs: 5 pairs x 5 arms x seed 0 = 25 (`raw/arms`); planted faults on the O1 pair xarray:8750_8758 = 5 plant runs + 1 clean
  steward reference (`raw/plants`); old pin steward x 5 pairs (`raw/oldpin`, feasibility of the old-pin set). Total 36 runs.

## Results (current pin, seed 0, 5 pairs)
| arm | completed/total intents | failed/total runs | lost effects | blocked intents | corrupted files |
|---|---|---|---|---|---|
| steward | 130/146 | 0/5 | 0 | 16 | 0 |
| file_lock | 131/146 | 0/5 | 0 | 15 | 0 |
| occ | 131/146 | 0/5 | 0 | 15 | 0 |
| git_three_way | 130/146 | 0/5 | 0 | 16 | 0 |
| bare_composer | 138/146 | 0/5 | 0 | 8 | 0 |
| steward @ old pin 5692474f | 129/146 | 0/5 | 0 | 17 | 0 |

Blocked by final reason (hash drift separate):
- steward: harness relocation context not found 15 (13 on the O1 pair xarray:8750_8758 + 2 on xarray:10137_10251; fail-closed
  BEFORE the ATM call); new file (ATM reports "file-hash-drift: Target file does not exist") 1. Hash drift 0.
- file_lock 15 / occ 15: relocation context not found. git_three_way: merge conflict 15, git-base-drift 1.
- bare_composer: file-hash-drift 3 + new file 1, compose-context-mismatch (ATM composer) 2, relocation 2.
- old pin steward: relocation 15, stale canonical base hash 1, new file 1.
- Identity completed + lost + blocked = total holds in all 30 non-plant runs; no timeouts, no harness errors, no structure
  violations, no extra/orphan files. **No steward lost effect or corrupted file: no §5.7 counterexample.**

## Planted faults (oracle validation, O1 pair xarray:8750_8758) — 5/5 flagged
| plant | oracle verdict |
|---|---|
| planted_raw_overwrite (blind write, both writers) | run failed: 1 lost effect, 3 overlap_both_applied (misplaced), 1 corrupted file |
| plant_revert_hunk | run failed: 1 lost effect |
| plant_flip_frame_byte | run failed: 1 corrupted file (frame) |
| plant_torn_tail | run failed: 1 corrupted file + 1 structure (ast) violation |
| plant_foreign_file (+ orphan .atm-tmp) | run failed: foreign write / extra file |

## Interpretation limits (also for the main run)
- On the O1 pairs, steward, file_lock and occ all block the same writer's file at the harness relocation step (exact
  ctx+pre+ctx, no fuzz) before anything is written, so these O1 blocks measure the shared harness submission design, not ATM's
  composer. Only bare_composer reached ATM's compose-context check on O1 here. The main-run analysis reports blocked intents by
  final reason so this is visible.
- 1 seed, 5 pairs: trial only, not a result.
- Verify (read-only): `sh verify.sh .` in this directory.

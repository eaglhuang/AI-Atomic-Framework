# Generation: benchmark-main/2026-10-10-hist-prereg-v1.1 — HIST-PAIRS pre-registration v1.1 (frozen) + main sample

ATM paper 2.0 (DRAFT). Historical real-PR workload (STALE method cited, arXiv:2609.25396; no STALE data used).
**This generation contains NO run results.** It fixes, before any main-run result exists, the selection rules, seeds,
the drawn main sample (300 pairs + 30 O0 controls), the per-run seed table (9,750 planned runs) and the pins.
Author-executed, not independently reproduced. CI only checks that files match SHA256SUMS. No win claims.

- Author decision: 2026-10-10 00:05 Asia/Taipei — adopt prereg v1.1 option P (pre-rebase head for PRs rebased onto their
  partner), small confirmation run, then the main run.
- Prereg text: `PREREG_v1.1_zh.md` (changes vs v1.0 only; v1.0 = `inputs/HISTORICAL_BENCH_PREREG_v1.0_zh.md` + approved defaults).
- Freeze receipt (written before the draw, 2026-10-10 00:13:09 +0800): `FREEZE_RECEIPT.txt` (sha256 of prereg, scripts, inputs,
  external mining inputs and regenerable P payloads).
- Scripts: `scripts/build_pairs_v11p.py` (option-P pairs), `scripts/sample_main_v11.py` (draw). Inputs: mining generation
  `benchmark-trials/2026-10-09-hist-mining/` (PR #242), trial exclusions `inputs/trial_sample.json` (33 smoke/pilot pairs).
- Option-P candidate pool (`candidates_v11p/<project>/`): 405 pairs; O1 divergent 72, O1 identical 5, O2 39, O3 289.
- Main sample (`sample/sample_main.json`, payloads `sample/pairs_main.jsonl.gz`): 300 pairs = 6 projects x 50.
  Strata O1 72 / O2 51 / O3 177; rule v1.0 189 / v1.1-P 111. O1: divergent pre-rebase 62, divergent final 1, identical 9
  (6 v1.0 + 3 P).

| project | O1 | O2 | O3 | backfilled | rule v1.1-P |
|---|---|---|---|---|---|
| Django | 6 | 2 | 42 | O3 26 | see sample_main.json |
| SymPy | 17 | 5 | 28 | O3 12 | |
| xarray | 17 | 17 | 16 | 0 | |
| pytest | 6 | 11 | 33 | O3 17 | |
| Sphinx | 18 | 8 | 24 | O1 1, O3 8 | |
| FastAPI | 8 | 8 | 34 | O3 18 | |

- O0 controls: 30 pairs (5 per project), `sample/pairs_o0.jsonl.gz`.
- Planned runs (`sample/run_plan.jsonl`): main 300 x 5 arms x 5 seeds = 7,500; old pin 5692474f steward 300 x 5 = 1,500;
  O0 30 x 5 x 5 = 750; total 9,750. Seeds sha256("hist-v1|pair_id|k")[0:4], k = 0..4, independent of arm.
- Endpoints: write safety for every pair; semantic (STALE) endpoint ONLY for final/final pairs that pass base validity. Every pair
  with a pre-rebase writer (all O1-P pairs) is write-safety only; its semantic endpoint is "not evaluable", never 0.
- Confirmation trial pairs (`sample/pairs_confirm.jsonl.gz`, drawn after main/O0 from the residual P pool, PCG64(20261010)):
  results are a TRIAL, kept in a separate trial folder, excluded from formal results.
- Pins: `PINS.json` (ATM 20effd45 = main at freeze; packages/core identical to b35a6141; old pin 5692474f; harness = pilot harness).
- Upstream code: `sample/*.jsonl.gz` contain base-file texts and hunks regenerated from public upstream history (permissive
  licenses; `licenses/`, `NOTICE.md`), per the approved Q3 default.
- Deviations: `DEVIATIONS.md`. Verify (read-only): `sh verify.sh .` in this directory.

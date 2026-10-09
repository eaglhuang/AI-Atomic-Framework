# Generation: benchmark-main/2026-10-10-hist-main — HIST-PAIRS main run (STOPPED by §5.7 after 2 of 6 projects)

ATM paper 2.0 (DRAFT). Historical real-PR workload under prereg v1.1 (`benchmark-main/2026-10-10-hist-prereg-v1.1/`, PR #243,
merge d2542646). **Author-executed, not independently reproduced.** CI only checks SHA256SUMS; it does not rerun anything.
Descriptive only; no win claims. The 450-run matrix remains not done.

- Run 2026-10-10 00:33:15 – 00:45:04 Asia/Taipei. ATM pin 20effd45 (packages/core == b35a6141), harness exactly as frozen
  (PINS.json; no change), node v24.21.0, concurrency 3, seeds k = 0..4 per the frozen seed table.
- **Stopped by the pre-registered stop rule** after the SymPy batch: steward lost effect + corrupted file on
  `sympy:26412_26438` in 4/5 seeds — see `STOP_REPORT.md` (deterministic ATM EOF-newline defect, also at 5692474f).
- Completed: Django 50 pairs and SymPy 50 pairs x 5 arms x 5 seeds = 2,500 runs (of 9,750 planned). Not run: xarray, pytest,
  Sphinx, FastAPI main batches, O0 controls, old-pin set, semantic endpoint.

## Results (Django + SymPy, 100 pairs, 500 runs per arm)
| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs | lost effects | blocked intents | corrupted files |
|---|---|---|---|---|---|---|
| steward | 9,037/10,840 = 83.4% (75.0–90.2%) | 4/500 (0.3–2.0%) | 1/100 | **4** | 1,799 | **4** |
| file_lock | 9,269/10,840 = 85.5% (77.0–92.4%) | 0/500 (0.0–0.8%) | 0/100 | 0 | 1,571 | 0 |
| occ | 9,221/10,840 = 85.1% (76.5–92.1%) | 4/500 (0.3–2.0%) | 3/100 | 24 | 1,595 | 0 |
| git_three_way | 9,707/10,840 = 89.5% (81.1–95.5%) | 5/500 (0.4–2.3%) | 5/100 | 24 | 1,109 | 0 |
| bare_composer | 8,783/10,840 = 81.0% (72.6–87.8%) | 3/500 (0.2–1.7%) | 2/100 | 1 | 2,054 | 3 |

Blocked intents by final reason. Harness relocation is the shared harness's fail-closed stop BEFORE any ATM call (exact
context, no fuzz); it is a harness design limit, not an ATM decision:
| arm | harness relocation | ATM hash drift | ATM re-compose mismatch | new file (ATM cannot create) | git conflict | git base drift | other |
|---|---|---|---|---|---|---|---|
| steward | 1,567 | 175 | 22 | 35 | 0 | 0 | 0 |
| file_lock | 1,571 | 0 | 0 | 0 | 0 | 0 | 0 |
| occ | 1,595 | 0 | 0 | 0 | 0 | 0 | 0 |
| git_three_way | 0 | 0 | 0 | 0 | 1,021 | 88 | 0 |
| bare_composer | 950 | 519 | 550 | 35 | 0 | 0 | 0 |

steward per stratum: O1 1,898/3,325 (57.1%), 4/115 failed runs, 1,403 relocation blocks, 0 ATM hash-drift, 0 re-compose, 20 new
file; O2 1,186/1,350 (87.9%), 0/35, 164 relocation; O3 5,953/6,165 (96.6%), 0/350, 0 relocation, 175 ATM hash drift, 22
re-compose, 15 new file. On O1/O2 the completion of steward, file_lock and occ is bounded by the same relocation blocks.
Full tables (per stratum, project, writer version, O1 kind, paired counts): `analysis/TABLES.md`, `analysis/tables.json`.

Baseline losses (reported as is, do not trigger §5.7): git_three_way 24 lost effects in 5 runs (O3, classic lost update without
a cross-process lock); occ 24 in 4 runs (O3); bare_composer 1 lost + 3 corrupted files (django:20101_20282 seeds 0, 1:
duplicated insert of 12 lines; sympy:26412_26438 seed 0: same EOF defect as steward). Identity completed + lost + blocked +
misplaced + duplicate + leak = total holds in every run; no timeouts, no harness errors, no extra/orphan files.

Files: `raw/` (per-run results, oracle rows, worker logs, steward evidence, content-addressed final bytes, driver log),
`analysis/` (pre-written analysis script + outputs), `forensics/` (EOF repro), `semantic-prep/` (multi-project semantic script,
env freezes, env probes; endpoint not run), `STOP_REPORT.md`, `DEVIATIONS.md`, `PINS.json`. Verify: `sh verify.sh .`.

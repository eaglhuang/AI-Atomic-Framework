# D5 — RQ2 main-method freeze + D-ladder summary

**Status:** done (2026-10-07 21:35 CST)  
**Harness:** `/workspace/reports/atm-v2-harness`  
**ATM pin:** `5692474f7db70ab52a7a71c8af4867609e7e4b43`  
**Ladder:** D1–D5 **complete** → next **E1** pilot

## Main-method freeze (RQ2)

**Only** `--arm steward` is `arm_role: main_method` / `rq: RQ2`.

```bash
export ATM_MONOREPO=/path/to/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
node src/cli.mjs start --arm steward --atm-backend real --compose-window-ms 100 \
  --seed 11 --agents 3 --trials 5 --hot-ratio 1 --overlap high --force
```

Equivalents: `--arm main`. Metadata (`src/arms.mjs` / `MAIN_METHOD_INVOCATION`):  
`arm_role=main_method`, `rq=RQ2`, `diagnostic=false`, `correctness_competitor=true`.

What this runs (unchanged algorithms from C1): Real ATM admit → compose window → `composeBrokerProposals` → neutral `applyStewardPlan` → C3 oracle.

## Arm roles (D ladder + C4 diagnostics)

| arm | checklist | role | rq | competitor? |
|-----|-----------|------|-----|-------------|
| **steward** | **D5 / C1** | **main_method** | **RQ2** | yes |
| file_lock | D1 | baseline_serial | RQ2-baseline | yes |
| occ | D2 | baseline_occ | RQ2-baseline | yes |
| git_three_way | D3 | baseline_git | RQ2-baseline | yes |
| bare_composer | D4 | baseline_bare_composer | RQ2-ablation | yes |
| ideal_sync | C4 | upper_bound | diagnostic | **no** |
| admission_only | C4 | motivation | diagnostic | **no** |
| raw_overwrite | C4 | baseline_raw | diagnostic | **no** |

## Smoke table (seed 11, agents 3, trials 5, hot=1, overlap=high, hold 8–25 ms, compose-window 100, real ATM where applicable)

Runs: `runs/d5-<arm>/`. Raw: `runs/baselines/d5_compare_raw.json`.

| arm | rq | arm_role | diag | competitor | correct | lost | blocked | mean wait | mean admit | mean overhead | wall_ms |
|-----|-----|----------|------|------------|---------|------|---------|-----------|------------|---------------|---------|
| `steward` **MAIN** | RQ2 | `main_method` | N | Y | 15 | 0 | 0 | 23.8 | 27.14 | 71.15 | 612.24 |
| `file_lock` | RQ2-baseline | `baseline_serial` | N | Y | 15 | 0 | 0 | 6.53 | 9.98 | 19.94 | 223.41 |
| `occ` | RQ2-baseline | `baseline_occ` | N | Y | 15 | 0 | 0 | 4.33 | 7.6 | 12.42 | 171.92 |
| `git_three_way` | RQ2-baseline | `baseline_git` | N | Y | 15 | 0 | 0 | 17.13 | 20.26 | 133.39 | 827.72 |
| `bare_composer` | RQ2-ablation | `baseline_bare_composer` | N | Y | 12 | 0 | 3 | 0 | 0.03 | 137.38 | 821.48 |
| `ideal_sync` | diagnostic | `upper_bound` | Y | N | 15 | 0 | 0 | 3.53 | 6.69 | 9.04 | 164.99 |
| `admission_only` | diagnostic | `motivation` | Y | N | 9 | 6 | 0 | 2.13 | 5.24 | 7.62 | 164.05 |
| `raw_overwrite` | diagnostic | `baseline_raw` | Y | N | 8 | 7 | 0 | 0 | 0 | 0.4 | 104.05 |

### Reading the table

- **Steward (MAIN)** reaches correct=15 / lost=0 with non-zero admit/wait (governance cost).
- **D1 file_lock / D2 occ / D3 git_three_way** also correct=15 on this seed (different cost profiles).
- **D4 bare_composer** correct=12 / blocked=3: admission bypass batches overlapping peers that full steward serializes via provisional — ablation, not a failure of compose APIs.
- **C4 diagnostics:** `admission_only` / `raw_overwrite` show lost updates (motivation); `ideal_sync` is cheap upper bound (not a competitor).

## Index of D/C notes

| Doc | Path |
|-----|------|
| D5 summary (this) | `runs/baselines/D5_SUMMARY.md` |
| D1–D4 | `runs/baselines/D{1..4}.md` + `runs/steward-writer/STEWARD_WRITER_D{1..4}.md` |
| C1–C4 | `runs/steward-writer/STEWARD_WRITER_C{1..4}.md` |
| Arm catalog | `src/arms.mjs` |

## Gaps → E1 pilot

- E1: scale pilot matrix (agents/trials/seeds) using **frozen** `--arm steward` + selected foils.
- Still open from earlier: `logical_id` decoupling, `artifact_manifest.json` / `reproduce.sh` (A5/F3), multi-process compose window.
- Final ATM artifact tag still TBD in VERSION_ANCHORS (needs E matrix numbers).

**E1 pilot done** (2026-10-07 22:50 CST). Next default: **E2** (do not auto-start).

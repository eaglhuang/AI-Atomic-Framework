# E2 — Main matrix summary

> **DRAFT evidence — not a win claim / 不宣稱勝出 / no RQ2「勝出」**

| 欄位 | 內容 |
|------|------|
| Status | **done**（2026-10-07 22:55:42 CST） |
| Harness | `/workspace/reports/atm-v2-harness` |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀） |
| Main method | `--arm steward`（D5 凍結） |
| Scale | 3 workloads × 5 主臂 × **10** workload seeds；agents×trials=`3×5`（E1 parity） |
| Seeds | 預登記 `SEEDS_REGISTERED.md` / `seeds.json`（**跑前**）；`scheduler = workload + 1000` |
| Seed proof | 150/150 cells `scenario_seed ≠ scheduler_seed`；30/30 paired scenario_hash 五臂一致 |
| Raw | `runs/e2-matrix/e2_compare_raw.json`；per-cell `runs/e2-<wl>-<arm>-s<seed>/` |
| Runner | `runs/e2-matrix/run_matrix.sh` |
| Wall | matrix ~98 s（Node v24.21.0；150 cells＋2 diag） |

## 指標口徑（A2）

| 指標 | 定義（本矩陣） |
|------|----------------|
| **正確完成率（輔）** | `correct / eligible`（oracle `n_eligible`；本 harness eligible≈offered） |
| **正確完成率（主，A2 §1.5）** | `correct / offered`（`n_effects`） |
| **eligible coverage** | `eligible / offered`（預先登記；**非**受測方法 accept 集合） |
| **goodput** | `correct / wall_seconds`（`wall_clock_ms`＝first submit→last decision） |
| **延遲** | decision 事件 `admission_ms`／`total_ms` 的 nearest-rank **p50／p95／p99** |
| **retry** | `cas_retry` Σ／mean；`repropose_rounds` Σ（steward stub 多為 0） |

## 配對 traces

同一 `(workload_id, workload_seed, scheduler_seed)` 在五臂各一格；結構＋時序一致 → scenario_hash 五臂相同。
Workload seed ≠ scheduler seed（公式 `+1000`）；artifact 見每格 `meta.scenario_seed`／`meta.scheduler_seed`。

## E1 → E2 scale delta

| 項 | E1 pilot | E2 main |
|----|----------|---------|
| workload seeds | 3 `{11,17,23}` | **10** `{11…53}`（含 E1 三粒） |
| scheduler seed | ＝workload（單流） | **獨立** `workload+1000`；hold/jitter 覆寫 |
| cells | 45 | **150** |
| agents×trials | 3×5 | **3×5**（維持可比；非 4×10） |
| 指標 | correct/lost/blocked/admit/wall | ＋rate／coverage／goodput／p50–p99／retry |
| 宣稱 | pilot only | **仍 DRAFT；不宣稱勝出** |

註：E2 同數字 workload seed 的 **結構**與 E1 單流相同，但 hold/jitter 經 scheduler 覆寫 → 不可把 E1/E2 同 seed wall 當 paired 延遲比較。

## 彙總 — 跨 10 seeds（mean±母體 σ）

| workload | arm | role | correct±σ | lost | blocked±σ | rate_elig | rate_off | elig_cov | goodput±σ | wall±σ |
|----------|-----|------|-----------|------|-----------|-----------|----------|----------|-----------|--------|
| `cold` | `steward` | `main_method` | 13.0±1.26 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 38.66±1.83 | 335.83±22.63 |
| `cold` | `file_lock` | `baseline_serial` | 13.0±1.26 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 92.91±8.69 | 140.77±15.73 |
| `cold` | `occ` | `baseline_occ` | 13.0±1.26 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 88.31±7.4 | 147.88±15.78 |
| `cold` | `git_three_way` | `baseline_git` | 12.8±1.54 | 0.0 | 0.2±0.6 | 0.9833 | 0.9833 | 1.0 | 18.11±1.99 | 709.53±71.48 |
| `cold` | `bare_composer` | `baseline_bare_composer` | 11.6±1.8 | 0.0 | 1.4±1.28 | 0.8919 | 0.8919 | 1.0 | 14.29±1.8 | 809.65±49.39 |
| `hot_disjoint` | `steward` | `main_method` | 13.2±1.47 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 30.35±3.77 | 441.57±70.73 |
| `hot_disjoint` | `file_lock` | `baseline_serial` | 13.2±1.47 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 87.72±8.7 | 150.96±14.24 |
| `hot_disjoint` | `occ` | `baseline_occ` | 13.2±1.47 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 89.06±7.36 | 148.65±16.1 |
| `hot_disjoint` | `git_three_way` | `baseline_git` | 13.2±1.47 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 18.52±2.54 | 721.97±98.65 |
| `hot_disjoint` | `bare_composer` | `baseline_bare_composer` | 12.0±2.28 | 0.0 | 1.2±1.6 | 0.9064 | 0.9064 | 1.0 | 14.74±2.4 | 812.02±54.56 |
| `hot_conflict` | `steward` | `main_method` | 13.9±1.04 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 26.11±2.9 | 538.89±69.53 |
| `hot_conflict` | `file_lock` | `baseline_serial` | 13.9±1.04 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 76.26±9.92 | 186.33±34.48 |
| `hot_conflict` | `occ` | `baseline_occ` | 13.9±1.04 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 87.9±9.02 | 159.74±20.03 |
| `hot_conflict` | `git_three_way` | `baseline_git` | 13.9±1.04 | 0.0 | 0.0±0.0 | 1.0 | 1.0 | 1.0 | 17.35±1.29 | 803.26±57.42 |
| `hot_conflict` | `bare_composer` | `baseline_bare_composer` | 8.7±2.93 | 0.0 | 5.2±3.49 | 0.6361 | 0.6361 | 1.0 | 10.61±3.56 | 818.71±11.24 |

## 延遲／retry 彙總（跨 seeds：各格 percentile 再平均）

| workload | arm | admit p50／p95／p99 | total p50／p95／p99 | cas_retry Σ mean | repropose Σ mean |
|----------|-----|---------------------|--------------------|------------------|------------------|
| `cold` | `steward` | 2.62／37.3／37.3 | 36.28／154.46／154.46 | 0.1 | 0.0 |
| `cold` | `file_lock` | 2.78／17.18／17.18 | 22.73／39.83／39.83 | 0.2 | 0.0 |
| `cold` | `occ` | 3.04／18.65／18.65 | 24.2／41.14／41.14 | 0.3 | 0.3 |
| `cold` | `git_three_way` | 2.76／82.1／82.1 | 130.12／210.94／210.94 | 0.0 | 0.0 |
| `cold` | `bare_composer` | 0.02／0.18／0.18 | 130.39／296.26／296.26 | 0.2 | 0.0 |
| `hot_disjoint` | `steward` | 2.86／51.93／51.93 | 48.14／188.63／188.63 | 1.8 | 0.0 |
| `hot_disjoint` | `file_lock` | 3.05／17.94／17.94 | 25.77／43.23／43.23 | 4.2 | 0.0 |
| `hot_disjoint` | `occ` | 3.56／18.92／18.92 | 25.4／41.39／41.39 | 4.2 | 4.2 |
| `hot_disjoint` | `git_three_way` | 3.09／70.25／70.25 | 131.44／200.08／200.08 | 0.6 | 0.0 |
| `hot_disjoint` | `bare_composer` | 0.02／0.18／0.18 | 130.66／299.24／299.24 | 0.0 | 0.0 |
| `hot_conflict` | `steward` | 3.03／153.52／153.52 | 52.69／265.74／265.74 | 2.4 | 0.0 |
| `hot_conflict` | `file_lock` | 3.12／27.38／27.38 | 27.7／59.42／59.42 | 5.4 | 0.0 |
| `hot_conflict` | `occ` | 3.13／24.0／24.0 | 25.44／45.31／45.31 | 5.8 | 5.8 |
| `hot_conflict` | `git_three_way` | 2.84／120.24／120.24 | 130.91／248.81／248.81 | 0.6 | 0.0 |
| `hot_conflict` | `bare_composer` | 0.02／0.16／0.16 | 129.79／293.03／293.03 | 0.2 | 0.0 |

## 每格主表（workload × arm × seed）— 正確性／goodput

| workload | arm | wl_seed | sch_seed | offered | eligible | correct | lost | blocked | rate_elig | goodput | wall_ms | casΣ |
|----------|-----|---------|----------|---------|----------|---------|------|---------|-----------|---------|---------|------|
| `cold` | `steward` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 39.58 | 353.73 | 0 |
| `cold` | `steward` | 17 | 1017 | 11 | 11 | 11 | 0 | 0 | 1.0 | 34.84 | 315.71 | 0 |
| `cold` | `steward` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 38.9 | 282.8 | 0 |
| `cold` | `steward` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 40.67 | 344.22 | 0 |
| `cold` | `steward` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 38.4 | 338.55 | 0 |
| `cold` | `steward` | 37 | 1037 | 13 | 13 | 13 | 0 | 0 | 1.0 | 38.04 | 341.79 | 0 |
| `cold` | `steward` | 41 | 1041 | 14 | 14 | 14 | 0 | 0 | 1.0 | 38.35 | 365.03 | 0 |
| `cold` | `steward` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 41.91 | 357.93 | 0 |
| `cold` | `steward` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 38.92 | 334.04 | 0 |
| `cold` | `steward` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 36.98 | 324.53 | 1 |
| `cold` | `file_lock` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 98.61 | 141.98 | 0 |
| `cold` | `file_lock` | 17 | 1017 | 11 | 11 | 11 | 0 | 0 | 1.0 | 100.36 | 109.6 | 0 |
| `cold` | `file_lock` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 86.57 | 127.06 | 0 |
| `cold` | `file_lock` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 86.45 | 161.95 | 1 |
| `cold` | `file_lock` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 82.91 | 156.8 | 0 |
| `cold` | `file_lock` | 37 | 1037 | 13 | 13 | 13 | 0 | 0 | 1.0 | 90.43 | 143.75 | 0 |
| `cold` | `file_lock` | 41 | 1041 | 14 | 14 | 14 | 0 | 0 | 1.0 | 109.25 | 128.15 | 0 |
| `cold` | `file_lock` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 95.54 | 157 | 0 |
| `cold` | `file_lock` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 99.01 | 131.3 | 0 |
| `cold` | `file_lock` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 79.94 | 150.12 | 1 |
| `cold` | `occ` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 98.91 | 141.54 | 0 |
| `cold` | `occ` | 17 | 1017 | 11 | 11 | 11 | 0 | 0 | 1.0 | 96.57 | 113.91 | 0 |
| `cold` | `occ` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 79.09 | 139.08 | 0 |
| `cold` | `occ` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 80.35 | 174.23 | 1 |
| `cold` | `occ` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 79.46 | 163.6 | 0 |
| `cold` | `occ` | 37 | 1037 | 13 | 13 | 13 | 0 | 0 | 1.0 | 85.02 | 152.9 | 0 |
| `cold` | `occ` | 41 | 1041 | 14 | 14 | 14 | 0 | 0 | 1.0 | 95.43 | 146.7 | 1 |
| `cold` | `occ` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 92.98 | 161.32 | 0 |
| `cold` | `occ` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 92.95 | 139.86 | 0 |
| `cold` | `occ` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 82.36 | 145.71 | 1 |
| `cold` | `git_three_way` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 19.56 | 715.72 | 0 |
| `cold` | `git_three_way` | 17 | 1017 | 11 | 11 | 11 | 0 | 0 | 1.0 | 16.38 | 671.52 | 0 |
| `cold` | `git_three_way` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 19.75 | 556.84 | 0 |
| `cold` | `git_three_way` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 17.36 | 806.54 | 0 |
| `cold` | `git_three_way` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 16.59 | 783.6 | 0 |
| `cold` | `git_three_way` | 37 | 1037 | 13 | 13 | 13 | 0 | 0 | 1.0 | 18.88 | 688.6 | 0 |
| `cold` | `git_three_way` | 41 | 1041 | 14 | 14 | 14 | 0 | 0 | 1.0 | 17.34 | 807.43 | 0 |
| `cold` | `git_three_way` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 21.92 | 684.42 | 0 |
| `cold` | `git_three_way` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 18.8 | 691.52 | 0 |
| `cold` | `git_three_way` | 53 | 1053 | 12 | 12 | 10 | 0 | 2 | 0.8333 | 14.51 | 689.11 | 0 |
| `cold` | `bare_composer` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 16.5 | 848.65 | 0 |
| `cold` | `bare_composer` | 17 | 1017 | 11 | 11 | 11 | 0 | 0 | 1.0 | 13.44 | 818.31 | 0 |
| `cold` | `bare_composer` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 15.39 | 714.53 | 0 |
| `cold` | `bare_composer` | 29 | 1029 | 14 | 14 | 12 | 0 | 2 | 0.8571 | 14.3 | 839.08 | 0 |
| `cold` | `bare_composer` | 31 | 1031 | 13 | 13 | 11 | 0 | 2 | 0.8462 | 13.52 | 813.86 | 2 |
| `cold` | `bare_composer` | 37 | 1037 | 13 | 13 | 11 | 0 | 2 | 0.8462 | 12.96 | 848.91 | 0 |
| `cold` | `bare_composer` | 41 | 1041 | 14 | 14 | 12 | 0 | 2 | 0.8571 | 14.39 | 834.11 | 0 |
| `cold` | `bare_composer` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 17.89 | 838.26 | 0 |
| `cold` | `bare_composer` | 47 | 1047 | 13 | 13 | 11 | 0 | 2 | 0.8462 | 13.27 | 828.86 | 0 |
| `cold` | `bare_composer` | 53 | 1053 | 12 | 12 | 8 | 0 | 4 | 0.6667 | 11.24 | 711.97 | 0 |
| `hot_disjoint` | `steward` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 28.33 | 494.21 | 2 |
| `hot_disjoint` | `steward` | 17 | 1017 | 15 | 15 | 15 | 0 | 0 | 1.0 | 30.99 | 483.99 | 3 |
| `hot_disjoint` | `steward` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 29.67 | 370.74 | 2 |
| `hot_disjoint` | `steward` | 29 | 1029 | 13 | 13 | 13 | 0 | 0 | 1.0 | 36.9 | 352.28 | 1 |
| `hot_disjoint` | `steward` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 31.69 | 410.25 | 2 |
| `hot_disjoint` | `steward` | 37 | 1037 | 11 | 11 | 11 | 0 | 0 | 1.0 | 34.24 | 321.28 | 0 |
| `hot_disjoint` | `steward` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 33.52 | 447.47 | 1 |
| `hot_disjoint` | `steward` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 27.69 | 541.7 | 2 |
| `hot_disjoint` | `steward` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 27.28 | 476.53 | 2 |
| `hot_disjoint` | `steward` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 23.2 | 517.27 | 3 |
| `hot_disjoint` | `file_lock` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 93.8 | 149.26 | 4 |
| `hot_disjoint` | `file_lock` | 17 | 1017 | 15 | 15 | 15 | 0 | 0 | 1.0 | 103.33 | 145.17 | 4 |
| `hot_disjoint` | `file_lock` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 88.89 | 123.75 | 3 |
| `hot_disjoint` | `file_lock` | 29 | 1029 | 13 | 13 | 13 | 0 | 0 | 1.0 | 92.3 | 140.85 | 5 |
| `hot_disjoint` | `file_lock` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 79.55 | 163.42 | 5 |
| `hot_disjoint` | `file_lock` | 37 | 1037 | 11 | 11 | 11 | 0 | 0 | 1.0 | 75.83 | 145.06 | 1 |
| `hot_disjoint` | `file_lock` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 93.56 | 160.32 | 3 |
| `hot_disjoint` | `file_lock` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 84.82 | 176.85 | 7 |
| `hot_disjoint` | `file_lock` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 91.17 | 142.59 | 5 |
| `hot_disjoint` | `file_lock` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 73.9 | 162.38 | 5 |
| `hot_disjoint` | `occ` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 92.18 | 151.87 | 4 |
| `hot_disjoint` | `occ` | 17 | 1017 | 15 | 15 | 15 | 0 | 0 | 1.0 | 86.7 | 173.01 | 4 |
| `hot_disjoint` | `occ` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 90.59 | 121.42 | 4 |
| `hot_disjoint` | `occ` | 29 | 1029 | 13 | 13 | 13 | 0 | 0 | 1.0 | 93.84 | 138.53 | 5 |
| `hot_disjoint` | `occ` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 81.74 | 159.05 | 4 |
| `hot_disjoint` | `occ` | 37 | 1037 | 11 | 11 | 11 | 0 | 0 | 1.0 | 77.32 | 142.27 | 3 |
| `hot_disjoint` | `occ` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 102.17 | 146.82 | 3 |
| `hot_disjoint` | `occ` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 85.47 | 175.49 | 5 |
| `hot_disjoint` | `occ` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 98.11 | 132.5 | 5 |
| `hot_disjoint` | `occ` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 82.46 | 145.52 | 5 |
| `hot_disjoint` | `git_three_way` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 20.17 | 693.93 | 2 |
| `hot_disjoint` | `git_three_way` | 17 | 1017 | 15 | 15 | 15 | 0 | 0 | 1.0 | 21.98 | 682.44 | 0 |
| `hot_disjoint` | `git_three_way` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 19.79 | 555.89 | 0 |
| `hot_disjoint` | `git_three_way` | 29 | 1029 | 13 | 13 | 13 | 0 | 0 | 1.0 | 19.38 | 670.91 | 1 |
| `hot_disjoint` | `git_three_way` | 31 | 1031 | 13 | 13 | 13 | 0 | 0 | 1.0 | 16.35 | 794.95 | 2 |
| `hot_disjoint` | `git_three_way` | 37 | 1037 | 11 | 11 | 11 | 0 | 0 | 1.0 | 13.24 | 830.56 | 0 |
| `hot_disjoint` | `git_three_way` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 16.12 | 930.74 | 0 |
| `hot_disjoint` | `git_three_way` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 21.49 | 697.99 | 0 |
| `hot_disjoint` | `git_three_way` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 18.83 | 690.23 | 0 |
| `hot_disjoint` | `git_three_way` | 53 | 1053 | 12 | 12 | 12 | 0 | 0 | 1.0 | 17.85 | 672.1 | 1 |
| `hot_disjoint` | `bare_composer` | 11 | 1011 | 14 | 14 | 14 | 0 | 0 | 1.0 | 16.69 | 838.96 | 0 |
| `hot_disjoint` | `bare_composer` | 17 | 1017 | 15 | 15 | 15 | 0 | 0 | 1.0 | 17.88 | 838.92 | 0 |
| `hot_disjoint` | `bare_composer` | 23 | 1023 | 11 | 11 | 11 | 0 | 0 | 1.0 | 15.57 | 706.28 | 0 |
| `hot_disjoint` | `bare_composer` | 29 | 1029 | 13 | 13 | 13 | 0 | 0 | 1.0 | 15.49 | 839.24 | 0 |
| `hot_disjoint` | `bare_composer` | 31 | 1031 | 13 | 13 | 11 | 0 | 2 | 0.8462 | 13.28 | 828.02 | 0 |
| `hot_disjoint` | `bare_composer` | 37 | 1037 | 11 | 11 | 9 | 0 | 2 | 0.8182 | 10.57 | 851.39 | 0 |
| `hot_disjoint` | `bare_composer` | 41 | 1041 | 15 | 15 | 11 | 0 | 4 | 0.7333 | 13.12 | 838.3 | 0 |
| `hot_disjoint` | `bare_composer` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 17.68 | 848.48 | 0 |
| `hot_disjoint` | `bare_composer` | 47 | 1047 | 13 | 13 | 13 | 0 | 0 | 1.0 | 15.67 | 829.38 | 0 |
| `hot_disjoint` | `bare_composer` | 53 | 1053 | 12 | 12 | 8 | 0 | 4 | 0.6667 | 11.41 | 701.25 | 0 |
| `hot_conflict` | `steward` | 11 | 1011 | 15 | 15 | 15 | 0 | 0 | 1.0 | 25.15 | 596.41 | 3 |
| `hot_conflict` | `steward` | 17 | 1017 | 13 | 13 | 13 | 0 | 0 | 1.0 | 26.94 | 482.52 | 3 |
| `hot_conflict` | `steward` | 23 | 1023 | 13 | 13 | 13 | 0 | 0 | 1.0 | 23.06 | 563.86 | 4 |
| `hot_conflict` | `steward` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 25.43 | 550.43 | 2 |
| `hot_conflict` | `steward` | 31 | 1031 | 15 | 15 | 15 | 0 | 0 | 1.0 | 30.23 | 496.18 | 2 |
| `hot_conflict` | `steward` | 37 | 1037 | 14 | 14 | 14 | 0 | 0 | 1.0 | 21.12 | 663.01 | 3 |
| `hot_conflict` | `steward` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 29.15 | 514.65 | 2 |
| `hot_conflict` | `steward` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 25.34 | 591.95 | 2 |
| `hot_conflict` | `steward` | 47 | 1047 | 12 | 12 | 12 | 0 | 0 | 1.0 | 30.31 | 395.92 | 1 |
| `hot_conflict` | `steward` | 53 | 1053 | 13 | 13 | 13 | 0 | 0 | 1.0 | 24.34 | 534.02 | 2 |
| `hot_conflict` | `file_lock` | 11 | 1011 | 15 | 15 | 15 | 0 | 0 | 1.0 | 60.71 | 247.08 | 7 |
| `hot_conflict` | `file_lock` | 17 | 1017 | 13 | 13 | 13 | 0 | 0 | 1.0 | 83.01 | 156.6 | 6 |
| `hot_conflict` | `file_lock` | 23 | 1023 | 13 | 13 | 13 | 0 | 0 | 1.0 | 80.48 | 161.54 | 5 |
| `hot_conflict` | `file_lock` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 83.06 | 168.56 | 5 |
| `hot_conflict` | `file_lock` | 31 | 1031 | 15 | 15 | 15 | 0 | 0 | 1.0 | 80.19 | 187.05 | 5 |
| `hot_conflict` | `file_lock` | 37 | 1037 | 14 | 14 | 14 | 0 | 0 | 1.0 | 64.67 | 216.47 | 7 |
| `hot_conflict` | `file_lock` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 87.85 | 170.74 | 6 |
| `hot_conflict` | `file_lock` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 61.6 | 243.52 | 7 |
| `hot_conflict` | `file_lock` | 47 | 1047 | 12 | 12 | 12 | 0 | 0 | 1.0 | 73.54 | 163.18 | 3 |
| `hot_conflict` | `file_lock` | 53 | 1053 | 13 | 13 | 13 | 0 | 0 | 1.0 | 87.48 | 148.6 | 3 |
| `hot_conflict` | `occ` | 11 | 1011 | 15 | 15 | 15 | 0 | 0 | 1.0 | 85.54 | 175.36 | 9 |
| `hot_conflict` | `occ` | 17 | 1017 | 13 | 13 | 13 | 0 | 0 | 1.0 | 91.66 | 141.83 | 6 |
| `hot_conflict` | `occ` | 23 | 1023 | 13 | 13 | 13 | 0 | 0 | 1.0 | 100.01 | 129.99 | 7 |
| `hot_conflict` | `occ` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 94.52 | 148.11 | 6 |
| `hot_conflict` | `occ` | 31 | 1031 | 15 | 15 | 15 | 0 | 0 | 1.0 | 91.6 | 163.75 | 5 |
| `hot_conflict` | `occ` | 37 | 1037 | 14 | 14 | 14 | 0 | 0 | 1.0 | 76.94 | 181.95 | 7 |
| `hot_conflict` | `occ` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 100.41 | 149.39 | 6 |
| `hot_conflict` | `occ` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 74.72 | 200.74 | 7 |
| `hot_conflict` | `occ` | 47 | 1047 | 12 | 12 | 12 | 0 | 0 | 1.0 | 76.07 | 157.75 | 2 |
| `hot_conflict` | `occ` | 53 | 1053 | 13 | 13 | 13 | 0 | 0 | 1.0 | 87.54 | 148.51 | 3 |
| `hot_conflict` | `git_three_way` | 11 | 1011 | 15 | 15 | 15 | 0 | 0 | 1.0 | 18.18 | 824.92 | 0 |
| `hot_conflict` | `git_three_way` | 17 | 1017 | 13 | 13 | 13 | 0 | 0 | 1.0 | 16.31 | 796.91 | 0 |
| `hot_conflict` | `git_three_way` | 23 | 1023 | 13 | 13 | 13 | 0 | 0 | 1.0 | 18.99 | 684.53 | 0 |
| `hot_conflict` | `git_three_way` | 29 | 1029 | 14 | 14 | 14 | 0 | 0 | 1.0 | 17.5 | 800.04 | 0 |
| `hot_conflict` | `git_three_way` | 31 | 1031 | 15 | 15 | 15 | 0 | 0 | 1.0 | 18.82 | 796.85 | 0 |
| `hot_conflict` | `git_three_way` | 37 | 1037 | 14 | 14 | 14 | 0 | 0 | 1.0 | 17.22 | 813.12 | 0 |
| `hot_conflict` | `git_three_way` | 41 | 1041 | 15 | 15 | 15 | 0 | 0 | 1.0 | 18.81 | 797.28 | 2 |
| `hot_conflict` | `git_three_way` | 43 | 1043 | 15 | 15 | 15 | 0 | 0 | 1.0 | 16.02 | 936.52 | 2 |
| `hot_conflict` | `git_three_way` | 47 | 1047 | 12 | 12 | 12 | 0 | 0 | 1.0 | 15.02 | 799.14 | 0 |
| `hot_conflict` | `git_three_way` | 53 | 1053 | 13 | 13 | 13 | 0 | 0 | 1.0 | 16.6 | 783.25 | 2 |
| `hot_conflict` | `bare_composer` | 11 | 1011 | 15 | 15 | 12 | 0 | 3 | 0.8 | 14.5 | 827.57 | 0 |
| `hot_conflict` | `bare_composer` | 17 | 1017 | 13 | 13 | 11 | 0 | 2 | 0.8462 | 13.52 | 813.86 | 0 |
| `hot_conflict` | `bare_composer` | 23 | 1023 | 13 | 13 | 13 | 0 | 0 | 1.0 | 15.94 | 815.41 | 1 |
| `hot_conflict` | `bare_composer` | 29 | 1029 | 14 | 14 | 11 | 0 | 3 | 0.7857 | 13.52 | 813.44 | 1 |
| `hot_conflict` | `bare_composer` | 31 | 1031 | 15 | 15 | 4 | 0 | 11 | 0.2667 | 4.97 | 804.48 | 0 |
| `hot_conflict` | `bare_composer` | 37 | 1037 | 14 | 14 | 5 | 0 | 9 | 0.3571 | 6.11 | 817.79 | 0 |
| `hot_conflict` | `bare_composer` | 41 | 1041 | 15 | 15 | 7 | 0 | 8 | 0.4667 | 8.7 | 804.64 | 0 |
| `hot_conflict` | `bare_composer` | 43 | 1043 | 15 | 15 | 7 | 0 | 8 | 0.4667 | 8.37 | 836.58 | 0 |
| `hot_conflict` | `bare_composer` | 47 | 1047 | 12 | 12 | 10 | 0 | 2 | 0.8333 | 11.93 | 838.42 | 0 |
| `hot_conflict` | `bare_composer` | 53 | 1053 | 13 | 13 | 7 | 0 | 6 | 0.5385 | 8.59 | 814.94 | 0 |

## 事實筆記（不宣稱勝出）

1. **lost=0** 於五主臂 × 全部 150 格（診斷臂除外）。
2. **eligible_coverage=1.0**：本 harness 預登記效果皆 eligible；分母差異主要來自 seed 產生的 offered 數（idle_prob）。
3. **bare_composer** 在 `hot_conflict` 出現 blocked（mean≈5.2）→ correct／rate_elig 低於同格其他臂；cold／hot_disjoint 多為 blocked=0。
4. **correct 隨 seed**：同 workload×seed 下 competitor 臂 correct 多相同（offered 同源）；差異主要見 bare blocked。
5. **wall／goodput**：steward wall 受 `compose-window-ms=100`；file_lock／occ wall 較低 → goodput 數字較高（**不是**正確性勝出敘事）。
6. **retry**：OCC／file_lock cas_retry Σ 較高；steward 亦有 cas_rebase；`repropose_rounds` 多為 stub 0。

## 可選診斷（非主表競爭者）

| arm | mode | wl/sch | correct | lost | blocked | wall_ms |
|-----|------|--------|---------|------|---------|---------|
| `admission_only` | `atm` | 11/1011 | 10 | 5 | 0 | 173.37 |
| `raw_overwrite` | `control` | 11/1011 | 8 | 7 | 0 | 99.8 |

## 仍開缺口

- `logical_id` 解耦／預登記 eligible 政策檔（現 stub＝intent；coverage 恆 1）
- `artifact_manifest.json`／根目錄 `reproduce.sh`
- MP compose window 跨 process
- **final pin** 仍 TBD（E2 為 DRAFT evidence，非 final）
- E3 window sweep 未開

## Banner 複述

**DRAFT evidence — not a win claim.** 數字供論文草稿／審閱；**禁止**寫 steward「勝出」。


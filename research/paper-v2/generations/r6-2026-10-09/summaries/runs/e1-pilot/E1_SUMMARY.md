# E1 — Pilot matrix summary

> **PILOT ONLY — no win claims / no RQ2 main result**

| 欄位 | 內容 |
|------|------|
| Status | **done**（2026-10-07 22:50 CST） |
| Harness | `/workspace/reports/atm-v2-harness` |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀） |
| Main method | `--arm steward`（D5 凍結；`compose-window-ms=100`） |
| Scale | 3 workloads × 5 主臂 × seeds `{11,17,23}`；agents×trials=`3×5`；hold `8–25` ms |
| Raw | `runs/e1-pilot/e1_compare_raw.json`；per-cell `runs/e1-<wl>-<arm>-s<seed>/` |
| Runner | `runs/e1-pilot/run_matrix.sh`；workload 凍結 `WORKLOADS.md` |
| Wall time | matrix ~29 s（Node v24.21.0） |

## Workloads（凍結）

| id | hot-ratio | overlap | 語意 |
|----|-----------|---------|------|
| `cold` | 0 | low | 低爭用／冷檔 |
| `hot_disjoint` | 1 | low | 熱檔、低重疊（不相交傾向） |
| `hot_conflict` | 1 | high | 熱＋混衝突（對齊 D5 smoke） |

共同：`--atm-backend real --compose-window-ms 100 --agents 3 --trials 5 --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6`。

## 主表 — 每格（workload × arm × seed）

| workload | arm | seed | correct | lost | blocked | mean admit | mean wait | wall_ms |
|----------|-----|------|---------|------|---------|------------|-----------|---------|
| `cold` | `steward` | 11 | 14 | 0 | 0 | 3.68 | 0.0 | 396.25 |
| `cold` | `steward` | 17 | 11 | 0 | 0 | 3.7 | 0.0 | 360.73 |
| `cold` | `steward` | 23 | 11 | 0 | 0 | 5.34 | 1.73 | 328.36 |
| `cold` | `file_lock` | 11 | 14 | 0 | 0 | 3.85 | 0.0 | 136.38 |
| `cold` | `file_lock` | 17 | 11 | 0 | 0 | 4.36 | 0.0 | 152.85 |
| `cold` | `file_lock` | 23 | 11 | 0 | 0 | 6.01 | 2.09 | 137.4 |
| `cold` | `occ` | 11 | 14 | 0 | 0 | 4.15 | 0.43 | 141.61 |
| `cold` | `occ` | 17 | 11 | 0 | 0 | 3.54 | 0.0 | 152.65 |
| `cold` | `occ` | 23 | 11 | 0 | 0 | 6.37 | 2.45 | 145.31 |
| `cold` | `git_three_way` | 11 | 14 | 0 | 0 | 3.92 | 0.64 | 701.84 |
| `cold` | `git_three_way` | 17 | 11 | 0 | 0 | 3.24 | 0.0 | 699.29 |
| `cold` | `git_three_way` | 23 | 11 | 0 | 0 | 5.37 | 1.18 | 571.92 |
| `cold` | `bare_composer` | 11 | 14 | 0 | 0 | 0.03 | 0.0 | 840.74 |
| `cold` | `bare_composer` | 17 | 11 | 0 | 0 | 0.03 | 0.0 | 828.26 |
| `cold` | `bare_composer` | 23 | 11 | 0 | 0 | 0.04 | 0.0 | 719.41 |
| `hot_disjoint` | `steward` | 11 | 14 | 0 | 0 | 17.21 | 13.57 | 517.82 |
| `hot_disjoint` | `steward` | 17 | 15 | 0 | 0 | 10.95 | 7.33 | 441.06 |
| `hot_disjoint` | `steward` | 23 | 11 | 0 | 0 | 3.76 | 0.0 | 386.81 |
| `hot_disjoint` | `file_lock` | 11 | 14 | 0 | 0 | 6.44 | 2.64 | 164.29 |
| `hot_disjoint` | `file_lock` | 17 | 15 | 0 | 0 | 4.88 | 1.27 | 152.85 |
| `hot_disjoint` | `file_lock` | 23 | 11 | 0 | 0 | 4.32 | 0.73 | 155.26 |
| `hot_disjoint` | `occ` | 11 | 14 | 0 | 0 | 4.95 | 1.29 | 153.86 |
| `hot_disjoint` | `occ` | 17 | 15 | 0 | 0 | 3.73 | 0.27 | 144.36 |
| `hot_disjoint` | `occ` | 23 | 11 | 0 | 0 | 3.77 | 0.0 | 126.21 |
| `hot_disjoint` | `git_three_way` | 11 | 14 | 0 | 0 | 3.53 | 0.0 | 690.84 |
| `hot_disjoint` | `git_three_way` | 17 | 15 | 0 | 0 | 3.49 | 0.0 | 696.39 |
| `hot_disjoint` | `git_three_way` | 23 | 11 | 0 | 0 | 3.72 | 0.0 | 558.04 |
| `hot_disjoint` | `bare_composer` | 11 | 14 | 0 | 0 | 0.03 | 0.0 | 839.48 |
| `hot_disjoint` | `bare_composer` | 17 | 15 | 0 | 0 | 0.02 | 0.0 | 832.66 |
| `hot_disjoint` | `bare_composer` | 23 | 11 | 0 | 0 | 0.04 | 0.0 | 710.93 |
| `hot_conflict` | `steward` | 11 | 15 | 0 | 0 | 16.41 | 12.8 | 604.08 |
| `hot_conflict` | `steward` | 17 | 13 | 0 | 0 | 10.43 | 7.31 | 474.51 |
| `hot_conflict` | `steward` | 23 | 13 | 0 | 0 | 3.55 | 0.0 | 406.61 |
| `hot_conflict` | `file_lock` | 11 | 15 | 0 | 0 | 9.72 | 6.13 | 205.13 |
| `hot_conflict` | `file_lock` | 17 | 13 | 0 | 0 | 4.91 | 1.54 | 180.27 |
| `hot_conflict` | `file_lock` | 23 | 13 | 0 | 0 | 5.13 | 1.77 | 162.81 |
| `hot_conflict` | `occ` | 11 | 15 | 0 | 0 | 7.81 | 4.33 | 183.54 |
| `hot_conflict` | `occ` | 17 | 13 | 0 | 0 | 5.49 | 2.08 | 154.14 |
| `hot_conflict` | `occ` | 23 | 13 | 0 | 0 | 3.75 | 0.0 | 137.04 |
| `hot_conflict` | `git_three_way` | 11 | 15 | 0 | 0 | 20.01 | 16.87 | 821.5 |
| `hot_conflict` | `git_three_way` | 17 | 13 | 0 | 0 | 12.88 | 9.38 | 805.56 |
| `hot_conflict` | `git_three_way` | 23 | 13 | 0 | 0 | 3.45 | 0.0 | 688.28 |
| `hot_conflict` | `bare_composer` | 11 | 12 | 0 | 3 | 0.03 | 0.0 | 836.54 |
| `hot_conflict` | `bare_composer` | 17 | 11 | 0 | 2 | 0.03 | 0.0 | 826.39 |
| `hot_conflict` | `bare_composer` | 23 | 13 | 0 | 0 | 0.04 | 0.0 | 838.18 |

## 彙總 — 跨 seeds 平均（±母體 stdev）

| workload | arm | role | correct mean±σ | lost | blocked mean±σ | admit mean | wall mean±σ |
|----------|-----|------|----------------|------|----------------|------------|-------------|
| `cold` | `steward` | `main_method` | 12.0±1.41 | 0.0 | 0.0±0.0 | 4.24 | 361.78±27.73 |
| `cold` | `file_lock` | `baseline_serial` | 12.0±1.41 | 0.0 | 0.0±0.0 | 4.74 | 142.21±7.54 |
| `cold` | `occ` | `baseline_occ` | 12.0±1.41 | 0.0 | 0.0±0.0 | 4.69 | 146.52±4.59 |
| `cold` | `git_three_way` | `baseline_git` | 12.0±1.41 | 0.0 | 0.0±0.0 | 4.18 | 657.68±60.65 |
| `cold` | `bare_composer` | `baseline_bare_composer` | 12.0±1.41 | 0.0 | 0.0±0.0 | 0.03 | 796.14±54.49 |
| `hot_disjoint` | `steward` | `main_method` | 13.33±1.7 | 0.0 | 0.0±0.0 | 10.64 | 448.56±53.75 |
| `hot_disjoint` | `file_lock` | `baseline_serial` | 13.33±1.7 | 0.0 | 0.0±0.0 | 5.21 | 157.47±4.92 |
| `hot_disjoint` | `occ` | `baseline_occ` | 13.33±1.7 | 0.0 | 0.0±0.0 | 4.15 | 141.48±11.47 |
| `hot_disjoint` | `git_three_way` | `baseline_git` | 13.33±1.7 | 0.0 | 0.0±0.0 | 3.58 | 648.42±63.95 |
| `hot_disjoint` | `bare_composer` | `baseline_bare_composer` | 13.33±1.7 | 0.0 | 0.0±0.0 | 0.03 | 794.36±59.06 |
| `hot_conflict` | `steward` | `main_method` | 13.67±0.94 | 0.0 | 0.0±0.0 | 10.13 | 495.07±81.92 |
| `hot_conflict` | `file_lock` | `baseline_serial` | 13.67±0.94 | 0.0 | 0.0±0.0 | 6.59 | 182.74±17.36 |
| `hot_conflict` | `occ` | `baseline_occ` | 13.67±0.94 | 0.0 | 0.0±0.0 | 5.68 | 158.24±19.2 |
| `hot_conflict` | `git_three_way` | `baseline_git` | 13.67±0.94 | 0.0 | 0.0±0.0 | 12.11 | 771.78±59.4 |
| `hot_conflict` | `bare_composer` | `baseline_bare_composer` | 12.0±0.82 | 0.0 | 1.67±1.25 | 0.03 | 833.7±5.21 |

## D5 對照格（可比）

`hot_conflict × steward × seed 11`：E1 correct=15 / lost=0 / blocked=0 / wall≈604 ms；D5 同參數 correct=15 / lost=0 / blocked=0 / wall≈612 ms。數量級一致（非宣稱勝出）。

## 變異與瓶頸（事實筆記；不宣稱勝出）

1. **correct 隨 seed 變動**：同 workload 下各 competitor 臂在同一 seed 的 correct 相同（例 cold/s11=14、s17=11），來自 scenario／`idle_prob` 產生的 eligible 效果數差，**不是**臂間正確性差距。例外見下。
2. **lost=0**：五主臂在本 pilot 全部 seed×workload 皆 lost=0。
3. **bare_composer 僅在 `hot_conflict` 出現 blocked**（s11=3、s17=2、s23=0）→ correct 低於同格其他臂；與 D4／D5 消融敘事一致（准入旁路把重疊 peers 塞進同一 compose window）。cold／hot_disjoint 無 blocked。
4. **wall 瓶頸**：`steward` wall（~360–495 ms mean）明顯高於 `file_lock`／`occ`（~140–180 ms），與 `compose-window-ms=100` 等待＋compose/apply 開銷一致。`git_three_way`／`bare_composer` wall 更高（~650–830 ms）— merge-file／compose 路徑成本。
5. **admit**：`steward` 在 hot_* 的 mean admit 高於 cold（治理／provisional）；`bare_composer` admit≈0（bypass）。
6. **seed 間 wall σ**：steward on `hot_conflict` σ≈82 ms；bare on hot_conflict σ≈5 ms（blocked 時仍耗 compose）。

## 可選診斷 smoke（非主表）

| arm | seed | workload | correct | lost | blocked | wall_ms |
|-----|------|----------|---------|------|---------|---------|
| `admission_only` | 11 | `hot_conflict` | 8 | 7 | 0 | 155.3 |
| `raw_overwrite` | 11 | `hot_conflict` | 8 | 7 | 0 | 101.83 |

診斷臂有 lost（動機對照）；**不作**正確性競爭者。

## 仍開缺口（沿用）

- `logical_id` 解耦／預登記 eligible
- `artifact_manifest.json`／`reproduce.sh`（A5／F3）
- multi-process compose window
- final ATM artifact pin（需 E2+ 主矩陣數字）

## Next default

**E2**（主矩陣；預先登記 seeds；本檔**不**自動開工）。E1 綠足夠當成 pilot 通過。


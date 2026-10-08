# E2 — 預先登記 Seeds（跑矩陣前）

> **DRAFT evidence — not a win claim / 不宣稱勝出**
>
> 本檔與 `seeds.json` 於 **任何 E2 cell 執行前**寫入（登記時刻：2026-10-07 22:52:32 CST）。

| 欄位 | 內容 |
|------|------|
| Checklist | **E2** 主矩陣 |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀） |
| Main method | `--arm steward`（D5／E1 凍結） |
| Foils | `steward` / `file_lock` / `occ` / `git_three_way` / `bare_composer` |
| Agents × trials | **3 × 5**（與 E1 同，便於格對格比較；非論文最終規模，見選擇理由） |
| 共同 knobs | `--atm-backend real --compose-window-ms 100 --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6` |

## Workload seeds（情境結構）

`{11, 17, 23, 29, 31, 37, 41, 43, 47, 53}` — **10** 個（E1 的 3 個＋7 個擴張）。

## Scheduler seeds（時序／hold／jitter）

**公式**：`scheduler_seed = workload_seed + 1000`

| workload_seed | scheduler_seed |
|---------------|----------------|
| 11 | 1011 |
| 17 | 1017 |
| 23 | 1023 |
| 29 | 1029 |
| 31 | 1031 |
| 37 | 1037 |
| 41 | 1041 |
| 43 | 1043 |
| 47 | 1047 |
| 53 | 1053 |

**證明要求**：每個 E2 cell 的 `meta.json` 必須 `scenario_seed ≠ scheduler_seed`。

Harness：`--seed <workload_seed> --scheduler-seed <scheduler_seed>`。結構（檔／區／slot）由 workload seed 產生（與單 seed 流相同結構）；隨後以 scheduler seed **覆寫** `hold_ms`／`jitter_ms`（故同 workload seed 跨 scheduler 時結構可比、時序獨立）。

## Workloads（沿用 E1 凍結）

| id | hot-ratio | overlap |
|----|-----------|---------|
| `cold` | 0 | low |
| `hot_disjoint` | 1 | low |
| `hot_conflict` | 1 | high |

## 規模選擇（agents×trials）

維持 **3×5**（E1 parity）：主矩陣細胞數 = 3×5×10 = **150**；若改 4×10 則 600 cells，wall 過長且與 E1 格不可直接比。E2 價值在 **seed 預登記＋配對 traces＋指標擴充**，非同時放大 agents。

## 配對 traces

同一 `(workload_id, workload_seed, scheduler_seed)` 在五臂各跑一格 → cell-aligned 比較。

## 截斷優先（若 wall 不夠）

1. 全部臂 × `hot_conflict`＋`hot_disjoint` × 全 seeds  
2. 再 `cold`  
3. **永不**丟 `steward` 格  

預期本環境可跑滿 150。

## 可選診斷（非主表）

`admission_only`／`raw_overwrite` × `hot_conflict` × workload_seed 11（各 1）。

## 機器可讀

見同目錄 `seeds.json`。

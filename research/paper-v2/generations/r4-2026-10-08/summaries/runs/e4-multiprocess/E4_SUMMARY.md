# E4 — Multi-process summary

> **DRAFT evidence — not a win claim / 不宣稱勝出**

| 欄位 | 內容 |
|------|------|
| Status | **done**（2026-10-07 23:26 CST） |
| ATM pin | `5692474f…` 唯讀 |
| Main | `--arm steward` + `--registry-sync cas` + `--apply-lock on`（RQ2） |
| Procs | **2 / 4 / 8** |
| Workload | hot_conflict only（MP 壓力；E2 已覆蓋三元單進程） |
| Seeds | 預登記 `{11,17,23}`；`scheduler=wl+1000` |
| Scale | agents×trials=`8×5`；**18** cells |
| Fault 臂 | `fault_naive`（naive registry）、`fault_nolock`（apply-lock off）— **隔離標籤，非正確性競爭者** |
| Harness fix | `mp-runner` 對 steward 呼叫 `initWorktreeGit`（否則無 HEAD） |
| Caveat | MP steward compose window **不跨 OS process**（既有註記）；coverage 低於 SP 屬預期 |
| Raw | `runs/e4-multiprocess/e4_compare_raw.json` |
| Runner | `runs/e4-multiprocess/run_matrix.sh` |
| Wall | matrix ~24 s |

## 不變量（主臂 MP）

| 檢查 | 結果 |
|------|------|
| 0 殭屍 lease（`registry_residue_active_intents==0`） | **PASS 9/9** |
| 收據對帳（`n_decisions == offered`） | **PASS 9/9** |
| worker exit code 0 | PASS（見 per-cell） |
| distinct_pids == procs | PASS |
| 寫入監測 `proposer_direct_writes` Σ==0 | PASS 9/9（欄位有值） |
| seed ≠ scheduler | 18/18 |
| logical_id 解耦 | 18/18 |

## 彙總（跨 3 seeds mean）

| kind | procs | sync | lock | correct | lost | blocked | rate_elig | goodput | wall_ms | zombie | receipt_ok |
|------|-------|------|------|---------|------|---------|-----------|---------|---------|--------|------------|
| `main_steward_mp` | 2 | cas | on | 21 | 0.33 | 14 | 0.5942 | 30.78 | 687.46 | 0 | True |
| `main_steward_mp` | 4 | cas | on | 20 | 0 | 15.33 | 0.5659 | 27.72 | 725.89 | 0 | True |
| `main_steward_mp` | 8 | cas | on | 18.67 | 0 | 16.67 | 0.5294 | 19.99 | 946.98 | 0 | True |
| `sp_baseline` | 1 | cas | on | 31.33 | 0 | 4 | 0.8889 | 32.71 | 971.47 | 0 | True |
| `fault_naive` | 8 | naive | on | 18.33 | 0.67 | 16.33 | 0.5185 | 26.37 | 699.62 | 4.33 | True |
| `fault_nolock` | 8 | cas | off | 18.67 | 0.33 | 16.33 | 0.5294 | 24.57 | 765.66 | 0 | True |

## Fault 消融（隔離；不作勝出宣稱）

| 臂 | 期望 | 實測（3 seeds） |
|----|------|----------------|
| `fault_naive` p8 | 殭屍 lease > 0 | zombie mean **4.33**（4/5/4）；lost mean 0.67 |
| `fault_nolock` p8 | 可能 lost update | zombie **0**；lost mean **0.33**（1/3 seeds） |
| main cas+lock p8 | 0 zombie | zombie **0**；lost **0** |

## SP vs MP（同 seeds／workload；描述性）

- SP steward：correct≈31.33、lost≈0、rate≈0.8889
- MP steward p8：correct≈18.67、lost≈0、rate≈0.5294、CAS conflicts≈462.67
- 差距主因：MP compose window 不跨 process → 更多 blocked／較低 correct；**非** win claim。

## 每格主表

| kind | procs | seed | sch | correct | lost | blocked | zombie | pids | receipt | pdwΣ | cas | wall_ms |
|------|-------|------|-----|---------|------|---------|--------|------|---------|------|-----|---------|
| `fault_naive` | 8 | 11 | 1011 | 19 | 1 | 16 | 4 | 8 | True | 0 | 0 | 631.75 |
| `fault_naive` | 8 | 17 | 1017 | 17 | 1 | 16 | 5 | 8 | True | 0 | 0 | 707.49 |
| `fault_naive` | 8 | 23 | 1023 | 19 | 0 | 17 | 4 | 8 | True | 0 | 0 | 759.63 |
| `fault_nolock` | 8 | 11 | 1011 | 18 | 0 | 18 | 0 | 8 | True | 0 | 203 | 848.66 |
| `fault_nolock` | 8 | 17 | 1017 | 20 | 1 | 13 | 0 | 8 | True | 0 | 251 | 717.82 |
| `fault_nolock` | 8 | 23 | 1023 | 18 | 0 | 18 | 0 | 8 | True | 0 | 270 | 730.5 |
| `main_steward_mp` | 2 | 11 | 1011 | 23 | 0 | 13 | 0 | 2 | True | 0 | 77 | 678.87 |
| `main_steward_mp` | 2 | 17 | 1017 | 20 | 1 | 13 | 0 | 2 | True | 0 | 127 | 619.53 |
| `main_steward_mp` | 2 | 23 | 1023 | 20 | 0 | 16 | 0 | 2 | True | 0 | 116 | 763.99 |
| `main_steward_mp` | 4 | 11 | 1011 | 21 | 0 | 15 | 0 | 4 | True | 0 | 206 | 668.16 |
| `main_steward_mp` | 4 | 17 | 1017 | 19 | 0 | 15 | 0 | 4 | True | 0 | 237 | 720.77 |
| `main_steward_mp` | 4 | 23 | 1023 | 20 | 0 | 16 | 0 | 4 | True | 0 | 230 | 788.73 |
| `main_steward_mp` | 8 | 11 | 1011 | 18 | 0 | 18 | 0 | 8 | True | 0 | 382 | 1053.99 |
| `main_steward_mp` | 8 | 17 | 1017 | 20 | 0 | 14 | 0 | 8 | True | 0 | 537 | 1001.64 |
| `main_steward_mp` | 8 | 23 | 1023 | 18 | 0 | 18 | 0 | 8 | True | 0 | 469 | 785.31 |
| `sp_baseline` | 1 | 11 | 1011 | 28 | 0 | 8 | 0 | 1 | True | 0 | None | 1069.34 |
| `sp_baseline` | 1 | 17 | 1017 | 34 | 0 | 0 | 0 | 1 | True | 0 | None | 1005.97 |
| `sp_baseline` | 1 | 23 | 1023 | 32 | 0 | 4 | 0 | 1 | True | 0 | None | 839.09 |

## 產物

| 項 | 路徑 |
|----|------|
| Seeds | `SEEDS_REGISTERED.md`／`seeds.json` |
| Runner | `run_matrix.sh` |
| Compare | `e4_compare_raw.json` |
| Chronicle | `../steward-writer/STEWARD_WRITER_E4.md` |

## Banner

**DRAFT — 不宣稱勝出。** Next default：**E5**（不自動開工）。


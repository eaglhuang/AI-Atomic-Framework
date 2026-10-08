# r4 驗證表（ATM PR #214 merge 2118bc66 vs bea35380 vs 5692474f）

> DRAFT。不主張勝出。作者自行執行、未獨立重現。由 `analysis/r4_compare.py` 從 raw 重建（唯讀）。定義見 r4_summary.json `definitions`。

## 1. E4 重播（r3 同配置：每臂 75 runs，含 p2/s17 共 35 次；三 pin 同時段交錯）

| 組 | 完成／總 intents | 失敗 runs／總 runs | 遺失效果 | blocked intents | 損壞檔 | 多餘檔 | re-compose 事件／成功 | 額外嘗試 | wall ms mean / p95 | intent total_ms mean / p95 |
|---|---|---|---:|---:|---:|---:|---|---:|---|---|
| old · all | 1580／2610（60.5%） | 5／75 | 6 | 1024 | 0 | 0 | 0／0 | 0 | 594.65 / 718.65 | 93.18 / 210.22 |
| old · p2_s17_35 | 771／1190（64.8%） | 3／35 | 3 | 416 | 0 | 0 | 0／0 | 0 | 574.18 / 709.27 | 87.39 / 184.77 |
| old · grid_p2 | 317／530（59.8%） | 1／15 | 2 | 211 | 0 | 0 | 0／0 | 0 | 553.24 / 618.77 | 85.12 / 180.17 |
| old · grid_p4 | 307／530（57.9%） | 0／15 | 0 | 223 | 0 | 0 | 0／0 | 0 | 589.08 / 645.32 | 91.61 / 188.58 |
| old · grid_p8 | 296／530（55.9%） | 1／15 | 1 | 233 | 0 | 0 | 0／0 | 0 | 664.29 / 730.0 | 112.62 / 293.6 |
| fix · all | 1553／2610（59.5%） | 0／75 | 0 | 1057 | 0 | 0 | 16／2 | 2 | 583.94 / 722.44 | 93.55 / 211.59 |
| fix · p2_s17_35 | 766／1190（64.4%） | 0／35 | 0 | 424 | 0 | 0 | 6／1 | 1 | 543.98 / 656.77 | 85.6 / 183.13 |
| fix · grid_p2 | 311／530（58.7%） | 0／15 | 0 | 219 | 0 | 0 | 1／0 | 0 | 566.09 / 638.6 | 88.45 / 192.93 |
| fix · grid_p4 | 293／530（55.3%） | 0／15 | 0 | 237 | 0 | 0 | 5／0 | 0 | 571.61 / 657.17 | 92.24 / 204.26 |
| fix · grid_p8 | 293／530（55.3%） | 0／15 | 0 | 237 | 0 | 0 | 5／1 | 1 | 689.75 / 779.08 | 115.54 / 284.96 |
| opt · all | 1748／2610（67.0%） | 0／75 | 0 | 862 | 0 | 0 | 91／24 | 24 | 597.09 / 738.67 | 96.01 / 221.7 |
| opt · p2_s17_35 | 794／1190（66.7%） | 0／35 | 0 | 396 | 0 | 0 | 39／3 | 3 | 559.47 / 659.56 | 89.35 / 194.32 |
| opt · grid_p2 | 335／530（63.2%） | 0／15 | 0 | 195 | 0 | 0 | 11／1 | 1 | 592.1 / 692.62 | 91.39 / 187.88 |
| opt · grid_p4 | 372／530（70.2%） | 0／15 | 0 | 158 | 0 | 0 | 18／6 | 6 | 595.2 / 684.82 | 92.34 / 194.77 |
| opt · grid_p8 | 358／530（67.5%） | 0／15 | 0 | 172 | 0 | 0 | 28／14 | 14 | 693.99 / 827.8 | 119.0 / 303.92 |
| optlock · all | 1841／2610（70.5%） | 0／75 | 0 | 769 | 0 | 0 | 0／0 | 0 | 711.96 / 1002.34 | 115.49 / 307.51 |
| optlock · p2_s17_35 | 850／1190（71.4%） | 0／35 | 0 | 340 | 0 | 0 | 0／0 | 0 | 621.7 / 754.33 | 98.92 / 262.03 |
| optlock · grid_p2 | 351／530（66.2%） | 0／15 | 0 | 179 | 0 | 0 | 0／0 | 0 | 683.16 / 848.85 | 104.25 / 265.13 |
| optlock · grid_p4 | 361／530（68.1%） | 0／15 | 0 | 169 | 0 | 0 | 0／0 | 0 | 700.09 / 805.89 | 114.01 / 340.62 |
| optlock · grid_p8 | 403／530（76.0%） | 0／15 | 0 | 127 | 0 | 0 | 0／0 | 0 | 950.31 / 1252.52 | 160.42 / 550.16 |
| optr0 · all | 1718／2610（65.8%） | 0／75 | 0 | 892 | 0 | 0 | 85／0 | 0 | 605.31 / 743.51 | 95.51 / 215.57 |
| optr0 · p2_s17_35 | 786／1190（66.0%） | 0／35 | 0 | 404 | 0 | 0 | 33／0 | 0 | 569.47 / 722.36 | 87.31 / 189.44 |
| optr0 · grid_p2 | 344／530（64.9%） | 0／15 | 0 | 186 | 0 | 0 | 10／0 | 0 | 585.7 / 689.69 | 89.52 / 193.13 |
| optr0 · grid_p4 | 343／530（64.7%） | 0／15 | 0 | 187 | 0 | 0 | 20／0 | 0 | 598.66 / 671.25 | 93.8 / 190.28 |
| optr0 · grid_p8 | 360／530（67.9%） | 0／15 | 0 | 170 | 0 | 0 | 26／0 | 0 | 684.98 / 830.49 | 117.13 / 302.55 |
| optr1 · all | 1752／2610（67.1%） | 0／75 | 0 | 858 | 0 | 0 | 104／33 | 34 | 601.27 / 718.17 | 95.23 / 222.8 |
| optr1 · p2_s17_35 | 795／1190（66.8%） | 0／35 | 0 | 395 | 0 | 0 | 36／3 | 3 | 565.97 / 686.7 | 88.47 / 187.99 |
| optr1 · grid_p2 | 340／530（64.1%） | 0／15 | 0 | 190 | 0 | 0 | 13／2 | 2 | 600.73 / 700.17 | 90.9 / 187.79 |
| optr1 · grid_p4 | 364／530（68.7%） | 0／15 | 0 | 166 | 0 | 0 | 26／10 | 10 | 606.95 / 707.4 | 92.15 / 192.32 |
| optr1 · grid_p8 | 369／530（69.6%） | 0／15 | 0 | 161 | 0 | 0 | 34／18 | 19 | 665.54 / 769.93 | 115.47 / 291.63 |

臂：old＝5692474f；fix＝bea35380；opt＝2118bc66（主）；optlock＝2118bc66＋harness 鎖 on；optr0＝2118bc66＋maxRecomposeAttempts 0；optr1＝2118bc66＋maxRecomposeAttempts 1、backoff 0、jitter 0。除 optlock 外 harness 鎖皆 off。

### 1-p. 逐 run 配對（同 seed／配置／rep；描述性，非顯著性檢定）

| 比較 | 配對數 | 較高 | 相同 | 較低 | 每 run 平均差 | 合計差 |
|---|---:|---:|---:|---:|---:|---:|
| opt_vs_fix | 75 | 55 | 6 | 14 | 2.6 | 195 |
| opt_vs_old | 75 | 52 | 7 | 16 | 2.24 | 168 |
| fix_vs_old | 75 | 27 | 13 | 35 | -0.36 | -27 |
| optr0_vs_opt | 75 | 30 | 12 | 33 | -0.4 | -30 |
| optr1_vs_opt | 75 | 33 | 14 | 28 | 0.05 | 4 |
| optr0_vs_fix | 75 | 53 | 8 | 14 | 2.2 | 165 |
| optlock_vs_opt | 75 | 45 | 7 | 23 | 1.24 | 93 |

### 1a. blocked／完成 intents 依最終分類

| 臂 | 分類 → intents |
|---|---|
| old | applied: 1586; blocked:compose-context-mismatch: 5; blocked:file-hash-drift: 742; blocked:stale-precheck(unlocked): 62; blocked:steward-final-patch-required/declared-line-overlap: 215 |
| fix | applied: 1551; applied_after_re-compose: 2; blocked:compose-context-mismatch: 7; blocked:file-hash-drift: 785; blocked:re-compose→compose-context-mismatch: 16; blocked:stale-precheck(unlocked): 68; blocked:steward-final-patch-required/declared-line-overlap: 181 |
| opt | applied: 1722; applied_after_re-compose: 26; blocked:re-compose→steward-final-patch-required/region-changed: 81; blocked:steward-final-patch-required/declared-line-overlap: 181; blocked:steward-final-patch-required/region-changed: 479; blocked:steward-final-patch-required/same-region-in-batch: 121 |
| optlock | applied: 1841; blocked:steward-final-patch-required/declared-line-overlap: 219; blocked:steward-final-patch-required/region-changed: 474; blocked:steward-final-patch-required/same-region-in-batch: 76 |
| optr0 | applied: 1718; blocked:re-compose-exhausted: 99; blocked:steward-final-patch-required/declared-line-overlap: 207; blocked:steward-final-patch-required/region-changed: 483; blocked:steward-final-patch-required/same-region-in-batch: 103 |
| optr1 | applied: 1718; applied_after_re-compose: 34; blocked:re-compose-exhausted: 1; blocked:re-compose→steward-final-patch-required/region-changed: 82; blocked:steward-final-patch-required/declared-line-overlap: 205; blocked:steward-final-patch-required/region-changed: 480; blocked:steward-final-patch-required/same-region-in-batch: 90 |

### 1b. 每 batch 嘗試次數分布（batches；括號＝intents）

| 臂 | 分布 |
|---|---|
| old | 0 次: 2189（2610） |
| fix | 0 次: 720（1041）; 1 次: 1457（1567）; 2 次: 2（2） |
| opt | 0 次: 512（781）; 1 次: 1659（1803）; 2 次: 24（26） |
| optlock | 0 次: 534（769）; 1 次: 1665（1841） |
| optr0 | 0 次: 522（793）; 1 次: 1665（1817） |
| optr1 | 0 次: 503（775）; 1 次: 1658（1800）; 2 次: 34（35） |

## 2. E4 完整 cells（r1 同 seeds／flags）

| 組 | 完成／總 intents | 失敗 runs／總 runs | 遺失效果 | blocked intents | 損壞檔 | 多餘檔 | re-compose 事件／成功 | 額外嘗試 | wall ms mean / p95 | intent total_ms mean / p95 |
|---|---|---|---:|---:|---:|---:|---|---:|---|---|
| old · main_p2 | 69／106（65.1%） | 0／3 | 0 | 37 | 0 | 0 | 0／0 | 0 | 540.29 / 588.18 | 81.07 / 167.43 |
| old · main_p4 | 63／106（59.4%） | 0／3 | 0 | 43 | 0 | 0 | 0／0 | 0 | 584.55 / 634.08 | 92.08 / 179.33 |
| old · main_p8 | 58／106（54.7%） | 0／3 | 0 | 48 | 0 | 0 | 0／0 | 0 | 612.29 / 657.08 | 106.51 / 263.28 |
| old · sp | 98／106（92.5%） | 0／3 | 0 | 8 | 0 | 0 | 0／0 | 0 | 796.79 / 829.95 | 131.22 / 284.19 |
| old · fault_naive_p8 | 58／106（54.7%） | 1／3 | 1 | 47 | 0 | 0 | 0／0 | 0 | 752.18 / 838.35 | 109.85 / 272.64 |
| old · fault_nolock_p8 | 61／106（57.6%） | 1／3 | 1 | 44 | 0 | 0 | 0／0 | 0 | 646.22 / 682.98 | 111.46 / 269.45 |
| fix · main_p2 | 61／106（57.6%） | 0／3 | 0 | 45 | 0 | 0 | 1／0 | 0 | 566.28 / 663.39 | 83.65 / 174.17 |
| fix · main_p4 | 59／106（55.7%） | 0／3 | 0 | 47 | 0 | 0 | 1／0 | 0 | 578.97 / 616.49 | 91.47 / 197.72 |
| fix · main_p8 | 57／106（53.8%） | 0／3 | 0 | 49 | 0 | 0 | 0／0 | 0 | 712.23 / 763.08 | 116.29 / 273.97 |
| fix · sp | 98／106（92.5%） | 0／3 | 0 | 8 | 0 | 0 | 0／0 | 0 | 832.34 / 912.43 | 136.07 / 299.97 |
| fix · fault_naive_p8 | 57／106（53.8%） | 0／3 | 0 | 49 | 0 | 0 | 1／0 | 0 | 654.25 / 699.93 | 106.8 / 236.5 |
| fix · fault_nolock_p8 | 52／106（49.1%） | 0／3 | 0 | 54 | 0 | 0 | 0／0 | 0 | 672.58 / 702.01 | 115.92 / 279.31 |
| opt · main_p2 | 73／106（68.9%） | 0／3 | 0 | 33 | 0 | 0 | 3／0 | 0 | 549.37 / 591.93 | 86.77 / 207.56 |
| opt · main_p4 | 75／106（70.8%） | 0／3 | 0 | 31 | 0 | 0 | 7／3 | 3 | 602.5 / 655.0 | 92.19 / 191.81 |
| opt · main_p8 | 74／106（69.8%） | 0／3 | 0 | 32 | 0 | 0 | 4／2 | 2 | 671.34 / 780.04 | 113.1 / 276.64 |
| opt · sp | 98／106（92.5%） | 0／3 | 0 | 8 | 0 | 0 | 0／0 | 0 | 805.42 / 822.77 | 130.91 / 294.67 |
| opt · fault_naive_p8 | 75／106（70.8%） | 0／3 | 0 | 31 | 0 | 0 | 19／9 | 9 | 617.07 / 659.42 | 111.22 / 291.32 |
| opt · fault_nolock_p8 | 75／106（70.8%） | 0／3 | 0 | 31 | 0 | 0 | 8／4 | 5 | 689.39 / 752.69 | 111.69 / 283.55 |
| optlock · main_p2 | 69／106（65.1%） | 0／3 | 0 | 37 | 0 | 0 | 0／0 | 0 | 609.34 / 643.07 | 99.29 / 252.32 |
| optlock · main_p4 | 72／106（67.9%） | 0／3 | 0 | 34 | 0 | 0 | 0／0 | 0 | 665.5 / 708.12 | 110.73 / 332.63 |
| optlock · main_p8 | 82／106（77.4%） | 0／3 | 0 | 24 | 0 | 0 | 0／0 | 0 | 952.7 / 1016.87 | 155.7 / 546.95 |

## 3. 單 process 回歸（E2 子集：3 workloads × 5 arms × seeds 11/17/23 × 2 reps；bea35380→2118bc66）

| arm/workload | 完成 fix→opt | lost fix/opt | failed runs fix/opt | total_ms mean fix→opt (Δ%) | p50 Δ | p95 Δ | apply_ms mean Δ (Δ%) | apply p95 Δ | 雜訊（同 pin rep2−rep1，total mean） |
|---|---|---|---|---|---|---|---|---|---|
| steward/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 98.09 → 98.68 (0.6%) | -2.62 | -5.84 | -0.2 (-0.4%) | 0.45 | fix 4.11 / opt 5.0 |
| steward/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 78.2 → 81.43 (4.1%) | 0.44 | 11.74 | 2.04 (4.8%) | 3.52 | fix -2.76 / opt -2.67 |
| steward/cold | 72/72 → 72/72 | 0/0 | 0/0 | 58.53 → 60.53 (3.4%) | 0.42 | 4.66 | 0.78 (4.0%) | 9.46 | fix -2.69 / opt 0.61 |
| steward/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 79.12 → 81.04 (2.4%) | 0.41 | 24.78 | 0.86 (2.2%) | 1.29 | fix -0.34 / opt 1.02 |
| file_lock/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 30.82 → 31.39 (1.8%) | 0.62 | 0.82 | -0.09 (-4.3%) | -0.52 | fix 0.07 / opt -1.56 |
| file_lock/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 24.43 → 24.76 (1.4%) | -0.21 | 3.49 | -0.04 (-2.0%) | -0.34 | fix 0.43 / opt -1.17 |
| file_lock/cold | 72/72 → 72/72 | 0/0 | 0/0 | 21.55 → 21.57 (0.1%) | -0.61 | 0.32 | -0.04 (-2.1%) | -0.18 | fix 0.19 / opt -0.13 |
| file_lock/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 25.78 → 26.11 (1.3%) | -0.4 | 6.14 | -0.06 (-3.0%) | -0.27 | fix 0.23 / opt -0.99 |
| occ/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 25.65 → 25.36 (-1.1%) | 0.3 | -2.08 | -0.19 (-4.6%) | -0.81 | fix -0.01 / opt -0.58 |
| occ/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 24.55 → 24.45 (-0.4%) | 0.18 | -1.04 | -0.06 (-1.5%) | 0.31 | fix -0.14 / opt 0.23 |
| occ/cold | 72/72 → 72/72 | 0/0 | 0/0 | 23.6 → 23.28 (-1.4%) | 0.29 | -0.7 | -0.27 (-7.0%) | -1.34 | fix 0.48 / opt 0.53 |
| occ/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 24.65 → 24.41 (-1.0%) | 0.09 | -1.11 | -0.16 (-4.0%) | -0.62 | fix 0.1 / opt 0.04 |
| git_three_way/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 139.73 → 139.41 (-0.2%) | 0.36 | 3.46 | -0.25 (-0.2%) | 0.02 | fix 0.04 / opt -0.07 |
| git_three_way/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 128.89 → 129.47 (0.4%) | 0.31 | 0.32 | 0.53 (0.5%) | 1.27 | fix 0.04 / opt -0.99 |
| git_three_way/cold | 72/72 → 72/72 | 0/0 | 0/0 | 128.6 → 128.27 (-0.3%) | 0.53 | 0.77 | -0.11 (-0.1%) | 0.92 | fix 1.1 / opt -0.44 |
| git_three_way/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 132.6 → 132.59 (-0.0%) | 0.0 | -0.11 | 0.06 (0.1%) | 0.46 | fix 0.36 / opt -0.49 |
| bare_composer/hot_conflict | 72/82 → 72/82 | 0/0 | 0/0 | 160.95 → 161.08 (0.1%) | 0.1 | -0.57 | -0.23 (-0.2%) | 4.53 | fix 1.12 / opt -0.39 |
| bare_composer/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 161.16 → 163.85 (1.7%) | -0.98 | 7.05 | 1.94 (1.4%) | 8.07 | fix -0.59 / opt -3.02 |
| bare_composer/cold | 72/72 → 72/72 | 0/0 | 0/0 | 163.74 → 163.27 (-0.3%) | 0.44 | -1.16 | -0.01 (-0.0%) | 1.91 | fix 2.29 / opt 1.25 |
| bare_composer/ALL | 224/234 → 224/234 | 0/0 | 0/0 | 161.88 → 162.7 (0.5%) | -0.08 | 3.36 | 0.58 (0.4%) | 6.39 | fix 0.89 / opt -0.78 |

## 4. Barrier 2-process 交錯測試（確定性）

| 案例 | window hit | 遺失效果 | follower 結果 | 最終＝leader-only | 最終＝兩者 full bytes | 殘留檔 | follower lock 取得／tx 嘗試 |
|---|---|---|---|---|---|---|---|
| beforeprecheck-opt-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[1] |
| beforeprecheck-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [1]／[2] |
| seam-fix-Lreducers-Freducers | 20/20 | 0 | {'blocked_after_re-compose(compose-context-mismatch)': 20} | 20 | 0 | 0 | [1]／[0] |
| seam-fix-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [2]／[0] |
| seam-old-Lreducers-Freducers | 20/20 | 20 | {'applied_overwrite': 20} | 0 | 0 | 0 | [0]／[0] |
| seam-old-Lselectors-Freducers | 20/20 | 20 | {'applied_overwrite': 20} | 0 | 0 | 0 | [0]／[0] |
| seam-opt-Lreducers-Freducers | 20/20 | 0 | {'blocked_after_re-compose(steward-final-patch-required)': 20} | 20 | 0 | 0 | [1]／[1] |
| seam-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [2]／[2] |
| staleprop-fix-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| staleprop-fix-Lselectors-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| staleprop-opt-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| staleprop-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_both_present': 20} | 0 | 20 | 0 | [1]／[1] |
| superseded-v1-beforeprecheck-opt-Lreducers-Freducers | 19/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[1, 0] |
| superseded-v1-beforeprecheck-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 15, 'applied_both_present': 5} | 0 | 20 | 0 | [1]／[2, 1] |

## 5. 故障情境（harness 層；2118bc66 主、bea35380 對照）

| 情境 | variant | pin | n | 遺失效果（runs） | frame 壞 | 殘留檔 | 結果分布 |
|---|---|---|---:|---|---:|---:|---|
| F1-holder-sigkill | after-lock | 2118bc66 | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | 2118bc66 | 10 | 0（0） | 0 | 10 | {'B:applied': 10} |
| F2-crafted-owner | pidreuse-live-pid-wrong-starttoken | 2118bc66 | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | live-pid-correct-starttoken | 2118bc66 | 5 | 0（0） | 0 | 0 | {'B:blocked(recovery-required)': 5} |
| F2-crafted-owner | dead-pid | 2118bc66 | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | legacy-v1-live-pid | 2118bc66 | 5 | 0（0） | 0 | 0 | {'B:blocked(recovery-required)': 5} |
| F3-live-holder-timeout | hold3500ms | 2118bc66 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F4-tmpdir | same-tmpdir/B-same-region | 2118bc66 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 10} |
| F4-tmpdir | same-tmpdir/B-other-region | 2118bc66 | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F4-tmpdir | different-tmpdir/B-same-region | 2118bc66 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 10} |
| F4-tmpdir | different-tmpdir/B-other-region | 2118bc66 | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 2118bc66 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-pidns/contender-host | 2118bc66 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F5-retry-exhaustion | default-policy/K=always | 2118bc66 | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 5 of 5)': 5} |
| F5-retry-exhaustion | default-policy/K=2 | 2118bc66 | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | default-policy/K=4 | 2118bc66 | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | maxRecompose=0/K=always | 2118bc66 | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 5} |
| F5-retry-exhaustion | maxRecompose=1,backoff0/K=1 | 2118bc66 | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F1-holder-sigkill | after-lock | bea35380 | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | bea35380 | 10 | 0（0） | 0 | 10 | {'B:applied': 10} |
| F2-crafted-owner | pidreuse-live-pid-wrong-starttoken | bea35380 | 5 | 0（0） | 0 | 0 | {'B:blocked(recovery-required)': 5} |
| F2-crafted-owner | live-pid-correct-starttoken | bea35380 | 5 | 0（0） | 0 | 0 | {'B:blocked(recovery-required)': 5} |
| F2-crafted-owner | dead-pid | bea35380 | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | legacy-v1-live-pid | bea35380 | 5 | 0（0） | 0 | 0 | {'B:blocked(recovery-required)': 5} |
| F3-live-holder-timeout | hold3500ms | bea35380 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F4-tmpdir | same-tmpdir/B-same-region | bea35380 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(compose-context-mismatch)': 10} |
| F4-tmpdir | same-tmpdir/B-other-region | bea35380 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(compose-context-mismatch)': 10} |
| F4-tmpdir | different-tmpdir/B-same-region | bea35380 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F4-tmpdir | different-tmpdir/B-other-region | bea35380 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | bea35380 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-pidns/contender-host | bea35380 | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |

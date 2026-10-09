# r5 驗證表（ATM 37847584 queue on／off vs 2118bc66 vs bea35380 vs 5692474f）

> DRAFT。不主張勝出。作者自行執行、未獨立重現。由 `analysis/r5_compare.py` 從 raw 重建（唯讀）。定義見 r5_summary.json `definitions`。Wilson 95% CI 為描述性（intent 非獨立）。

## 1. E4 重播（r3/r4 同配置與預先登錄 seeds：每臂 75 runs，含 p2/s17 共 35 次；四 pin 同時段交錯）

| 組 | 完成／總 intents | 完成 Wilson 95% | 失敗 runs／總 runs | 失敗 runs Wilson 95% | 遺失效果 | 遺失 Wilson 95%（per intent） | blocked intents | 其中 hash-drift | 損壞檔 | 多餘檔 | re-compose 事件／成功 | 額外嘗試 | wall ms mean / p95 | intent total_ms mean / p95 |
|---|---|---|---|---|---:|---|---:|---:|---:|---:|---|---:|---|---|
| old · all | 1515／2610（58.1%） | [0.5614, 0.5993] | 6／75 | [0.0372, 0.1637] | 6 | [0.0011, 0.005] | 1089 | 795 | 0 | 0 | 0／0 | 0 | 650.46 / 790.38 | 103.56 / 234.92 |
| old · p2_s17_35 | 738／1190（62.0%） | [0.5922, 0.6473] | 2／35 | [0.0158, 0.1861] | 2 | [0.0005, 0.0061] | 450 | 284 | 0 | 0 | 0／0 | 0 | 633.83 / 723.83 | 97.84 / 196.63 |
| old · grid_p2 | 307／530（57.9%） | [0.5368, 0.6206] | 1／15 | [0.0119, 0.2982] | 1 | [0.0003, 0.0106] | 222 | 129 | 0 | 0 | 0／0 | 0 | 595.81 / 675.73 | 89.2 / 196.14 |
| old · grid_p4 | 296／530（55.9%） | [0.5159, 0.6002] | 1／15 | [0.0119, 0.2982] | 1 | [0.0003, 0.0106] | 233 | 195 | 0 | 0 | 0／0 | 0 | 623.69 / 720.88 | 101.48 / 229.63 |
| old · grid_p8 | 278／530（52.4%） | [0.482, 0.5667] | 2／15 | [0.0374, 0.3788] | 2 | [0.001, 0.0137] | 250 | 228 | 0 | 0 | 0／0 | 0 | 734.56 / 1010.77 | 127.03 / 314.43 |
| fix · all | 1534／2610（58.8%） | [0.5687, 0.6065] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 1076 | 768 | 0 | 0 | 19／2 | 2 | 646.06 / 802.91 | 104.18 / 237.73 |
| fix · p2_s17_35 | 737／1190（61.9%） | [0.5914, 0.6465] | 0／35 | [0.0, 0.0989] | 0 | [0.0, 0.0032] | 453 | 285 | 0 | 0 | 8／0 | 0 | 624.09 / 813.14 | 99.83 / 212.36 |
| fix · grid_p2 | 316／530（59.6%） | [0.5539, 0.6372] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 214 | 127 | 0 | 0 | 2／1 | 1 | 602.06 / 710.59 | 90.52 / 187.59 |
| fix · grid_p4 | 301／530（56.8%） | [0.5254, 0.6095] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 229 | 175 | 0 | 0 | 6／1 | 1 | 620.85 / 708.01 | 102.35 / 220.86 |
| fix · grid_p8 | 281／530（53.0%） | [0.4876, 0.5723] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 249 | 222 | 0 | 0 | 4／0 | 0 | 732.86 / 831.95 | 122.66 / 310.84 |
| opt · all | 1727／2610（66.2%） | [0.6433, 0.6796] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 883 | 0 | 0 | 0 | 103／29 | 31 | 659.27 / 841.55 | 105.11 / 239.01 |
| opt · p2_s17_35 | 796／1190（66.9%） | [0.6417, 0.6951] | 0／35 | [0.0, 0.0989] | 0 | [0.0, 0.0032] | 394 | 0 | 0 | 0 | 38／6 | 6 | 648.04 / 857.11 | 100.81 / 208.92 |
| opt · grid_p2 | 334／530（63.0%） | [0.5883, 0.6702] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 196 | 0 | 0 | 0 | 13／0 | 0 | 616.86 / 703.36 | 91.6 / 195.77 |
| opt · grid_p4 | 351／530（66.2%） | [0.621, 0.7012] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 179 | 0 | 0 | 0 | 29／12 | 14 | 637.47 / 737.88 | 102.41 / 217.82 |
| opt · grid_p8 | 360／530（67.9%） | [0.6383, 0.7176] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 170 | 0 | 0 | 0 | 29／11 | 11 | 719.94 / 845.94 | 125.11 / 313.5 |
| q · all | 1716／2610（65.8%） | [0.639, 0.6754] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 894 | 0 | 0 | 0 | 0／0 | 0 | 664.12 / 821.95 | 107.54 / 249.03 |
| q · p2_s17_35 | 763／1190（64.1%） | [0.6135, 0.6679] | 0／35 | [0.0, 0.0989] | 0 | [0.0, 0.0032] | 427 | 0 | 0 | 0 | 0／0 | 0 | 643.0 / 786.59 | 101.84 / 217.89 |
| q · grid_p2 | 339／530（64.0%） | [0.5979, 0.6794] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 191 | 0 | 0 | 0 | 0／0 | 0 | 607.77 / 683.11 | 94.66 / 196.81 |
| q · grid_p4 | 362／530（68.3%） | [0.6422, 0.7212] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 168 | 0 | 0 | 0 | 0／0 | 0 | 660.5 / 764.23 | 107.19 / 237.13 |
| q · grid_p8 | 365／530（68.9%） | [0.648, 0.7266] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 165 | 0 | 0 | 0 | 0／0 | 0 | 740.53 / 825.61 | 128.15 / 314.79 |
| nq · all | 1705／2610（65.3%） | [0.6348, 0.6713] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 905 | 0 | 0 | 0 | 105／35 | 37 | 660.67 / 833.25 | 107.64 / 251.31 |
| nq · p2_s17_35 | 772／1190（64.9%） | [0.6212, 0.6753] | 0／35 | [0.0, 0.0989] | 0 | [0.0, 0.0032] | 418 | 0 | 0 | 0 | 38／2 | 2 | 649.36 / 886.46 | 104.43 / 219.01 |
| nq · grid_p2 | 335／530（63.2%） | [0.5902, 0.672] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 195 | 0 | 0 | 0 | 17／2 | 2 | 598.57 / 694.79 | 91.77 / 194.18 |
| nq · grid_p4 | 345／530（65.1%） | [0.6094, 0.6903] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 185 | 0 | 0 | 0 | 19／10 | 10 | 648.4 / 713.18 | 106.14 / 242.41 |
| nq · grid_p8 | 362／530（68.3%） | [0.6422, 0.7212] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 168 | 0 | 0 | 0 | 38／21 | 23 | 717.42 / 833.25 | 125.83 / 321.72 |
| qr0 · all | 1719／2610（65.9%） | [0.6402, 0.6766] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 891 | 0 | 0 | 0 | 0／0 | 0 | 676.59 / 817.7 | 109.84 / 253.06 |
| qr0 · p2_s17_35 | 774／1190（65.0%） | [0.6229, 0.677] | 0／35 | [0.0, 0.0989] | 0 | [0.0, 0.0032] | 416 | 0 | 0 | 0 | 0／0 | 0 | 663.67 / 785.69 | 105.03 / 227.41 |
| qr0 · grid_p2 | 332／530（62.6%） | [0.5845, 0.6666] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 198 | 0 | 0 | 0 | 0／0 | 0 | 622.82 / 732.25 | 95.19 / 198.53 |
| qr0 · grid_p4 | 354／530（66.8%） | [0.6267, 0.7067] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 176 | 0 | 0 | 0 | 0／0 | 0 | 680.47 / 838.28 | 110.26 / 241.91 |
| qr0 · grid_p8 | 368／530（69.4%） | [0.6538, 0.732] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 162 | 0 | 0 | 0 | 0／0 | 0 | 723.18 / 817.7 | 128.17 / 318.39 |
| qr1 · all | 1746／2610（66.9%） | [0.6507, 0.6868] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 864 | 0 | 0 | 0 | 0／0 | 0 | 673.22 / 819.56 | 108.27 / 255.36 |
| qr1 · p2_s17_35 | 784／1190（65.9%） | [0.6314, 0.6852] | 0／35 | [0.0, 0.0989] | 0 | [0.0, 0.0032] | 406 | 0 | 0 | 0 | 0／0 | 0 | 672.17 / 808.81 | 104.05 / 218.72 |
| qr1 · grid_p2 | 342／530（64.5%） | [0.6036, 0.6848] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 188 | 0 | 0 | 0 | 0／0 | 0 | 632.13 / 701.65 | 97.13 / 204.38 |
| qr1 · grid_p4 | 367／530（69.2%） | [0.6519, 0.7302] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 163 | 0 | 0 | 0 | 0／0 | 0 | 649.45 / 724.15 | 105.59 / 231.38 |
| qr1 · grid_p8 | 370／530（69.8%） | [0.6577, 0.7357] | 0／15 | [0.0, 0.2039] | 0 | [0.0, 0.0072] | 160 | 0 | 0 | 0 | 0／0 | 0 | 717.85 / 836.76 | 126.85 / 315.81 |

臂：old＝5692474f；fix＝bea35380；opt＝2118bc66；q＝37847584 queue on（主，ATM 預設）；nq＝37847584 queue off；qr0＝37847584 queue on＋ATM_STEWARD_RECOMPOSE_POLICY maxRecomposeAttempts 0；qr1＝同上 1 次、backoff 0、jitter 0。harness 鎖皆 off。

### 1-p. 逐 run 配對（同 seed／配置／rep；描述性，非顯著性檢定）

| 比較 | 配對數 | 較高 | 相同 | 較低 | 每 run 平均差 | 合計差 |
|---|---:|---:|---:|---:|---:|---:|
| q_vs_opt | 75 | 28 | 15 | 32 | -0.15 | -11 |
| q_vs_fix | 75 | 50 | 9 | 16 | 2.43 | 182 |
| q_vs_old | 75 | 61 | 2 | 12 | 2.68 | 201 |
| nq_vs_q | 75 | 28 | 13 | 34 | -0.15 | -11 |
| nq_vs_opt | 75 | 28 | 11 | 36 | -0.29 | -22 |
| qr0_vs_q | 75 | 31 | 13 | 31 | 0.04 | 3 |
| qr1_vs_q | 75 | 34 | 10 | 31 | 0.4 | 30 |
| opt_vs_fix | 75 | 53 | 13 | 9 | 2.57 | 193 |
| fix_vs_old | 75 | 34 | 9 | 32 | 0.25 | 19 |

### 1a. blocked／完成 intents 依最終分類

| 臂 | 分類 → intents |
|---|---|
| old | applied: 1521; blocked:compose-context-mismatch: 3; blocked:file-hash-drift: 795; blocked:stale-precheck(unlocked): 71; blocked:steward-final-patch-required/declared-line-overlap: 220 |
| fix | applied: 1532; applied_after_re-compose: 2; blocked:compose-context-mismatch: 3; blocked:file-hash-drift: 768; blocked:re-compose→compose-context-mismatch: 18; blocked:stale-precheck(unlocked): 73; blocked:steward-final-patch-required/declared-line-overlap: 214 |
| opt | applied: 1696; applied_after_re-compose: 31; blocked:re-compose→steward-final-patch-required/region-changed: 84; blocked:steward-final-patch-required/declared-line-overlap: 250; blocked:steward-final-patch-required/region-changed: 466; blocked:steward-final-patch-required/same-region-in-batch: 83 |
| q | applied: 1716; blocked:ERR_SQLITE_ERROR: 3; blocked:steward-final-patch-required/declared-line-overlap: 196; blocked:steward-final-patch-required/region-changed: 568; blocked:steward-final-patch-required/same-region-in-batch: 127 |
| nq | applied: 1670; applied_after_re-compose: 35; blocked:re-compose→steward-final-patch-required/region-changed: 85; blocked:steward-final-patch-required/declared-line-overlap: 239; blocked:steward-final-patch-required/region-changed: 482; blocked:steward-final-patch-required/same-region-in-batch: 99 |
| qr0 | applied: 1719; blocked:ERR_SQLITE_ERROR: 2; blocked:steward-final-patch-required/declared-line-overlap: 236; blocked:steward-final-patch-required/region-changed: 528; blocked:steward-final-patch-required/same-region-in-batch: 125 |
| qr1 | applied: 1746; blocked:ERR_SQLITE_ERROR: 2; blocked:steward-final-patch-required/declared-line-overlap: 213; blocked:steward-final-patch-required/region-changed: 546; blocked:steward-final-patch-required/same-region-in-batch: 103 |

### 1b. 每 batch 嘗試次數分布（batches；括號＝intents）

| 臂 | 分布 |
|---|---|
| old | 0 次: 2189（2610） |
| fix | 0 次: 744（1058）; 1 次: 1441（1550）; 2 次: 2（2） |
| opt | 0 次: 524（799）; 1 次: 1639（1778）; 2 次: 31（33） |
| q | 0 次: 610（894）; 1 次: 1591（1716） |
| nq | 0 次: 537（820）; 1 次: 1617（1754）; 2 次: 35（35）; 3 次: 1（1） |
| qr0 | 0 次: 603（891）; 1 次: 1590（1719） |
| qr1 | 0 次: 591（864）; 1 次: 1618（1746） |

## 2. E4 完整 cells（r1 同 seeds／flags）

| 組 | 完成／總 intents | 完成 Wilson 95% | 失敗 runs／總 runs | 失敗 runs Wilson 95% | 遺失效果 | 遺失 Wilson 95%（per intent） | blocked intents | 其中 hash-drift | 損壞檔 | 多餘檔 | re-compose 事件／成功 | 額外嘗試 | wall ms mean / p95 | intent total_ms mean / p95 |
|---|---|---|---|---|---:|---|---:|---:|---:|---:|---|---:|---|---|
| old · main_p2 | 62／106（58.5%） | [0.4897, 0.6741] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 44 | 24 | 0 | 0 | 0／0 | 0 | 587.02 / 643.49 | 85.51 / 178.49 |
| old · main_p4 | 52／106（49.1%） | [0.3974, 0.5844] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 54 | 44 | 0 | 0 | 0／0 | 0 | 580.11 / 591.35 | 94.61 / 200.63 |
| old · main_p8 | 59／106（55.7%） | [0.4617, 0.6476] | 1／3 | [0.0615, 0.7923] | 1 | [0.0017, 0.0515] | 46 | 43 | 0 | 0 | 0／0 | 0 | 649.57 / 695.53 | 113.27 / 286.99 |
| old · sp | 102／106（96.2%） | [0.907, 0.9852] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 4 | 0 | 0 | 0 | 0／0 | 0 | 841.79 / 950.79 | 140.94 / 295.81 |
| old · fault_naive_p8 | 60／106（56.6%） | [0.471, 0.6564] | 1／3 | [0.0615, 0.7923] | 1 | [0.0017, 0.0515] | 45 | 39 | 0 | 0 | 0／0 | 0 | 624.92 / 653.84 | 113.02 / 318.58 |
| old · fault_nolock_p8 | 56／106（52.8%） | [0.434, 0.6207] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 50 | 47 | 0 | 0 | 0／0 | 0 | 711.39 / 748.89 | 118.93 / 286.43 |
| fix · main_p2 | 61／106（57.6%） | [0.4804, 0.6653] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 45 | 25 | 0 | 0 | 3／1 | 1 | 606.41 / 652.85 | 89.98 / 194.06 |
| fix · main_p4 | 53／106（50.0%） | [0.4065, 0.5935] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 53 | 44 | 0 | 0 | 1／0 | 0 | 611.77 / 665.29 | 97.33 / 191.98 |
| fix · main_p8 | 61／106（57.6%） | [0.4804, 0.6653] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 45 | 42 | 0 | 0 | 1／0 | 0 | 707.31 / 724.85 | 120.99 / 293.56 |
| fix · sp | 106／106（100.0%） | [0.965, 1.0] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 0 | 0 | 0 | 0 | 0／0 | 0 | 848.74 / 973.99 | 140.53 / 296.31 |
| fix · fault_naive_p8 | 56／106（52.8%） | [0.434, 0.6207] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 50 | 46 | 0 | 0 | 0／0 | 0 | 612.74 / 645.66 | 114.15 / 303.26 |
| fix · fault_nolock_p8 | 58／106（54.7%） | [0.4524, 0.6386] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 48 | 46 | 0 | 0 | 1／0 | 0 | 664.67 / 708.68 | 114.55 / 280.85 |
| opt · main_p2 | 72／106（67.9%） | [0.5855, 0.7605] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 34 | 0 | 0 | 0 | 4／1 | 1 | 655.85 / 696.03 | 99.24 / 196.54 |
| opt · main_p4 | 70／106（66.0%） | [0.566, 0.7435] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 36 | 0 | 0 | 0 | 2／1 | 1 | 640.72 / 673.64 | 103.89 / 208.21 |
| opt · main_p8 | 69／106（65.1%） | [0.5564, 0.735] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 37 | 0 | 0 | 0 | 6／2 | 2 | 709.87 / 730.73 | 126.17 / 306.25 |
| opt · sp | 102／106（96.2%） | [0.907, 0.9852] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 4 | 0 | 0 | 0 | 0／0 | 0 | 1011.55 / 1098.04 | 159.42 / 326.91 |
| opt · fault_naive_p8 | 71／106（67.0%） | [0.5757, 0.752] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 35 | 0 | 0 | 0 | 9／3 | 3 | 782.77 / 874.24 | 137.2 / 313.08 |
| opt · fault_nolock_p8 | 69／106（65.1%） | [0.5564, 0.735] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 37 | 0 | 0 | 0 | 4／1 | 1 | 754.07 / 863.32 | 135.12 / 313.44 |
| q · main_p2 | 69／106（65.1%） | [0.5564, 0.735] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 37 | 0 | 0 | 0 | 0／0 | 0 | 676.29 / 701.43 | 110.62 / 276.75 |
| q · main_p4 | 67／106（63.2%） | [0.5372, 0.7178] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 39 | 0 | 0 | 0 | 0／0 | 0 | 732.89 / 790.05 | 111.89 / 247.5 |
| q · main_p8 | 75／106（70.8%） | [0.6149, 0.7857] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 31 | 0 | 0 | 0 | 0／0 | 0 | 735.28 / 839.54 | 127.61 / 315.18 |
| q · sp | 94／106（88.7%） | [0.8125, 0.934] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 12 | 0 | 0 | 0 | 0／0 | 0 | 904.48 / 985.2 | 143.44 / 321.27 |
| q · fault_naive_p8 | 70／106（66.0%） | [0.566, 0.7435] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 36 | 0 | 0 | 0 | 0／0 | 0 | 772.71 / 864.53 | 132.95 / 335.75 |
| q · fault_nolock_p8 | 73／106（68.9%） | [0.5952, 0.7689] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 33 | 0 | 0 | 0 | 0／0 | 0 | 764.78 / 783.3 | 126.28 / 328.12 |
| nq · main_p2 | 70／106（66.0%） | [0.566, 0.7435] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 36 | 0 | 0 | 0 | 4／2 | 2 | 633.31 / 692.63 | 98.25 / 201.04 |
| nq · main_p4 | 69／106（65.1%） | [0.5564, 0.735] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 37 | 0 | 0 | 0 | 7／0 | 0 | 632.58 / 664.71 | 103.01 / 221.42 |
| nq · main_p8 | 75／106（70.8%） | [0.6149, 0.7857] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 31 | 0 | 0 | 0 | 8／4 | 4 | 742.32 / 760.06 | 129.35 / 308.02 |
| nq · fault_naive_p8 | 75／106（70.8%） | [0.6149, 0.7857] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 31 | 0 | 0 | 0 | 9／3 | 3 | 716.24 / 736.73 | 124.24 / 331.25 |
| nq · fault_nolock_p8 | 73／106（68.9%） | [0.5952, 0.7689] | 0／3 | [0.0, 0.5615] | 0 | [0.0, 0.035] | 33 | 0 | 0 | 0 | 5／5 | 5 | 701.93 / 771.99 | 126.45 / 307.62 |

## 3. 單 process 回歸（E2 子集：3 workloads × 5 arms × seeds 11/17/23 × 2 reps；2118bc66→37847584 queue on；欄名 fix＝2118bc66、opt＝37847584）

| arm/workload | 完成 fix→opt | lost fix/opt | failed runs fix/opt | total_ms mean fix→opt (Δ%) | p50 Δ | p95 Δ | apply_ms mean Δ (Δ%) | apply p95 Δ | 雜訊（同 pin rep2−rep1，total mean） |
|---|---|---|---|---|---|---|---|---|---|
| steward/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 105.34 → 113.98 (8.2%) | 69.91 | 7.6 | 6.43 (11.7%) | 5.75 | fix 1.82 / opt -8.71 |
| steward/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 90.64 → 94.96 (4.8%) | -1.89 | 6.73 | 3.4 (7.0%) | 6.8 | fix -3.31 / opt 2.87 |
| steward/cold | 72/72 → 72/72 | 0/0 | 0/0 | 64.15 → 69.28 (8.0%) | 4.18 | 13.73 | 2.66 (12.1%) | 5.45 | fix -0.64 / opt 1.91 |
| steward/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 87.64 → 93.72 (6.9%) | 2.9 | 12.02 | 4.23 (9.9%) | 5.75 | fix -0.69 / opt -1.48 |
| file_lock/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 34.64 → 36.81 (6.3%) | 2.99 | 3.14 | 0.33 (9.9%) | 0.5 | fix -1.54 / opt -0.68 |
| file_lock/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 28.1 → 27.56 (-1.9%) | -0.57 | -2.13 | 0.19 (6.5%) | 1.1 | fix -0.36 / opt -2.31 |
| file_lock/cold | 72/72 → 72/72 | 0/0 | 0/0 | 27.39 → 27.96 (2.1%) | 0.19 | 2.41 | -0.13 (-3.2%) | 0.51 | fix -0.05 / opt 0.57 |
| file_lock/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 30.17 → 30.92 (2.5%) | 0.85 | 5.19 | 0.15 (4.4%) | 0.71 | fix -0.68 / opt -0.85 |
| occ/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 30.43 → 28.25 (-7.2%) | -3.75 | 5.67 | -1.11 (-18.5%) | -2.73 | fix -4.76 / opt -1.42 |
| occ/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 28.79 → 27.62 (-4.1%) | -0.56 | -0.51 | -0.76 (-12.2%) | -3.25 | fix -1.07 / opt -1.16 |
| occ/cold | 72/72 → 72/72 | 0/0 | 0/0 | 32.16 → 31.46 (-2.2%) | -0.94 | 7.17 | -0.05 (-0.7%) | -1.95 | fix -0.26 / opt 0.39 |
| occ/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 30.4 → 29.02 (-4.5%) | -1.47 | 4.38 | -0.66 (-10.3%) | -2.16 | fix -2.11 / opt -0.78 |
| git_three_way/hot_conflict | 82/82 → 82/82 | 0/0 | 0/0 | 145.21 → 144.52 (-0.5%) | 0.07 | -3.28 | -0.67 (-0.6%) | -1.88 | fix -0.76 / opt -0.83 |
| git_three_way/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 134.95 → 135.5 (0.4%) | 0.43 | -1.66 | -1.34 (-1.2%) | -0.96 | fix 1.59 / opt -0.33 |
| git_three_way/cold | 72/72 → 72/72 | 0/0 | 0/0 | 132.57 → 133.75 (0.9%) | 2.4 | -0.66 | 0.04 (0.0%) | -2.21 | fix 0.4 / opt 0.15 |
| git_three_way/ALL | 234/234 → 234/234 | 0/0 | 0/0 | 137.81 → 138.12 (0.2%) | 0.76 | -3.87 | -0.68 (-0.6%) | -2.63 | fix 0.4 / opt -0.35 |
| bare_composer/hot_conflict | 72/82 → 72/82 | 0/0 | 0/0 | 168.03 → 170.89 (1.7%) | 2.8 | 6.65 | 2.36 (1.6%) | 4.23 | fix -1.33 / opt -0.04 |
| bare_composer/hot_disjoint | 80/80 → 80/80 | 0/0 | 0/0 | 166.97 → 170.89 (2.3%) | 1.9 | 14.52 | 3.64 (2.5%) | 0.76 | fix -1.88 / opt 0.54 |
| bare_composer/cold | 72/72 → 72/72 | 0/0 | 0/0 | 173.3 → 182.67 (5.4%) | 4.2 | 24.54 | 8.62 (5.8%) | 25.63 | fix -2.11 / opt 5.28 |
| bare_composer/ALL | 224/234 → 224/234 | 0/0 | 0/0 | 169.29 → 174.51 (3.1%) | 3.21 | 14.78 | 4.72 (3.3%) | 13.63 | fix -1.77 / opt 1.8 |

## 4. Barrier 2-process 交錯測試（確定性）

| 案例 | window hit | 遺失效果 | follower 結果 | 最終＝leader-only | 最終＝兩者 full bytes | 殘留檔 | follower lock 取得／tx 嘗試 |
|---|---|---|---|---|---|---|---|
| before-precheck-new-qoff-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[1] |
| before-precheck-new-qoff-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [0]／[2] |
| before-precheck-opt-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[1] |
| before-precheck-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [1]／[2] |
| seam-fix-Lreducers-Freducers | 20/20 | 0 | {'blocked_after_re-compose(compose-context-mismatch)': 20} | 20 | 0 | 0 | [1]／[0] |
| seam-fix-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [2]／[0] |
| seam-new-qoff-Lreducers-Freducers | 20/20 | 0 | {'blocked_after_re-compose(steward-final-patch-required)': 20} | 20 | 0 | 0 | [0]／[1] |
| seam-new-qoff-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [0]／[2] |
| seam-new-qon-exploratory-Lreducers-Freducers | 5/5 | 0 | {'blocked_after_re-compose(steward-final-patch-required)': 5} | 5 | 0 | 0 | [0]／[1] |
| seam-new-qon-exploratory-Lselectors-Freducers | 5/5 | 0 | {'applied_after_re-compose_both_present': 5} | 0 | 5 | 0 | [0]／[2] |
| seam-old-Lreducers-Freducers | 20/20 | 20 | {'applied_overwrite': 20} | 0 | 0 | 0 | [0]／[0] |
| seam-old-Lselectors-Freducers | 20/20 | 20 | {'applied_overwrite': 20} | 0 | 0 | 0 | [0]／[0] |
| seam-opt-Lreducers-Freducers | 20/20 | 0 | {'blocked_after_re-compose(steward-final-patch-required)': 20} | 20 | 0 | 0 | [1]／[1] |
| seam-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_after_re-compose_both_present': 20} | 0 | 20 | 0 | [2]／[2] |
| stale-proposal-fix-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| stale-proposal-fix-Lselectors-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| stale-proposal-new-qoff-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| stale-proposal-new-qoff-Lselectors-Freducers | 20/20 | 0 | {'applied_both_present': 20} | 0 | 20 | 0 | [0]／[1] |
| stale-proposal-new-qon-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| stale-proposal-new-qon-Lselectors-Freducers | 20/20 | 0 | {'applied_both_present': 20} | 0 | 20 | 0 | [0]／[1] |
| stale-proposal-opt-Lreducers-Freducers | 20/20 | 0 | {'blocked_other': 20} | 20 | 0 | 0 | [0]／[0] |
| stale-proposal-opt-Lselectors-Freducers | 20/20 | 0 | {'applied_both_present': 20} | 0 | 20 | 0 | [1]／[1] |

### 3b. steward queue off − queue on（37847584；單 process）

| workload | total_ms mean Δ (Δ%) | p95 Δ | apply_ms mean Δ (Δ%) |
|---|---|---|---|
| steward/hot_conflict | -8.99 (-7.9%) | -5.42 | -8.78 (-14.3%) |
| steward/hot_disjoint | -2.54 (-2.7%) | 0.57 | -3.21 (-6.2%) |
| steward/cold | -1.57 (-2.3%) | -3.29 | -1.19 (-4.8%) |
| steward/ALL | -4.5 (-4.8%) | -6.58 | -4.53 (-9.7%) |

## 5. 故障情境（harness 層；37847584 queue on／off 主、2118bc66 同場對照）

| 情境 | variant | pin | n | 遺失效果（runs） | frame 壞 | 殘留檔 | 結果分布 |
|---|---|---|---:|---|---:|---:|---|
| F1-holder-sigkill | after-lock | 2118bc66 | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | 2118bc66 | 10 | 0（0） | 0 | 10 | {'B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 2118bc66 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-pidns/contender-host | 2118bc66 | 10 | 10（10） | 0 | 0 | {'A:applied B:applied': 10} |
| F2b-forged-owner-live-holder | forged-owner-dead-pid | 2118bc66 | 5 | 5（5） | 0 | 0 | {'A:applied B:applied': 5} |
| F2b-forged-owner-live-holder | forged-owner-wrong-starttoken | 2118bc66 | 5 | 5（5） | 0 | 0 | {'A:applied B:applied': 5} |
| F1-holder-sigkill | after-lock | 37847584-qon | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | 37847584-qon | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F2-crafted-owner | pidreuse-live-pid-wrong-starttoken | 37847584-qon | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | live-pid-correct-starttoken | 37847584-qon | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | dead-pid | 37847584-qon | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | legacy-v1-live-pid | 37847584-qon | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F3-live-holder-timeout | hold3500ms | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F4-tmpdir | same-tmpdir/B-same-region | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 10} |
| F4-tmpdir | same-tmpdir/B-other-region | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F4-tmpdir | different-tmpdir/B-same-region | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 10} |
| F4-tmpdir | different-tmpdir/B-other-region | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-pidns/contender-host | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F2b-forged-owner-live-holder | forged-owner-dead-pid | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:applied B:applied': 5} |
| F2b-forged-owner-live-holder | forged-owner-wrong-starttoken | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:applied B:applied': 5} |
| O2-live-writer-temp | all-host | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F7-queue-wait-fallback | queue-wait300ms/A-hold3000ms | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F7-queue-wait-fallback | queue-wait300ms/A-hold1200ms | 37847584-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F5-retry-exhaustion | default-policy/K=always | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 5 of 5)': 5} |
| F5-retry-exhaustion | default-policy/K=2 | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | default-policy/K=4 | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | maxRecompose=0/K=always | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 5} |
| F5-retry-exhaustion | maxRecompose=1,backoff0/K=1 | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | env:ATM_STEWARD_RECOMPOSE_POLICY maxRecompose=0/K=always | 37847584-qon | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 5} |
| F1-holder-sigkill | after-lock | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F2-crafted-owner | pidreuse-live-pid-wrong-starttoken | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | live-pid-correct-starttoken | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | dead-pid | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F2-crafted-owner | legacy-v1-live-pid | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'B:applied': 5} |
| F3-live-holder-timeout | hold3500ms | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F4-tmpdir | same-tmpdir/B-same-region | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 10} |
| F4-tmpdir | same-tmpdir/B-other-region | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F4-tmpdir | different-tmpdir/B-same-region | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 10} |
| F4-tmpdir | different-tmpdir/B-other-region | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F6-pid-namespace | holder-pidns/contender-host | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F2b-forged-owner-live-holder | forged-owner-dead-pid | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 5} |
| F2b-forged-owner-live-holder | forged-owner-wrong-starttoken | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 5} |
| O2-live-writer-temp | all-host | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | 37847584-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F5-retry-exhaustion | default-policy/K=always | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 5 of 5)': 5} |
| F5-retry-exhaustion | default-policy/K=2 | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | default-policy/K=4 | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | maxRecompose=0/K=always | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 5} |
| F5-retry-exhaustion | maxRecompose=1,backoff0/K=1 | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:applied': 5} |
| F5-retry-exhaustion | env:ATM_STEWARD_RECOMPOSE_POLICY maxRecompose=0/K=always | 37847584-qoff | 5 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 5} |

### 5a. 證明欄位（namespace 分離、孤兒清理時機、存活寫入者的 temp）

| 情境 | 檢查 |
|---|---|
| F1-holder-sigkill | after-lock | 2118bc66 | {'orphan_after_kill': 0} |
| F1-holder-sigkill | before-rename | 2118bc66 | {'orphan_after_kill': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 2118bc66 | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 10} |
| F6-pid-namespace | holder-pidns/contender-host | 2118bc66 | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 10} |
| F1-holder-sigkill | after-lock | 37847584-qon | {'orphan_after_kill': 0} |
| F1-holder-sigkill | before-rename | 37847584-qon | {'orphan_removed_by_B': 10, 'orphan_removed_after_lock': 10, 'orphan_after_kill': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 37847584-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| F6-pid-namespace | holder-pidns/contender-host | 37847584-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| O2-live-writer-temp | all-host | 37847584-qon | {'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | 37847584-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | 37847584-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| F1-holder-sigkill | after-lock | 37847584-qoff | {'orphan_after_kill': 0} |
| F1-holder-sigkill | before-rename | 37847584-qoff | {'orphan_removed_by_B': 10, 'orphan_removed_after_lock': 10, 'orphan_after_kill': 10} |
| F6-pid-namespace | holder-host/contender-pidns | 37847584-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| F6-pid-namespace | holder-pidns/contender-host | 37847584-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| O2-live-writer-temp | all-host | 37847584-qoff | {'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | 37847584-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | 37847584-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |

## 6. E5 故障注入（r1 harness 原樣）

| 臂 | injection → 通過／n（觀察終態） |
|---|---|
| fix | context_mismatch: 2/2（{'blocked': 2}）; stale_cas: 2/2（{'blocked': 2}）; kill_mid_apply: 2/2（{'recovery-required': 2}）; rollback_ok: 2/2（{'rolled-back': 2}）; rollback_failure: 2/2（{'recovery-required': 2}）; receipt_loss: 2/2（{'recovery-required': 2}） |
| nq | context_mismatch: 2/2（{'blocked': 2}）; stale_cas: 2/2（{'blocked': 2}）; kill_mid_apply: 2/2（{'recovery-required': 2}）; rollback_ok: 2/2（{'rolled-back': 2}）; rollback_failure: 2/2（{'recovery-required': 2}）; receipt_loss: 2/2（{'recovery-required': 2}） |
| old | context_mismatch: 2/2（{'blocked': 2}）; stale_cas: 2/2（{'blocked': 2}）; kill_mid_apply: 2/2（{'recovery-required': 2}）; rollback_ok: 2/2（{'rolled-back': 2}）; rollback_failure: 2/2（{'recovery-required': 2}）; receipt_loss: 2/2（{'recovery-required': 2}） |
| opt | context_mismatch: 2/2（{'blocked': 2}）; stale_cas: 2/2（{'blocked': 2}）; kill_mid_apply: 2/2（{'recovery-required': 2}）; rollback_ok: 2/2（{'rolled-back': 2}）; rollback_failure: 2/2（{'recovery-required': 2}）; receipt_loss: 2/2（{'recovery-required': 2}） |
| q | context_mismatch: 2/2（{'blocked': 2}）; stale_cas: 2/2（{'blocked': 2}）; kill_mid_apply: 2/2（{'recovery-required': 2}）; rollback_ok: 2/2（{'rolled-back': 2}）; rollback_failure: 2/2（{'recovery-required': 2}）; receipt_loss: 2/2（{'recovery-required': 2}） |

| 臂 | occ_exhaust 完成／總、blocked | clean_steward 完成／總、lost、failed runs |
|---|---|---|
| old | 26/41、0 | 41/41、0、0/3 |
| fix | 27/41、0 | 41/41、0、0/3 |
| opt | 27/41、0 | 41/41、0、0/3 |
| q | 27/41、0 | 41/41、0、0/3 |
| nq | 27/41、0 | 41/41、0、0/3 |

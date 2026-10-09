# r6 驗證表（ATM b35a6141＝PR #238 queue on／off vs 37847584 queue on；同時段交錯）

> DRAFT。不主張勝出。作者自行執行、未獨立重現。由 `analysis/r6_compare.py` 從 raw 重建（唯讀）。定義同 r5（見 r6_summary.json `definitions`）。Wilson 95% CI 為描述性（intent 非獨立）。預先登錄：`runs/r6-validation/PREREG_R6.md`。

## 1. E4 重播（r5 同配置與 seeds；每臂 2 blocks × 75 runs）

| 組 | 完成／總 intents | 完成 Wilson 95% | 失敗 runs／總 runs | 失敗 runs Wilson 95% | 遺失效果 | 遺失 Wilson 95%（per intent） | blocked intents | 其中 hash-drift | 其中 ATM 例外 | SQLITE busy/locked intents（runs） | 殘留 presence 檔（runs） | 損壞檔 | 多餘檔 | re-compose 事件／成功 | wall ms mean / p95 | intent total_ms mean / p95 |
|---|---|---|---|---|---:|---|---:|---:|---:|---|---|---:|---:|---|---|---|
| q5 · all | 3490／5220（66.9%） | [0.6557, 0.6812] | 0／150 | [0.0, 0.025] | 0 | [0.0, 0.0007] | 1730 | 0 | 1 | 1（1） | 1（1） | 0 | 0 | 0／0 | 704.56 / 928.35 | 111.53 / 271.03 |
| q5 · block1 | 1769／2610（67.8%） | [0.6596, 0.6954] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 841 | 0 | 1 | 1（1） | 1（1） | 0 | 0 | 0／0 | 743.64 / 952.02 | 118.39 / 297.91 |
| q5 · block2 | 1721／2610（65.9%） | [0.641, 0.6773] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 889 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 665.49 / 851.43 | 104.67 / 243.58 |
| q5 · p2_s17_exact | 1343／2040（65.8%） | [0.6375, 0.6786] | 0／60 | [0.0, 0.0602] | 0 | [0.0, 0.0019] | 697 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 648.09 / 821.83 | 100.28 / 215.53 |
| q5 · grid_p2 | 680／1060（64.1%） | [0.6122, 0.6698] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 380 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 661.95 / 778.6 | 99.44 / 208.15 |
| q5 · grid_p4 | 727／1060（68.6%） | [0.6573, 0.7131] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 333 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 754.83 / 941.28 | 116.77 / 276.4 |
| q5 · grid_p8 | 740／1060（69.8%） | [0.6698, 0.725] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 320 | 0 | 1 | 1（1） | 1（1） | 0 | 0 | 0／0 | 809.86 / 965.33 | 140.02 / 364.32 |
| q6 · all | 3500／5220（67.0%） | [0.6576, 0.6831] | 0／150 | [0.0, 0.025] | 0 | [0.0, 0.0007] | 1720 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 691.66 / 891.32 | 111.86 / 269.92 |
| q6 · block1 | 1762／2610（67.5%） | [0.6569, 0.6928] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 848 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 733.83 / 913.05 | 119.27 / 293.44 |
| q6 · block2 | 1738／2610（66.6%） | [0.6476, 0.6837] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 872 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 649.48 / 837.9 | 104.46 / 249.9 |
| q6 · p2_s17_exact | 1349／2040（66.1%） | [0.6405, 0.6815] | 0／60 | [0.0, 0.0602] | 0 | [0.0, 0.0019] | 691 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 650.61 / 848.31 | 100.61 / 217.26 |
| q6 · grid_p2 | 659／1060（62.2%） | [0.5921, 0.6504] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 401 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 656.3 / 815.91 | 101.01 / 219.6 |
| q6 · grid_p4 | 742／1060（70.0%） | [0.6717, 0.7268] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 318 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 712.59 / 890.77 | 116.53 / 272.45 |
| q6 · grid_p8 | 750／1060（70.8%） | [0.6795, 0.7341] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 310 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 788.18 / 922.8 | 139.68 / 362.71 |
| nq6 · all | 3458／5220（66.2%） | [0.6495, 0.6752] | 0／150 | [0.0, 0.025] | 0 | [0.0, 0.0007] | 1762 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 217／58 | 682.43 / 905.47 | 110.3 / 266.23 |
| nq6 · block1 | 1728／2610（66.2%） | [0.6437, 0.68] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 882 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 115／31 | 716.09 / 917.64 | 116.29 / 285.77 |
| nq6 · block2 | 1730／2610（66.3%） | [0.6445, 0.6807] | 0／75 | [0.0, 0.0487] | 0 | [0.0, 0.0015] | 880 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 102／27 | 648.77 / 802.62 | 104.31 / 248.28 |
| nq6 · p2_s17_exact | 1357／2040（66.5%） | [0.6444, 0.6853] | 0／60 | [0.0, 0.0602] | 0 | [0.0, 0.0019] | 683 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 68／3 | 626.64 / 761.15 | 97.77 / 207.03 |
| nq6 · grid_p2 | 672／1060（63.4%） | [0.6045, 0.6624] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 388 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 32／9 | 651.92 / 806.28 | 99.55 / 211.02 |
| nq6 · grid_p4 | 708／1060（66.8%） | [0.639, 0.6956] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 352 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 44／17 | 724.13 / 900.15 | 116.82 / 286.84 |
| nq6 · grid_p8 | 721／1060（68.0%） | [0.6515, 0.7076] | 0／30 | [0.0, 0.1135] | 0 | [0.0, 0.0036] | 339 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 73／29 | 782.81 / 931.75 | 138.65 / 351.56 |

臂：q5＝37847584 queue on（r5 主臂同時段重跑）；q6＝b35a6141 queue on（r6 主，ATM 預設）；nq6＝b35a6141 queue off。harness 鎖皆 off。block1＝r5 原 75 runs 編號；block2＝同配置續編 reps。

### 1-p. 逐 run 配對（描述性，非顯著性檢定）

| 比較 | 配對數 | 較高 | 相同 | 較低 | 每 run 平均差 | 合計差 |
|---|---:|---:|---:|---:|---:|---:|
| q6_vs_q5 | 150 | 62 | 22 | 66 | 0.07 | 10 |
| nq6_vs_q6 | 150 | 63 | 18 | 69 | -0.28 | -42 |
| nq6_vs_q5 | 150 | 58 | 27 | 65 | -0.21 | -32 |

## 2. E4 主 cells（p{2,4,8} × s{11,17,23}；multi-process）

| 組 | 完成／總 intents | 完成 Wilson 95% | 失敗 runs／總 runs | 失敗 runs Wilson 95% | 遺失效果 | 遺失 Wilson 95%（per intent） | blocked intents | 其中 hash-drift | 其中 ATM 例外 | SQLITE busy/locked intents（runs） | 殘留 presence 檔（runs） | 損壞檔 | 多餘檔 | re-compose 事件／成功 | wall ms mean / p95 | intent total_ms mean / p95 |
|---|---|---|---|---|---:|---|---:|---:|---:|---|---|---:|---:|---|---|---|
| q5 · matrix | 213／318（67.0%） | [0.6164, 0.7192] | 0／9 | [0.0, 0.2992] | 0 | [0.0, 0.0119] | 105 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 631.74 / 694.48 | 101.81 / 229.82 |
| q6 · matrix | 209／318（65.7%） | [0.6035, 0.7072] | 0／9 | [0.0, 0.2992] | 0 | [0.0, 0.0119] | 109 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 0／0 | 620.38 / 754.94 | 98.82 / 221.15 |
| nq6 · matrix | 210／318（66.0%） | [0.6067, 0.7102] | 0／9 | [0.0, 0.2992] | 0 | [0.0, 0.0119] | 108 | 0 | 0 | 0（0） | 0（0） | 0 | 0 | 13／3 | 623.42 / 712.04 | 97.42 / 225.99 |

## 3. SQLITE busy/locked 例外與 presence 殘留（replay＋matrix 全部 runs）

| 臂 | runs | SQLITE 例外 intents | 受影響 runs | 殘留 presence 檔 | 有殘留的 runs | stdout 提及 SQLITE 次數 |
|---|---:|---:|---:|---:|---:|---:|
| q5 | 159 | 1 | 1 | 1 | 1 | 0 |
| q6 | 159 | 0 | 0 | 0 | 0 | 0 |
| nq6 | 159 | 0 | 0 | 0 | 0 | 0 |

ATM 例外 blocked 合計：1 intents／1 runs；依臂 {'q5': 1}

| run | 分類 | intents |
|---|---|---:|
| r6v-e4-p8-s11-g-q5-r5 | blocked:ERR_SQLITE_ERROR | 1 |

### 3a. queue stress repro（r5 forensics 腳本原樣；8 processes × 300 calls × 3 rounds／pin）

| pin | rounds | procs | 成功 calls | 拋出 calls | 殘留 presence 檔 | 錯誤分布 |
|---|---:|---:|---:|---:|---:|---|
| 37847584 | 3 | 24 | 7199 | 1 | 1 | {'ERR_SQLITE_ERROR database is locked @L252:6)': 1} |
| b35a6141 | 3 | 24 | 7200 | 0 | 0 | {} |

### 3b. † 事後加重 stress（非預先登錄、探索性；同腳本，16 processes × 1,000 calls × 3 rounds／pin，交錯）

| pin | rounds | procs | 成功 calls | 拋出 calls | 殘留 presence 檔 | 錯誤分布 |
|---|---:|---:|---:|---:|---:|---|
| 37847584 | 3 | 48 | 47922 | 78 | 78 | {'ERR_SQLITE_ERROR database is locked @L252:6)': 78} |
| b35a6141 | 3 | 48 | 48000 | 0 | 0 | {} |

### 1a. blocked／完成 intents 依最終分類

| 臂 | 分類 → intents |
|---|---|
| q5 | applied: 3490; blocked:ERR_SQLITE_ERROR: 1; blocked:steward-final-patch-required/declared-line-overlap: 524; blocked:steward-final-patch-required/region-changed: 1003; blocked:steward-final-patch-required/same-region-in-batch: 202 |
| q6 | applied: 3500; blocked:steward-final-patch-required/declared-line-overlap: 439; blocked:steward-final-patch-required/region-changed: 1074; blocked:steward-final-patch-required/same-region-in-batch: 207 |
| nq6 | applied: 3399; applied_after_re-compose: 59; blocked:re-compose→steward-final-patch-required/region-changed: 189; blocked:steward-final-patch-required/declared-line-overlap: 493; blocked:steward-final-patch-required/region-changed: 881; blocked:steward-final-patch-required/same-region-in-batch: 199 |

## 4. 故障情境（harness 層；b35a6141 queue on／off）

| 情境 | variant | pin | n | 遺失效果（runs） | frame 壞 | 殘留檔 | 結果分布 |
|---|---|---|---:|---|---:|---:|---|
| F1-holder-sigkill | after-lock | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| F6-pid-namespace | holder-pidns/contender-host | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:applied': 10} |
| O2-live-writer-temp | all-host | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | b35a6141-qon | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F1-holder-sigkill | after-lock | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F1-holder-sigkill | before-rename | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'B:applied': 10} |
| F6-pid-namespace | holder-host/contender-pidns | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F6-pid-namespace | holder-pidns/contender-host | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | all-host | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | b35a6141-qoff | 10 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 10} |
| F2-crafted-owner | pidreuse-live-pid-wrong-starttoken | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F2-crafted-owner | live-pid-correct-starttoken | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F2-crafted-owner | dead-pid | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F2-crafted-owner | legacy-v1-live-pid | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F3-live-holder-timeout | hold3500ms | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F4-tmpdir | same-tmpdir/B-same-region | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 3} |
| F4-tmpdir | same-tmpdir/B-other-region | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F4-tmpdir | different-tmpdir/B-same-region | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 3} |
| F4-tmpdir | different-tmpdir/B-other-region | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F2b-forged-owner-live-holder | forged-owner-dead-pid | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F2b-forged-owner-live-holder | forged-owner-wrong-starttoken | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F7-queue-wait-fallback | queue-wait300ms/A-hold3000ms | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 3} |
| F7-queue-wait-fallback | queue-wait300ms/A-hold1200ms | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F5-retry-exhaustion | default-policy/K=always | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 5 of 5)': 3} |
| F5-retry-exhaustion | default-policy/K=2 | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied': 3} |
| F5-retry-exhaustion | default-policy/K=4 | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied': 3} |
| F5-retry-exhaustion | maxRecompose=0/K=always | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 3} |
| F5-retry-exhaustion | maxRecompose=1,backoff0/K=1 | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:applied': 3} |
| F5-retry-exhaustion | env:ATM_STEWARD_RECOMPOSE_POLICY maxRecompose=0/K=always | b35a6141-qon | 3 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 3} |
| F2-crafted-owner | pidreuse-live-pid-wrong-starttoken | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F2-crafted-owner | live-pid-correct-starttoken | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F2-crafted-owner | dead-pid | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F2-crafted-owner | legacy-v1-live-pid | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'B:applied': 3} |
| F3-live-holder-timeout | hold3500ms | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 3} |
| F4-tmpdir | same-tmpdir/B-same-region | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 3} |
| F4-tmpdir | same-tmpdir/B-other-region | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F4-tmpdir | different-tmpdir/B-same-region | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(steward-final-patch-required)': 3} |
| F4-tmpdir | different-tmpdir/B-other-region | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:applied': 3} |
| F2b-forged-owner-live-holder | forged-owner-dead-pid | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 3} |
| F2b-forged-owner-live-holder | forged-owner-wrong-starttoken | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied B:blocked(recovery-required)': 3} |
| F5-retry-exhaustion | default-policy/K=always | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 5 of 5)': 3} |
| F5-retry-exhaustion | default-policy/K=2 | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied': 3} |
| F5-retry-exhaustion | default-policy/K=4 | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied': 3} |
| F5-retry-exhaustion | maxRecompose=0/K=always | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 3} |
| F5-retry-exhaustion | maxRecompose=1,backoff0/K=1 | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:applied': 3} |
| F5-retry-exhaustion | env:ATM_STEWARD_RECOMPOSE_POLICY maxRecompose=0/K=always | b35a6141-qoff | 3 | 0（0） | 0 | 0 | {'A:blocked(re-compose attempts exhausted after 1 of 1)': 3} |

### 4a. 證明欄位（namespace 分離、孤兒清理時機、存活寫入者的 temp）

| 情境 | 檢查 |
|---|---|
| F1-holder-sigkill | after-lock | b35a6141-qon | {'orphan_after_kill': 0} |
| F1-holder-sigkill | before-rename | b35a6141-qon | {'orphan_removed_by_B': 10, 'orphan_removed_after_lock': 10, 'orphan_after_kill': 10} |
| F6-pid-namespace | holder-host/contender-pidns | b35a6141-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| F6-pid-namespace | holder-pidns/contender-host | b35a6141-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| O2-live-writer-temp | all-host | b35a6141-qon | {'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | b35a6141-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | b35a6141-qon | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| F1-holder-sigkill | after-lock | b35a6141-qoff | {'orphan_after_kill': 0} |
| F1-holder-sigkill | before-rename | b35a6141-qoff | {'orphan_removed_by_B': 10, 'orphan_removed_after_lock': 10, 'orphan_after_kill': 10} |
| F6-pid-namespace | holder-host/contender-pidns | b35a6141-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| F6-pid-namespace | holder-pidns/contender-host | b35a6141-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'both_inside_lock': 0} |
| O2-live-writer-temp | all-host | b35a6141-qoff | {'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-pidns/cleaner+B-host | b35a6141-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |
| O2-live-writer-temp | writer-host/cleaner+B-pidns | b35a6141-qoff | {'ns_split_confirmed': 10, 'ns_checked': 10, 'live_temp_survived_cleaner': 10, 'cleaner_skipped_live_holder': 10, 'live_temp_survived_B': 10, 'live_temp_B_checked': 10} |

## 5. Barrier 2-process 交錯（確定性；b35a6141）

| 案例 | window hit | 遺失效果 | follower 結果 | 最終＝leader-only | 最終＝兩者 full bytes | 殘留檔 |
|---|---|---|---|---|---|---|
| seam-b35a6141-qoff-Lreducers-Freducers | 10/10 | 0 | {'blocked_after_re-compose(steward-final-patch-required)': 10} | 10 | 0 | 0 |
| seam-b35a6141-qoff-Lselectors-Freducers | 10/10 | 0 | {'applied_after_re-compose_both_present': 10} | 0 | 10 | 0 |
| stale-proposal-b35a6141-qoff-Lreducers-Freducers | 10/10 | 0 | {'blocked_other': 10} | 10 | 0 | 0 |
| stale-proposal-b35a6141-qoff-Lselectors-Freducers | 10/10 | 0 | {'applied_both_present': 10} | 0 | 10 | 0 |
| stale-proposal-b35a6141-qon-Lreducers-Freducers | 10/10 | 0 | {'blocked_other': 10} | 10 | 0 | 0 |
| stale-proposal-b35a6141-qon-Lselectors-Freducers | 10/10 | 0 | {'applied_both_present': 10} | 0 | 10 | 0 |

## 6. 反例檢查（§5.7：任何遺失效果或損壞檔）

{'replay_lost': 0, 'replay_corrupted': 0, 'matrix_lost': 0, 'matrix_corrupted': 0, 'faults_lost': 0, 'faults_frame_bad': 0, 'barrier_lost': 0}


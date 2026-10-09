# Analysis-only rebuild（r2 Phase 1 E）

從 raw cell 重算；與 r1 `*_compare_raw.json` 逐格比對（整數須相等，浮點容差 0.011）。

| stage | cells | 全欄位相符 |
|---|---|---|
| e1 | 45 | 45 |
| e2 | 150 | 150 |
| e3 | 120 | 120 |
| e4 | 18 | 18 |

不符欄位數：0


## E5 logical operations（runner cells；非 18 個 cell 分類）

| 類 | cells | offered | correct | blocked | lost |
|---|---|---|---|---|---|
| occ_exhaust | 3 | 41 | 26 | 15 | 0 |
| clean_steward | 3 | 41 | 41 | 0 | 0 |

## 彙總（ratio-of-sums 與 mean-of-ratios 分開；goodput mean±母體σ **不是** 95% CI）

| stage | workload | arm | sub | n | offered | correct (v1) | correct (v2) | lost | blocked | rate RoS | rate MoR | goodput mean±σ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e1 | cold | steward |  | 3 | 36 | 36 | 36 | 0 | 0 | 1.0 | 1.0 | 33.11±2.0 |
| e1 | cold | file_lock |  | 3 | 36 | 36 | 36 | 0 | 0 | 1.0 | 1.0 | 84.89±12.98 |
| e1 | cold | occ |  | 3 | 36 | 36 | 36 | 0 | 0 | 1.0 | 1.0 | 82.21±11.87 |
| e1 | cold | git_three_way |  | 3 | 36 | 36 | 36 | 0 | 0 | 1.0 | 1.0 | 18.3±1.84 |
| e1 | cold | bare_composer |  | 3 | 36 | 36 | 36 | 0 | 0 | 1.0 | 1.0 | 15.07±1.38 |
| e1 | hot_disjoint | steward |  | 3 | 40 | 40 | 40 | 0 | 0 | 1.0 | 1.0 | 29.83±3.01 |
| e1 | hot_disjoint | file_lock |  | 3 | 40 | 40 | 40 | 0 | 0 | 1.0 | 1.0 | 84.74±11.15 |
| e1 | hot_disjoint | occ |  | 3 | 40 | 40 | 40 | 0 | 0 | 1.0 | 1.0 | 94.02±7.17 |
| e1 | hot_disjoint | git_three_way |  | 3 | 40 | 40 | 40 | 0 | 0 | 1.0 | 1.0 | 20.51±0.77 |
| e1 | hot_disjoint | bare_composer |  | 3 | 40 | 40 | 40 | 0 | 0 | 1.0 | 1.0 | 16.72±1.04 |
| e1 | hot_conflict | steward |  | 3 | 41 | 41 | 41 | 0 | 0 | 1.0 | 1.0 | 28.07±2.95 |
| e1 | hot_conflict | file_lock |  | 3 | 41 | 41 | 41 | 0 | 0 | 1.0 | 1.0 | 75.03±3.44 |
| e1 | hot_conflict | occ |  | 3 | 41 | 41 | 41 | 0 | 0 | 1.0 | 1.0 | 86.98±5.68 |
| e1 | hot_conflict | git_three_way |  | 3 | 41 | 41 | 41 | 0 | 0 | 1.0 | 1.0 | 17.76±1.18 |
| e1 | hot_conflict | bare_composer |  | 3 | 41 | 36 | 36 | 0 | 5 | 0.878 | 0.8821 | 14.39±0.9 |
| e2 | hot_conflict | steward |  | 10 | 139 | 139 | 139 | 0 | 0 | 1.0 | 1.0 | 26.11±2.9 |
| e2 | hot_conflict | file_lock |  | 10 | 139 | 139 | 139 | 0 | 0 | 1.0 | 1.0 | 76.26±9.92 |
| e2 | hot_conflict | occ |  | 10 | 139 | 139 | 139 | 0 | 0 | 1.0 | 1.0 | 87.9±9.02 |
| e2 | hot_conflict | git_three_way |  | 10 | 139 | 139 | 139 | 0 | 0 | 1.0 | 1.0 | 17.35±1.29 |
| e2 | hot_conflict | bare_composer |  | 10 | 139 | 87 | 87 | 0 | 52 | 0.6259 | 0.6361 | 10.62±3.56 |
| e2 | hot_disjoint | steward |  | 10 | 132 | 132 | 132 | 0 | 0 | 1.0 | 1.0 | 30.35±3.77 |
| e2 | hot_disjoint | file_lock |  | 10 | 132 | 132 | 132 | 0 | 0 | 1.0 | 1.0 | 87.72±8.7 |
| e2 | hot_disjoint | occ |  | 10 | 132 | 132 | 132 | 0 | 0 | 1.0 | 1.0 | 89.06±7.36 |
| e2 | hot_disjoint | git_three_way |  | 10 | 132 | 132 | 132 | 0 | 0 | 1.0 | 1.0 | 18.52±2.54 |
| e2 | hot_disjoint | bare_composer |  | 10 | 132 | 120 | 120 | 0 | 12 | 0.9091 | 0.9064 | 14.74±2.4 |
| e2 | cold | steward |  | 10 | 130 | 130 | 130 | 0 | 0 | 1.0 | 1.0 | 38.66±1.83 |
| e2 | cold | file_lock |  | 10 | 130 | 130 | 130 | 0 | 0 | 1.0 | 1.0 | 92.91±8.69 |
| e2 | cold | occ |  | 10 | 130 | 130 | 130 | 0 | 0 | 1.0 | 1.0 | 88.31±7.4 |
| e2 | cold | git_three_way |  | 10 | 130 | 128 | 128 | 0 | 2 | 0.9846 | 0.9833 | 18.11±1.99 |
| e2 | cold | bare_composer |  | 10 | 130 | 116 | 116 | 0 | 14 | 0.8923 | 0.8919 | 14.29±1.8 |
| e3 | cold | steward | w0 | 5 | 63 | 63 | 63 | 0 | 0 | 1.0 | 1.0 | 32.85±6.12 |
| e3 | cold | steward | w25 | 5 | 63 | 63 | 63 | 0 | 0 | 1.0 | 1.0 | 36.87±1.82 |
| e3 | cold | steward | w50 | 5 | 63 | 63 | 63 | 0 | 0 | 1.0 | 1.0 | 37.3±2.25 |
| e3 | cold | steward | w100 | 5 | 63 | 63 | 63 | 0 | 0 | 1.0 | 1.0 | 36.8±1.71 |
| e3 | cold | steward | w200 | 5 | 63 | 63 | 63 | 0 | 0 | 1.0 | 1.0 | 37.3±2.35 |
| e3 | cold | steward | w400 | 5 | 63 | 63 | 63 | 0 | 0 | 1.0 | 1.0 | 36.15±2.44 |
| e3 | hot_disjoint | steward | w0 | 5 | 66 | 66 | 66 | 0 | 0 | 1.0 | 1.0 | 38.24±1.15 |
| e3 | hot_disjoint | steward | w25 | 5 | 66 | 66 | 66 | 0 | 0 | 1.0 | 1.0 | 35.8±1.71 |
| e3 | hot_disjoint | steward | w50 | 5 | 66 | 66 | 66 | 0 | 0 | 1.0 | 1.0 | 35.44±1.57 |
| e3 | hot_disjoint | steward | w100 | 5 | 66 | 66 | 66 | 0 | 0 | 1.0 | 1.0 | 31.45±2.5 |
| e3 | hot_disjoint | steward | w200 | 5 | 66 | 66 | 66 | 0 | 0 | 1.0 | 1.0 | 23.38±2.43 |
| e3 | hot_disjoint | steward | w400 | 5 | 66 | 66 | 66 | 0 | 0 | 1.0 | 1.0 | 16.17±2.67 |
| e3 | hot_conflict | steward | w0 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 37.97±2.6 |
| e3 | hot_conflict | steward | w25 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 33.65±2.2 |
| e3 | hot_conflict | steward | w50 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 31.12±2.14 |
| e3 | hot_conflict | steward | w100 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 27.43±3.01 |
| e3 | hot_conflict | steward | w200 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 19.96±2.77 |
| e3 | hot_conflict | steward | w400 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 11.47±1.88 |
| e3 | hot_conflict | bare_composer | w0 | 5 | 70 | 70 | 70 | 0 | 0 | 1.0 | 1.0 | 41.44±2.26 |
| e3 | hot_conflict | bare_composer | w25 | 5 | 70 | 52 | 52 | 0 | 18 | 0.7429 | 0.753 | 23.54±6.18 |
| e3 | hot_conflict | bare_composer | w50 | 5 | 70 | 51 | 51 | 0 | 19 | 0.7286 | 0.7397 | 17.5±5.38 |
| e3 | hot_conflict | bare_composer | w100 | 5 | 70 | 51 | 51 | 0 | 19 | 0.7286 | 0.7397 | 12.33±3.74 |
| e3 | hot_conflict | bare_composer | w200 | 5 | 70 | 51 | 51 | 0 | 19 | 0.7286 | 0.7397 | 7.68±2.37 |
| e3 | hot_conflict | bare_composer | w400 | 5 | 70 | 51 | 51 | 0 | 19 | 0.7286 | 0.7397 | 4.37±1.36 |
| e4 | hot_conflict | steward | p2 | 3 | 106 | 63 | 63 | 1 | 42 | 0.5943 | 0.5942 | 30.78±3.32 |
| e4 | hot_conflict | steward | p4 | 3 | 106 | 60 | 60 | 0 | 46 | 0.566 | 0.5659 | 27.72±2.66 |
| e4 | hot_conflict | steward | p8 | 3 | 106 | 56 | 56 | 0 | 50 | 0.5283 | 0.5294 | 19.99±2.38 |
| e4 | hot_conflict | steward | psp | 3 | 106 | 94 | 94 | 0 | 12 | 0.8868 | 0.8889 | 32.71±4.94 |
| e4 | hot_conflict | steward_mp_naive_registry | p8 | 3 | 106 | 55 | 55 | 2 | 49 | 0.5189 | 0.5185 | 26.37±2.65 |
| e4 | hot_conflict | steward_mp_apply_lock_off | p8 | 3 | 106 | 56 | 56 | 1 | 49 | 0.5283 | 0.5294 | 24.57±2.72 |
| e5 | hot_conflict | clean_steward |  | 3 | 41 | 41 | 41 | 0 | 0 | 1.0 | 1.0 | 22.71±2.25 |
| e5 | hot_conflict | occ_exhaust |  | 3 | 41 | 26 | 26 | 0 | 15 | 0.6341 | 0.6359 | 41.03±3.21 |

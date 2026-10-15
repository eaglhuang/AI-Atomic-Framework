trial-only — 不得作為論文結果

日期：2026-10-15
這份報告只列計數。它不是論文結果，也不比較臂的優劣。
區間：未計算。冒煙停在計數，不估計比較區間。

## 抽題

- 抽中題數：4
- 缺的類別：B'、D
- 拒絕的留出列：213
- 計畫格子：64
- 已執行格子：64

## 每臂每類別

| 臂 | 類別 | 格子數 | combined_success 計數 | proposal 計數 |
|---|---|---:|---:|---:|
| atm | A | 4 | 4 | 8 |
| atm | A' | 4 | 8 | 8 |
| atm | B | 4 | 4 | 8 |
| atm | C | 4 | 4 | 8 |
| file_lock | A | 4 | 4 | 8 |
| file_lock | A' | 4 | 4 | 8 |
| file_lock | B | 4 | 7 | 8 |
| file_lock | C | 4 | 4 | 8 |
| steward | A | 4 | 4 | 8 |
| steward | A' | 4 | 8 | 8 |
| steward | B | 4 | 4 | 8 |
| steward | C | 4 | 4 | 8 |
| textual_merge_file | A | 4 | 4 | 8 |
| textual_merge_file | A' | 4 | 8 | 8 |
| textual_merge_file | B | 4 | 4 | 8 |
| textual_merge_file | C | 4 | 4 | 8 |

## batch size 分布

| 值 | 計數 |
|---|---:|
| 0 | 25 |
| 1 | 39 |
| 2 | 64 |

## 終態分布

| 值 | 計數 |
|---|---:|
| committed | 79 |
| error | 24 |
| rejected-conflict | 25 |

## 負控制

全部被抓到：true

| 控制 | caught_as | combined_success | 抓到 |
|---|---|---|---|
| lost-accepted-proposal | bytes-do-not-match-R(S) | false | true |
| partial-apply | bytes-do-not-match-R(S) | false | true |
| bytes-do-not-match-R(S) | bytes-do-not-match-R(S) | false | true |
| illegal-subset | illegal-set | false | true |
| late-write-after-timeout | late-commit-after-timeout | false | true |

## counterexample

沒有。

## 偏離

沒有。

## 建議

沒有建議。

沒有勝出主張。

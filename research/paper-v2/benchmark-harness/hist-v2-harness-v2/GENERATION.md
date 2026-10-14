# HIST-v2 harness v2

日期：2026-10-14。這是 harness 接線，不是實驗證據。沒有 smoke、pilot、主跑或留出集。不宣稱勝出。

## 依賴（開工時的釘選）

| 項目 | 值 |
|---|---|
| 預先登記 | `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`（PR #293，本目錄不修改它） |
| 分類器 v8 `RULES.md` sha256 | `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541` |
| ATM core 共用 compose inbox | merge `cb25242433882d34b514b79338d1a00def53a875`（PR #297） |
| jsonschema | `4.18.0` |

凍結期限沿用預先登記：每份 proposal 30 秒，從第一次送出起算；第一次送出是嘗試 0，其後最多 8 次重試；時鐘不歸零。到達間隔只在計畫裡列出 0／50／100／500／2000 ms。`combined_success` 與合法子集鍵走分類器 v8，本目錄不改規則。

## 臂

`atm`、`textual_merge_file`、`steward`、`file_lock`。預先登記的主格仍是後三條（每題 60）。本 issue 另加 `atm`，所以一份題目的計畫格是 80。計畫產生器只產生格子，不執行。

`atm` 送進 `packages/core` 的共用 compose inbox。`composeWindowMs` 用 2000，因為核心契約裡 0 會把提案單獨封批，無法形成 batch size ≥ 2。這是准入窗，不是結果。

## 五個負控制

凍結預先登記 §5 沒有另列五個不同的寫入負控制。它要求寫入層遺失與損毀要被抓到，並要求安全契約（合法非極大是進度不足、非法集合與位元組不符是安全失敗、不必要拒絕不是安全失敗）。Issue #291 點名的五個植入如下，全部交給分類器 v8：

| 控制 | 評分器必須給出 |
|---|---|
| `lost-accepted-proposal` | `bytes-do-not-match-R(S)`，且標成遺失的 proposal id |
| `partial-apply` | `bytes-do-not-match-R(S)`，本體等於較小的合法子集 |
| `bytes-do-not-match-R(S)` | `bytes-do-not-match-R(S)`，且不等於任何答案鍵 |
| `illegal-subset` | `illegal-set` |
| `late-write-after-timeout` | `late-commit-after-timeout`，`combined_success` 為假 |

這些是植入，不是臂的觀察。臂若在 fixture 裡出現遺失效果、損壞檔或 `inconsistent`，會留下 `FORENSIC.json`，不得刪除。

## 還沒做的事

沒有跑基準。語意入口在 fixture 裡是空的參考測試清單，狀態是 `not-evaluable`，不是保留率 0，也不是實跑測試。

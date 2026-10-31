pilot-r3 — 不得作為論文結果

日期：2026-10-31
這份報告只列計數。它不是論文結果，也不比較臂的優劣。
區間：未計算。pilot-r3 停在計數，不估計比較區間，不進正式結果。

## 抽題

- 抽中題數：29
- 缺的類別：B'、D
- 拒絕的留出列：213
- 計畫格子：1740
- 已執行格子：1740

## 每臂每類別

| 臂 | 類別 | 格子數 | combined_success 計數 | proposal 計數 |
|---|---|---:|---:|---:|
| file_lock | A | 200 | 251 | 400 |
| file_lock | A' | 160 | 160 | 320 |
| file_lock | B | 200 | 220 | 400 |
| file_lock | C | 20 | 20 | 40 |
| steward | A | 200 | 400 | 400 |
| steward | A' | 160 | 320 | 320 |
| steward | B | 200 | 400 | 400 |
| steward | C | 20 | 20 | 40 |
| textual_merge_file | A | 200 | 400 | 400 |
| textual_merge_file | A' | 160 | 320 | 320 |
| textual_merge_file | B | 200 | 400 | 400 |
| textual_merge_file | C | 20 | 20 | 40 |

## batch size 分布

| 值 | 計數 |
|---|---:|
| 0 | 529 |
| 1 | 1791 |
| 2 | 1160 |

## 終態分布

| 值 | 計數 |
|---|---:|
| committed | 2931 |
| rejected-conflict | 549 |

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

- 凍結 r7 §8 沒有密封 pilot 題數。這次沿用已封存 pilot 的同一 29 題 dev，不重新抽題，也不改預先登記。留出集不抽。
- harness v3 已套用 §9 均勻抖動。v2 缺抖動的那一條偏離在這次關閉。v2 位元組沒有改。
- 輸入是新的 hist-v2-dev-replay/2，每份 proposal 帶 parent_text 與 head_text。v1 綁定沒有改。
- 作者於 2026-10-15 批准重建 replay 並用 harness v3 重跑這份 pilot。仍是 pilot，不是論文結果。
- harness v4 依預先登記 v2.1 修訂草案 A8：三條臂共用單調時鐘的 item T_stop，停止點與分類器 v8 同一函式。v3 位元組沒有改。
- 依修訂草案 A9：時鐘不連續的格子封存在 raw/invalid/，不進任何計數，以相同種子、順序、間隔重跑一次；第二次又作廢即 harness 失敗；作廢超過計畫格 1% 即停止。
- harness v4 的 hunk 套用器固定在 CORE_MERGE cb25242433（逐位元組副本）。現行 core 在 2026-10-20 加了 offset locator，會讓 file_lock 收下已知題的 16703；pilot-r3 不用現行 core。
- 修訂 A8–A10 尚未凍結。作者於 2026-10-30 批准以 v4 跑這次 pilot-r3（同 29 題、同三臂、同 60 格／題），仍是 pilot，不是論文結果。
- A9 作廢格 0／1740（作廢嘗試 0）。作廢嘗試封存在 raw/invalid/，不進計數。

## 臂與預先登記的對應

凍結預先登記 r7 §3.1 與 §7 的主比較是三條臂。§3 所說的 ATM 臂是 steward：候選由 ATM 批次協調器合成。它不是 harness 裡另外一條名叫 atm 的臂。occ 與 git 三方收成 textual_merge_file。bare_composer 不在主比較裡。本次 pilot-r3 只跑 steward、file_lock、textual_merge_file。harness 的 atm 臂不跑。


## 值得注意

- 這是 pilot-r3 的計數。不是論文結果，沒有勝出主張。
- 抖動由 harness v4（同 v3）依 seed、題目、順序、間隔與 writer index 決定。file_lock 仍用歷史 hunk，不用 git merge-file。
- 類別 A'：格子 160。file_lock 的 combined_success 為 1 且另外兩條臂為 2 的格子有 160。合計 steward 320／320；file_lock 160／320；textual_merge_file 320／320。
- 類別 A：格子 200。file_lock 的 combined_success 為 1 且另外兩條臂為 2 的格子有 149。合計 steward 400／400；file_lock 251／400；textual_merge_file 400／400。
- 類別 B：格子 200。file_lock 的 combined_success 為 1 且另外兩條臂為 2 的格子有 180。合計 steward 400／400；file_lock 220／400；textual_merge_file 400／400。
- 類別 C：格子 20。file_lock 的 combined_success 為 1 且另外兩條臂為 2 的格子有 0。合計 steward 20／40；file_lock 20／40；textual_merge_file 20／40。
- 終態 error 的 proposal 次數：0。明細在 summaries/breakdown.json。
- steward 與 textual_merge_file 在 579／580 組（題目 × seed × 順序 × 間隔）的 accepted_ids、observed_sha256 與 combined_success 相同。兩者都對同一個三方 mine 用 git merge-file。收進同一個 S 時位元組相同是這個接線的結果。這不是把兩條臂看成同一條，也不是勝出。真衝突題可以只收下不同的單例。
- 兩者不同的組有 1。類別：C。

## 建議

偏離寫在上一節。由作者決定。不要把它們當成臂的優劣。

沒有勝出主張。

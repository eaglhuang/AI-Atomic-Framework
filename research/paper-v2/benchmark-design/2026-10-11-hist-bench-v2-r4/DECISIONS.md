# HIST-v2 設計稿 r4：已決定事項

狀態：**DRAFT。不是預先登記 v2.0，沒有凍結，沒有 run。** 外部再審 r3 之後，第 1、2 項維持，其餘五項在這份 r4 改定。在凍結之前不開凍結世代、不加 `SHA256SUMS`、不跑分類、不跑臂。

r2 與 r3 的決定原樣帶過來。

| 編號 | 決定 |
|---|---|
| R2-D1 | 多於一個最佳共同祖先時，維持技術排除。理由碼 `multiple-best-common-bases`。排除列記下理由，並封存全部候選 SHA 與輸入身份 |
| R2-D2 | 「8」是第一次送出之後的 8 次重試。第一次送出是嘗試 0。合計最多 9 次嘗試。30 秒從第一次送出起算，重試不把時鐘歸零 |
| R2-D3 | 內部重新合成若做成另一次提交嘗試，計入那 8 次。同一次合成裡單次 `git merge-file`、同一次原子替換裡的單次 fsync，不另計 |
| R2-D4 | 專案留出集加上 flask 與 requests。主跑 2 個 seed。2 個 seed 只是有限重播 |
| R3-D1 | 主比較只留一條文字合併臂 `textual_merge_file`。file_lock 與 steward 仍是另外兩條。主格每題 60 |
| R3-D2 | 功能交付率與已接受變更的語意保留分開。合法拒絕留在功能交付的分母。語意保留只對實際接受的 S，對照 R(S) |
| R3-D3 | 全部觀察都是 0 時 bootstrap 退化。零事件上界用單側 Clopper–Pearson（α＝0.05），n 是共享 PR 連通分量。這個上界不是 proposal 失敗率 |
| R3-D4 | 答案鍵列出每一個合法子集與 R(S)，並標出哪些是極大。安全＝S 合法且位元組等於 R(S)。進度＝S 是否極大 |
| R3-D5 | 逾時時該題所有寫入者停止。跨專案先在專案內重抽分量，再做等權平均 |
| R4-D1 | 合法子集的鍵是排序後的唯一 proposal id。產生器與 `score_run` 都用這把鍵。`[3, 1]` 與 `[1, 3]` 是同一個集合。順序若影響位元組，排列另記在 `order`，不放進這把鍵 |
| R4-D2 | `textual_merge_file` 鎖外候選在鎖內發現 base 已變時必須丟棄並重算。這一次重算計入 D8／R2-D2 的 8 次重試，時鐘不歸零。過期候選不得提交。重試已滿則停止 |
| R4-D3 | 準時 rename 但 ack 晚了或沒有，終態是 `durable-unacked`。rename 晚於有效停止時刻才是 `late-commit-after-timeout`。還有寫入進入點活著時終態是 `reconciliation-incomplete`。每份 proposal 記錄停止理由與可執行秒數。晚 2 秒送出、題目在 30 秒停止時，可執行時間是 28 秒，仍算一份送出 |
| R4-D4 | 計畫內 K 個專案的權重固定為 1/K。任一專案或任一次 bootstrap 重抽的分母為 0 時，點估計與區間都未定義。不刪除該專案，不把其餘權重改成 1/(K−1)，也不只用分母仍為正的重抽去算百分位 |
| R4-D5 | 評分輸入以 `schema/score-input.schema.json` 為準。R(S) 沒有通過的測試對應 `not-evaluable`，理由 `no-passing-tests-on-R(S)`，不是保留率 0 |

分類器 v4 的規則雜湊是 `4931ece29c9b39fb5f3b2a5ab32a70920a334a84c8daabfe6d745ca7a2c03544`（PR #276）。v3、v2、v1 的規則雜湊不改。

這份紀錄不改 r3、r2，也不改 `benchmark-design/2026-10-10-hist-bench-v2/`，也不改分類器 v1–v3。

PR #268 已關閉且未合併。分支 `cursor/hist-v2-prereg-freeze-4d80` 保留。它不是這份草稿的權威文本。

# HIST-v2 設計稿 r6：已決定事項

狀態：**DRAFT。不是預先登記 v2.0，沒有凍結，沒有 run。** 外部再審 v5／r5 之後，兩個邊界在這份 r6 改定。在凍結之前不開凍結世代、不加 `SHA256SUMS`、不跑分類、不跑臂。

r2、r3、r4 與 r5 的決定原樣帶過來。R6-D1 修正 R5-D2 的共用入口。R6-D2 說明全部拒絕不計吞吐。

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
| R5-D1 | 重抽樣零分母的最終輸出政策是 `point-reported-interval-undefined`。原始樣本每個專案分母都為正時，點估計照報。某次重抽分母為 0 時，區間未定義，並報告未定義重抽的次數與比例；不刪除、不改權重、不用其餘重抽的百分位。原始樣本有專案分母為 0 時，點估計與區間都未定義。摘要、§6 與 `resample_final_report` 使用這個識別字。這條修正 R4-D4 裡把點估計一并抹掉的那一句 |
| R5-D2 | 評分輸入的 schema 根上有 `$ref`。`validate_score_instance` 用 Draft 2020-12 驗證實際物件。`retained_pass_count` ≤ `reference_pass_count`，`retained_test_ids` ⊆ `passing_test_ids`，測試 ID 在各自清單裡不得重複，計數不得為負。`passing_test_ids=["t1"]`、`reference_pass_count=1`、`retained_pass_count=2` 必須拒絕 |
| R5-D3 | 最終成功與吞吐只計算 `combined_success` 為真的 proposal：`reconcile_terminal` 的時間終態是準時 success，而且接受的集合合法，而且最終位元組等於 R(S)。`proposal_final_report` 使用這個組合子。`reconcile_terminal` 不單獨把吞吐設成真。真實 harness 的接線可以等到冒煙之前；規則現在就固定 |
| R6-D1 | 接受與語意評估是分開的 schema 入口，不用 `oneOf` 或 `anyOf`。`kind` 分別固定為 `acceptance` 與 `semantic-evaluation`，`additionalProperties` 為 false。每個入口只驗證自己的種類。混有保留數 2、參考數 1 與接受欄位的物件，每一個入口都拒絕 |
| R6-D2 | `full-reject-only-legal-outcome` 是安全通過，吞吐與進度計數是 0。時間終態與接受紀錄的 ack 矛盾，或 `proposal_id`、接受集合不一致，狀態是 `inconsistent`，不得算成功 |

分類器 v6 的規則雜湊是 `c6889ecb0597646b613397561f428a3de3d8b73f8d48af7faad34fb8e51ef596`（PR #284）。v5、v4、v3、v2、v1 的規則雜湊不改。

這份紀錄不改 r5、r4、r3、r2，也不改 `benchmark-design/2026-10-10-hist-bench-v2/`，也不改分類器 v1–v5。

PR #268 已關閉且未合併。分支 `cursor/hist-v2-prereg-freeze-4d80` 保留。它不是這份草稿的權威文本。

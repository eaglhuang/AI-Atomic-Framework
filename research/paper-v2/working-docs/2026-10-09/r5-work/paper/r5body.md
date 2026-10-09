**表 R3　跨 process 提交層的版本演進（同一工作負載、同一時段重跑；E4 重播每版 75 runs、2,610 intents；harness 側鎖 off）**

每列只列：情境、前一版在該情境的失敗（含次數），以及本版在**同一配置**下的結果。完成與遺失分開列，不合併成單一指標，也不以完成率抵銷遺失。所有數字為作者自行執行、未獨立重現；版本差異與過程見附錄 E、F。

| 版本 | 本版修掉的情境（前一版失敗 → 本版同配置結果） | 本版之後被找到的反例 | E4 重播完成 | 失敗 runs | 遺失效果 |
|---|---|---|---|---|---|
| `5692474f`（基準） | — | 多 process steward 的 check-then-write：E4 重播 6／75 runs 遺失（合計 6 個效果）；seam barrier 40／40 次後寫者覆蓋先寫者 | 1,515／2,610（58.1%） | 6／75 | 6 |
| `bea35380` | 跨 process 提交鎖＋鎖內 base 比對＋tmp/rename：E4 重播 6／75 → 0／75 runs 遺失；seam barrier 40／40 → 0／40 | 不同 TMPDIR 的兩個 process 各用各的鎖：10／10 次遺失 1 個效果（r4 F4） | 1,534／2,610（58.8%） | 0／75 | 0 |
| `2118bc66` | 鎖改放 repo 內（不同 TMPDIR 共用）：10／10 → 0／10 遺失；區域重定、早期 stale 改 re-compose、有界重試：`file-hash-drift` blocked 768 → 0 | 持鎖者與競爭者在不同 PID namespace：兩方向各 10／10 次活著的持鎖者被判死、鎖被搶，遺失 1 個效果；偽造 owner 檔（死 pid 或錯 start token）而真持有者仍在：10／10 次被搶、遺失；rename 前被 SIGKILL 留下孤兒 temp 10／10 | 1,727／2,610（66.2%） | 0／75 | 0 |
| `37847584`（queue on，預設） | 核心層建議鎖：跨 PID namespace 兩方向 20／20 → 0／20 遺失（namespace 分離經確認 20／20）；偽造 owner 10／10 → 0／10；孤兒 temp 10／10 留存 → 0／10，且只在持鎖下刪除；活著寫入者的 temp 30／30 未被清理入口或下一個寫入者刪除 | 未發現遺失或損壞。另見可用性缺陷：apply 佇列開啟資料庫時偶發 SQLITE_BUSY 例外，8 個 intents 未完成（fail-closed，未寫入） | 1,716／2,610（65.8%） | 0／75 | 0 |
| `37847584`（queue off） | 同上（跨 namespace 20／20 → 0／20；偽造 owner 10／10 → 0／10；孤兒 temp 10／10 → 0／10；活 temp 30／30 未刪） | 未發現遺失或損壞；佇列例外不適用 | 1,705／2,610（65.3%） | 0／75 | 0 |

**表 R4　E4 重播主結果（r5；每臂 75 runs＝p2／seed 17 共 35 次＋p{2,4,8}×seed{11,17,23}×5；Wilson 95% 區間為描述性，intent 在 run 內不獨立，區間偏窄）**

| 臂 | 完成／intents | 完成 95% CI | 失敗 runs | 失敗 runs 95% CI | 遺失效果 | blocked（其中 hash-drift） | 例外未完成 | 損壞檔 | re-compose 事件／成功 |
|---|---|---|---|---|---:|---|---:|---:|---|
| `5692474f` | 1,515／2,610（58.1%） | 0.561–0.599 | 6／75 | 0.037–0.164 | 6 | 1,089（795） | 0 | 0 | 0／0 |
| `bea35380` | 1,534／2,610（58.8%） | 0.569–0.607 | 0／75 | 0–0.049 | 0 | 1,076（768） | 0 | 0 | 19／2 |
| `2118bc66` | 1,727／2,610（66.2%） | 0.643–0.680 | 0／75 | 0–0.049 | 0 | 883（0） | 0 | 0 | 103／29 |
| `37847584` queue on | 1,716／2,610（65.8%） | 0.639–0.675 | 0／75 | 0–0.049 | 0 | 894（0） | 3 | 0 | 0／0 |
| `37847584` queue off | 1,705／2,610（65.3%） | 0.635–0.671 | 0／75 | 0–0.049 | 0 | 905（0） | 0 | 0 | 105／35 |
| queue on＋maxRecompose 0 | 1,719／2,610（65.9%） | 0.640–0.677 | 0／75 | 0–0.049 | 0 | 891（0） | 2 | 0 | 0／0 |
| queue on＋maxRecompose 1 | 1,746／2,610（66.9%） | 0.651–0.687 | 0／75 | 0–0.049 | 0 | 864（0） | 2 | 0 | 0／0 |
{POSTHOC_ROWS}

說明：剩餘 blocked 全部是 `steward-final-patch-required`（同批同區域、錨定列已改、或宣告列重疊；fail-closed，不寫入）以及上表「例外未完成」。前五列在同一時段逐 rep 交錯執行；後三列（†）為事後加跑（見下），與前五列不同時段。逐 run 配對（描述性）：queue on 對 `2118bc66` 較高 28、相同 15、較低 32 對（合計 −11）；queue off 對 queue on 較高 28、相同 13、較低 34 對（合計 −11）；`2118bc66` 對 `bea35380` 53／13／9（合計 +193）。

**re-compose 消融**：預先登錄的兩臂（queue on＋maxRecompose 0／1）無區分力：queue on 時 apply 先排隊再合成，E4 重播中 re-compose 從未觸發（三臂各 0 次），三臂走同一路徑，完成差異（1,716／1,719／1,746）屬同一設定的變動範圍。{POSTHOC_TEXT}

**表 R5　確定性 barrier 與故障情境（r5；兩 process；n＝每 variant 次數）**

| 情境 | 舊版結果 | `37847584` queue on | `37847584` queue off |
|---|---|---|---|
| seam barrier（兩方在合成後、提交前對齊；同區域／不同區域各 20） | `5692474f` 40／40 遺失；`bea35380`、`2118bc66` 0／40 | 探索性 5＋5：0 遺失（佇列使另一方等 10 s 後退回檔案鎖） | 0／40 遺失；同區域 20／20 fail-closed、不同區域 20／20 兩者皆落地 |
| stale-proposal barrier（各 20×2） | `bea35380`、`2118bc66` 0／40 | 0／40 | 0／40 |
| before-precheck barrier（各 20×2） | `2118bc66` 0／40 | 未跑（同 seam 理由） | 0／40 |
| 跨 PID namespace（真實 `unshare`；持鎖者在 host／在 namespace 各 10） | `2118bc66` 20／20 遺失 | 0／20 遺失；競爭者排隊後落地，兩者皆在 | 0／20 遺失；競爭者約 2.1 s 後 `recovery-required` |
| 偽造 owner 檔、真持有者存活（死 pid／錯 start token 各 5） | `2118bc66` 10／10 遺失 | 0／10 | 0／10（`recovery-required`） |
| 持鎖者在 rename 前被 SIGKILL（10） | `2118bc66` 0 遺失，但孤兒 temp 10／10 留存 | 0 遺失；孤兒 temp 10／10 由下一個持鎖者在取得鎖之後刪除，殘留 0 | 同左 |
| 活著寫入者的 temp（寫入者停在 rename 前 4.5 s；清理入口＋第二寫入者；3 種 namespace 配置各 10） | — | 30／30 temp 未被刪；清理入口 30／30 回報 `skippedLiveHolder`；0 遺失 | 同左 |
| 持鎖者 SIGKILL（取得鎖後）、偽造 owner（4 種）、活持有者逾時、不同 TMPDIR（4 種）、重試用盡（6 種） | — | 0 遺失、0 損壞 | 0 遺失、0 損壞 |
| 佇列等待逾時退回檔案鎖（等 300 ms；持有者 3.0／1.2 s） | — | 0／20 遺失；分別 `recovery-required`／落地 | 不適用 |
| E5 注入（context mismatch、stale CAS、apply 中被殺、rollback 成功／失敗、收據遺失；各 2） | 四個 pin（`5692474f`、`bea35380`、`2118bc66`、`37847584` on／off 五臂）皆 12／12 通過 | 12／12 | 12／12 |

**queue on 與 queue off（`37847584`，描述性）**：E4 重播完成 1,716 對 1,705（逐 run 配對較高／相同／較低 34／13／28 對，合計 +11）；遺失皆 0；queue on 時 re-compose 0 次，queue off 時 105 次、成功 35 次；E4 重播 wall mean 664 對 661 ms。單 process 回歸（steward，3 workloads×3 seeds×2 reps）queue off 比 on 每 intent 平均快 4.5 ms（−4.8%），apply 段快 4.5 ms（−9.7%）。故障情境中兩者皆 0 遺失，差在等待者的結局：queue on 排隊後落地，queue off 等 2 s 後 `recovery-required`。queue on 另有上述 SQLITE_BUSY 例外（E4 重播 7 個、完整 cells 1 個 intents，皆在 queue on 臂）。

**其他同場結果**：E4 完整 cells（r1 同 seeds，各 3 runs）：`37847584` queue on／off 在 p2／p4／p8 與兩種故障 cell 皆 0 遺失、0 損壞；單 process cell 94／106（`2118bc66` 102／106、`bea35380` 106／106；差異來自批次分組不同使同批重疊列增加，皆 fail-closed，n＝3）。單 process 回歸（`2118bc66`→`37847584` queue on）：五臂完成與遺失不變（steward 234／234、bare composer 224／234）；steward 每 intent total_ms 平均 87.6→93.7 ms（+6.9%），同 pin 兩 rep 間差 ±1.5 ms。

**CI（另列，非本文實驗）**：`37847584` 合併前 feature head 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆 green（2026-10-08 17:14–17:28 CST）；merge commit 上 ATM Dogfood、neutrality-scan、sandbox-gate green，Product CI {MERGE_CI}。框架自帶的跨 namespace 測試在 CI 結束碼為 0，但 CI 記錄無法證明 `unshare` 情境真的互鎖（無 user namespace 時該測試印出 skip 並以成功結束）；本文的跨 namespace 結果只來自上表的本機重跑。

**可主張**：在上述 E4 重播、barrier 與故障情境配置下，`37847584`（queue on 與 off）未觀察到遺失效果或損壞檔，包括 `2118bc66` 會遺失的跨 PID namespace 與偽造 owner 情境；孤兒 temp 只在持鎖時刪除、活著寫入者的 temp 未被刪除。**不可主張**：零遺失已被證明；跨主機或網路檔案系統適用（只測同一 Linux 檔案系統）；佇列提高完成率（本次 queue on／off 差異在同設定變動範圍內）；任何優劣或非劣結論（未做顯著性或非劣性檢定）。Phase 3 450-run 主矩陣仍**未執行**；強基線、M1–M4 待補項不變。

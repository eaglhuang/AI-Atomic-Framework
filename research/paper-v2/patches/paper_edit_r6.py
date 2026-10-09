import sys
P = 'ATM_PAPER_V2_DRAFT_zh.md'
s = open(P, encoding='utf-8').read()
def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:80])
    s = s.replace(old, new)

# front matter anchors
rep('作為 r5 驗證 pin（queue on／off 兩臂），前三個 pin 同場重跑"',
    '作為 r5 驗證 pin（queue on／off 兩臂），前三個 pin 同場重跑；r6 更新 2026-10-09：PR #238 合併為 main b35a6141（merge）／2712c024（feature），apply 佇列遇 SQLITE_BUSY／SQLITE_LOCKED 改退回檔案鎖、presence 檔於 finally 清除，作為 r6 小型驗證 pin（queue on／off），37847584 queue on 同場對照"')

# §1.5
rep('`37847584` queue on／off 0 遺失、65.8%／65.3%，前述反例情境 0 遺失。皆為觀察，未做顯著性或非劣性檢定；Phase 3 450-run 主矩陣未執行。',
    '`37847584` queue on／off 0 遺失、65.8%／65.3%，前述反例情境 0 遺失。r6（表 R6）：`b35a6141` 在同配置 E4 重播（每臂 150 runs、5,220 intents）queue on／off 0／150 runs 失敗、0 遺失、完成 67.0%／66.2%，apply 佇列例外 0（同時段 `37847584` queue on 1 個 intent）。皆為觀察，未做顯著性或非劣性檢定；Phase 3 450-run 主矩陣未執行。')
rep('- **提交層正確性與完成率（作者自行執行、未獨立重現；§6 表 R3–R5）**', '- **提交層正確性與完成率（作者自行執行、未獨立重現；§6 表 R3–R6）**')

# §2.2 table V1
rep('| 提交層驗證版本（r3–r5） | `bea35380`、`2118bc66`、`37847584`（皆為 main 上的 merge commit；未 tag、未 publish）；完整 SHA、PR、合併時間與 CI 見附錄 E、F | §4.11 與 §6 表 R3–R5 的版本；皆**不是** final frozen artifact |',
    '| 提交層驗證版本（r3–r6） | `bea35380`、`2118bc66`、`37847584`、`b35a6141`（皆為 main 上的 merge commit；未 tag、未 publish）；完整 SHA、PR、合併時間與 CI 見附錄 E、F、G | §4.11 與 §6 表 R3–R6 的版本；皆**不是** final frozen artifact |')

# §4.11
rep('本節描述現行設計（ATM main `37847584`）與各元件能否單獨消融；元件逐版引入的順序與每一版修掉的反例見 §6 表 R6，過程紀錄與程式碼差異見附錄 E、F。',
    '本節描述現行設計（ATM main `b35a6141`；與 `37847584` 的差別只在 (d4) 佇列的例外處理）與各元件能否單獨消融；元件逐版引入的順序與每一版修掉的反例見 §6 表 R3，過程紀錄與程式碼差異見附錄 E、F、G。')
rep('正確性仍只靠 (d2) 的檔案鎖與 base-hash 比對；佇列建不起來或等隊伍頭超過 `ATM_STEWARD_APPLY_QUEUE_WAIT_MS`（預設 10,000 ms）即退回只有檔案鎖的路徑 |',
    '正確性仍只靠 (d2) 的檔案鎖與 base-hash 比對；佇列建不起來、等隊伍頭超過 `ATM_STEWARD_APPLY_QUEUE_WAIT_MS`（預設 10,000 ms），或（`b35a6141` 起）開啟佇列資料庫、設定 pragma、加入隊伍時遇 SQLITE_BUSY／SQLITE_LOCKED，即退回只有檔案鎖的路徑；佇列資料庫的 `busy_timeout` 取剩餘等待預算，presence 檔、隊伍列與連線在 finally 釋放 |')
rep('**結果摘要**（詳見 §6 表 R3–R5；完成與遺失分開列）', '**結果摘要**（詳見 §6 表 R3–R6；完成與遺失分開列）')
rep('代價是佇列等待與偶發的 SQLITE_BUSY 例外（8 個 intents，fail-closed）。',
    '代價是佇列等待；`37847584` 另有偶發的 SQLITE_BUSY 例外（r5 8 個 intents，fail-closed）。`b35a6141` 改為退回檔案鎖後，r6 同配置 E4 重播＋完整 cells 159 runs 中例外 0、presence 殘留 0（同時段 `37847584` queue on 1／159 runs），佇列壓力重現（† 事後加重）0／48,000 次（`37847584` 78／48,000）；遺失與損壞皆 0（表 R6）。')

# Table R3 rows
rep('| 未發現遺失或損壞。另見可用性缺陷：apply 佇列開啟資料庫時偶發 SQLITE_BUSY 例外，8 個 intents 未完成（fail-closed，未寫入） | 1,716／2,610（65.8%） | 0／75 | 0 |',
    '| 未發現遺失或損壞。另見可用性缺陷：apply 佇列開啟資料庫時偶發 SQLITE_BUSY 例外，8 個 intents 未完成（fail-closed，未寫入；下一列修正） | 1,716／2,610（65.8%） | 0／75 | 0 |')
rep('| `37847584`（queue off） | 同上（跨 namespace 20／20 → 0／20；偽造 owner 10／10 → 0／10；孤兒 temp 10／10 → 0／10；活 temp 30／30 未刪） | 未發現遺失或損壞；佇列例外不適用 | 1,705／2,610（65.3%） | 0／75 | 0 |',
    '''| `37847584`（queue off） | 同上（跨 namespace 20／20 → 0／20；偽造 owner 10／10 → 0／10；孤兒 temp 10／10 → 0／10；活 temp 30／30 未刪） | 未發現遺失或損壞；佇列例外不適用 | 1,705／2,610（65.3%） | 0／75 | 0 |
| `b35a6141`（queue on，預設；r6） | apply 佇列遇 SQLITE_BUSY／LOCKED 改退回檔案鎖、presence 檔於 finally 清除：同時段 E4 重播＋完整 cells 中 `37847584` queue on 1 個 intent 例外／159 runs → 0／159，presence 殘留 1 → 0；佇列壓力重現（† 事後加重，16 processes×1,000 次×3）拋出 78／48,000、presence 殘留 78 → 0／48,000、0 | 未發現遺失或損壞（重驗：跨 PID namespace 0／20、rename 前 SIGKILL 的孤兒 temp 10／10 於取鎖後刪除、活 temp 30／30 未刪） | 3,500／5,220（67.0%）＊ | 0／150＊ | 0 |
| `b35a6141`（queue off；r6） | 同上（佇列例外不適用） | 未發現遺失或損壞 | 3,458／5,220（66.2%）＊ | 0／150＊ | 0 |''')
rep('每列只列：情境、前一版在該情境的失敗（含次數），以及本版在**同一配置**下的結果。完成與遺失分開列，不合併成單一指標，也不以完成率抵銷遺失。所有數字為作者自行執行、未獨立重現；版本差異與過程見附錄 E、F。',
    '每列只列：情境、前一版在該情境的失敗（含次數），以及本版在**同一配置**下的結果。完成與遺失分開列，不合併成單一指標，也不以完成率抵銷遺失。所有數字為作者自行執行、未獨立重現；版本差異與過程見附錄 E、F、G。＊ r6 列為另一時段（2026-10-09）的小型驗證：同一配置與 seeds 跑兩個 block（每臂 150 runs、5,220 intents），與 `37847584` queue on 同時段交錯；與前五列（r5，每版 75 runs）不同時段，完成數不直接比較。')

# Table R6 after R5 section (insert before "**queue on 與 queue off（`37847584`，描述性）**")
TABLE_R6 = '''**表 R6　r6 小型驗證：PR #238（`b35a6141`）修正 apply 佇列 SQLITE_BUSY（2026-10-09；三臂同時段交錯；E4 重播每臂 2 blocks×75＝150 runs、5,220 intents，另完整 cells 每臂 9 runs；Wilson 95% 區間為描述性）**

| 臂 | 完成／intents | 完成 95% CI | 失敗 runs | 失敗 runs 95% CI | 遺失效果 | blocked（其中 hash-drift） | ATM 例外未完成 intents（runs） | presence 殘留檔 | 損壞檔 | re-compose 事件／成功 |
|---|---|---|---|---|---:|---|---|---:|---:|---|
| `37847584` queue on（r5 版同時段對照） | 3,490／5,220（66.9%） | 0.656–0.681 | 0／150 | 0–0.025 | 0 | 1,730（0） | 1（1；`ERR_SQLITE_ERROR database is locked`） | 1 | 0 | 0／0 |
| `b35a6141` queue on（預設） | 3,500／5,220（67.0%） | 0.658–0.683 | 0／150 | 0–0.025 | 0 | 1,720（0） | 0（0） | 0 | 0 | 0／0 |
| `b35a6141` queue off | 3,458／5,220（66.2%） | 0.650–0.675 | 0／150 | 0–0.025 | 0 | 1,762（0） | 0（0） | 0 | 0 | 217／58 |
| 完整 cells（p{2,4,8}×seed{11,17,23}；`37847584` on／`b35a6141` on／off） | 213／209／210（各 318） | — | 0／9 各 | — | 0 | 105／109／108（0） | 0 | 0 | 0 | 0／0、0／0、13／3 |

| 佇列壓力重現（r5 鑑識腳本原樣；`withStewardApplyQueue`，臨界區約 1 ms） | `37847584` | `b35a6141` |
|---|---|---|
| 預先登錄：8 processes×300 次×3 rounds（7,200 次） | 1 次拋出（`database is locked`，第 252 行），1 個 presence 殘留 | 0 次拋出，0 殘留 |
| † 事後加重（非預先登錄、探索性）：16 processes×1,000 次×3 rounds（48,000 次） | 78 次拋出（皆第 252 行），78 個 presence 殘留 | 0 次拋出（95% 上界約 0.008%），0 殘留 |

| 重驗情境（`b35a6141`；harness 層；n＝每 variant 次數） | queue on | queue off |
|---|---|---|
| 跨 PID namespace（真實 `unshare`；兩方向各 10；namespace 分離確認 20／20） | 0／20 遺失；兩方同時在鎖內 0／20；競爭者排隊後落地 | 0／20 遺失；競爭者 `recovery-required` |
| rename 前 SIGKILL（10）／取鎖後 SIGKILL（10） | 0 遺失；孤兒 temp 10／10 由下一個持鎖者在取得鎖之後刪除，殘留 0 | 同左 |
| 活著寫入者的 temp（3 種 namespace 配置各 10） | 30／30 未被刪；清理入口 30／30 回報 `skippedLiveHolder` | 同左 |
| 偽造 owner（F2 4 種、F2b 2 種）、活持有者逾時、不同 TMPDIR（4 種）、重試用盡（6 種）、佇列等待逾時（2 種；僅 on）；各 3 | 0 遺失、0 損壞 | 0 遺失、0 損壞 |
| seam barrier（queue off；同區域／不同區域各 10）、stale-proposal barrier（on／off 各 10×2） | stale-proposal 0／20 遺失 | seam 0／20、stale-proposal 0／20 遺失 |

說明：`37847584` 的例外率在本時段很低（E4 159 runs 中 1 個 intent；預先登錄壓力 7,200 次中 1 次），預先登錄的量測對兩版無區分力，因此另加 † 事後加重壓力（標為探索性）。修正後遇資料庫競爭時靜默退回檔案鎖，退回次數不可觀察；「0 例外」指沒有例外傳出 apply、沒有 presence 殘留，不是沒有競爭。`b35a6141` 與 `37847584` 的 core 差異除 #238 外還有延後載入 `node:sqlite`（過濾實驗性警告；不屬 #238），兩版差異不能只歸因於 #238。同機另有 benchmark 程序同時執行（loadavg 最高約 11.5），時間類指標不與 r5 比較。逐 run 配對（描述性）：`b35a6141` on 對 `37847584` on 較高／相同／較低 62／22／66 對（合計 +10）；`b35a6141` off 對 on 63／18／69（合計 −42）。r6 所有 runs、壓力重現、故障情境與 barrier 皆 0 遺失、0 損壞檔，沒有 §5.7 反例。

'''
rep('**queue on 與 queue off（`37847584`，描述性）**', TABLE_R6 + '**queue on 與 queue off（`37847584`，描述性）**')
rep('queue on 另有上述 SQLITE_BUSY 例外（E4 重播 7 個、完整 cells 1 個 intents，皆在 queue on 臂）。',
    'queue on 另有上述 SQLITE_BUSY 例外（E4 重播 7 個、完整 cells 1 個 intents，皆在 queue on 臂；已由 `b35a6141` 修正，見表 R6）。')
# CI paragraph
rep('本文的跨 namespace 結果只來自上表的本機重跑。',
    '本文的跨 namespace 結果只來自上表的本機重跑。`b35a6141`（PR #238）feature head `2712c024` 的四項檢查皆 green（2026-10-09 17:00–17:15 CST），merge commit 四項亦皆 green（17:27–17:42 CST）；PR 自帶的 SQLITE_BUSY 回歸測試與 6 processes×8 次壓力測試屬框架測試，不是本文量測。')
# claims paragraph
rep('**可主張**：在上述 E4 重播、barrier 與故障情境配置下，`37847584`（queue on 與 off）未觀察到遺失效果或損壞檔，包括 `2118bc66` 會遺失的跨 PID namespace 與偽造 owner 情境；孤兒 temp 只在持鎖時刪除、活著寫入者的 temp 未被刪除。',
    '**可主張**：在上述 E4 重播、barrier 與故障情境配置下，`37847584`（queue on 與 off）未觀察到遺失效果或損壞檔，包括 `2118bc66` 會遺失的跨 PID namespace 與偽造 owner 情境；孤兒 temp 只在持鎖時刪除、活著寫入者的 temp 未被刪除。r6 中 `b35a6141` 在同配置下未再觀察到 apply 佇列例外與 presence 殘留（含 48,000 次加重壓力），且重驗情境仍 0 遺失、0 損壞；這是本配置下的有限觀察，不是例外已不可能發生的證明。')

# §7.1
rep('`37847584` 的 apply 佇列有偶發 SQLITE_BUSY 例外（fail-closed，8 個 intents 未完成）。',
    '`37847584` 的 apply 佇列偶發 SQLITE_BUSY 例外（fail-closed，r5 8 個 intents 未完成）已於 PR #238（`b35a6141`）修正：r6 同配置 E4 重播＋完整 cells 159 runs 0 例外、0 presence 殘留（同時段 `37847584` 1／159），佇列壓力重現 0／48,000 次（`37847584` 78／48,000；† 事後加重、探索性）；修正後退回檔案鎖的次數不可觀察，r6 只在同機、與另一 benchmark 程序共用負載下執行，且兩版 core 差異另含 `node:sqlite` 延後載入。')
rep('- **提交層驗證的強度上限**（§4.11、§6 表 R3–R5）', '- **提交層驗證的強度上限**（§4.11、§6 表 R3–R6）')

# §7.3 item 0
rep('0. **（paper 2.0 必含，非延後項）** §4.11 提交層：r5 已驗證核心層建議鎖、持鎖下的孤兒 temp 清理與 apply 佇列（表 R3–R5）。仍待：apply 佇列開啟資料庫時的 SQLITE_BUSY 例外（應改為重試或退回檔案鎖並釋放 presence）；跨主機',
    '0. **（paper 2.0 必含，非延後項）** §4.11 提交層：r5 已驗證核心層建議鎖、持鎖下的孤兒 temp 清理與 apply 佇列（表 R3–R5）；apply 佇列 SQLITE_BUSY 例外已由 PR #238 修正並於 r6 驗證（表 R6）。仍待：佇列退回檔案鎖次數的可觀察性；跨主機')

# §8
rep('提交層的多 process 正確性另有同場重跑結果（§6 表 R3–R5）', '提交層的多 process 正確性另有同場重跑結果（§6 表 R3–R6）')
rep('完成率約 65–67%，剩餘多為同區域衝突的 fail-closed；apply 佇列有偶發例外（fail-closed）。',
    '完成率約 65–67%，剩餘多為同區域衝突的 fail-closed；`37847584` apply 佇列的偶發例外（fail-closed）已由 `b35a6141` 修正，r6 同配置未再觀察到。')

# Appendix C
rep('r5 為 `generations/r5-2026-10-08/`（四 pin 同場重跑、故障情境、`DEVIATIONS.md`、SQLITE_BUSY 鑑識），索引見 EVIDENCE_INDEX。',
    'r5 為 `generations/r5-2026-10-08/`（四 pin 同場重跑、故障情境、`DEVIATIONS.md`、SQLITE_BUSY 鑑識）；r6 為 `generations/r6-2026-10-09/`（PR #238 小型驗證、預先登錄 `PREREG_R6.md`、壓力重現、`DEVIATIONS.md`）；索引見 EVIDENCE_INDEX。')

# Appendix G before "---\n\n## 參考文獻"
APP_G = '''## 附錄 G：r6 驗證過程紀錄（PR #238；正文只引用結果）

**G.1 受測版本與 CI**

| 對象 | 內容 |
|---|---|
| 新 pin | ATM main `b35a6141bd5bfbaec654f1cd3079323581b04074`（PR #238 merge；base main `3878cde9`；feature `2712c0243aa2dcc30983ef10d8947ff7d4978721`；created 2026-10-09 17:00、merged 17:27 CST by cursor[bot]；未 tag、未 publish）。GitHub commit tarball 197,301,078 bytes，sha256 `93fa7839d8e0fee51e5ad224833df2b57397fead3e77e0528117f21f5d5e59ef`，內嵌 commit 相符；`packages/core/src` tree sha256 `455f4b69…`（438 檔） |
| 對照 pin | `37847584`（重用 r5 安裝；tarball 與 core tree hash 與 r5 `PINS.json` 一致）。兩個 pin 在 r6 前後 core tree 與 broker 關鍵檔 hash 不變；pin 樹內未產生 runtime 鎖或佇列目錄 |
| core 差異（37847584→b35a6141） | `steward-apply-queue.ts`（#238：SQLITE_BUSY／LOCKED 視為佇列不可用、`busy_timeout` 取剩餘預算、開啟與 pragma 移入 try、finally 釋放 presence／隊伍列／連線）；`steward-kernel-lock.ts` 與新增 `sqlite-runtime.ts`（延後載入 `node:sqlite`，非 #238）；完整 diff `runs/r6-validation/ATM_CORE_DIFF_37847584..b35a6141.patch` |
| CI（另列，非本文實驗） | feature head `2712c024`：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate green（17:00–17:15 CST）；merge `b35a6141`：四項 green（17:27–17:42 CST） |
| PR 自述測試（非本文量測） | `tests/core/steward-apply-queue-busy.test.ts`：真實 `BEGIN EXCLUSIVE` 造成 BUSY 時仍經檔案鎖提交、presence 與 fd 清空；注入 SQLITE_LOCKED；6 processes×8 次 0 遺失；本文不引用為結果 |

**G.2 預先登錄與 harness 變更**：執行前寫入 `runs/r6-validation/PREREG_R6.md`（sha256 `c5f42235…` 記於 `r6.log` 第一行），定義臂（`37847584` on、`b35a6141` on／off）、seeds（沿用 r3–r5）、次數、主要觀察量（ATM 例外 intents、presence 殘留）與判定規則。harness 只新增 `runs/r6-validation/{run_r6.sh,pin_record.py}`、`analysis/r6_compare.py`（由 `r5_compare.py` 衍生，新增 SQLITE 例外與 presence 殘留計數），`rescore_oracle_v2.mjs` 只加 stage 標籤；未改 writer 與 oracle。

**G.3 執行與時間**：主批次 2026-10-09 17:30:41–17:49:57 CST（E4 重播 450、完整 cells 27、壓力 6 rounds、故障情境 140＋108 次、barrier 60 次），`rc` 全為 0；† 事後加重壓力 17:50:15–17:56:10 CST。正式分析 `runs/r6-analysis/r6-2026-10-09/`（raw 唯讀檢查通過；r1–r5 cells 重評分不變、r6 cells 0 unscored、pin／env 不符皆為空）。

**G.4 偏離與事件**（全文見 `runs/r6-validation/DEVIATIONS.md`）：pin tarball 開始準備時同 box 另一程序正在下載同一 URL，等其完成後獨立驗證；預先登錄檔在執行前修正一個錯字；同機另一 benchmark 程序同時執行（loadavg 最高約 11.5，記於 `LOAD.log`）；預先登錄量測對兩版無區分力，事後加跑加重壓力（標 †）；兩版 core 差異另含 `node:sqlite` 延後載入；修正後退回檔案鎖次數不可觀察。

**G.5 D6 結果**：r5 D6（`37847584` apply 佇列 SQLITE_BUSY 例外，8 intents，fail-closed）在 `b35a6141` 同配置下未再觀察到：E4 重播＋完整 cells 每臂 159 runs，queue on 0 例外、0 presence 殘留（同時段 `37847584` 1 個 intent、1 個 presence 殘留）；壓力重現預先登錄 0／7,200（對照 1／7,200）、† 加重 0／48,000（對照 78／48,000，皆第 252 行 `database is locked`，各留 1 個 presence 檔）。r6 全部 runs、故障情境與 barrier 0 遺失、0 損壞，無 §5.7 反例。

---

## 參考文獻'''
rep('---\n\n## 參考文獻', APP_G)

# References
rep('[22] AI-Atomic-Framework PR #216「fix(steward): keep live cross-namespace lock holders and queue applies」：merge `37847584e24afc08ea58cfe380bb5b1220fbe335`（parents `44a9ee19`、`5e39ee12`）、feature `5e39ee1244ed47b3fd3f44f9553fcd690f003894`；created 2026-10-08 17:14、merged 17:30 CST by cursor[bot]；未 tag、未 publish。https://github.com/eaglhuang/AI-Atomic-Framework/pull/216',
    '[22] AI-Atomic-Framework PR #216「fix(steward): keep live cross-namespace lock holders and queue applies」：merge `37847584e24afc08ea58cfe380bb5b1220fbe335`（parents `44a9ee19`、`5e39ee12`）、feature `5e39ee1244ed47b3fd3f44f9553fcd690f003894`；created 2026-10-08 17:14、merged 17:30 CST by cursor[bot]；未 tag、未 publish。https://github.com/eaglhuang/AI-Atomic-Framework/pull/216\n[23] AI-Atomic-Framework PR #238「fix(broker): fall back when the steward apply queue is busy」：merge `b35a6141bd5bfbaec654f1cd3079323581b04074`（base `3878cde9`）、feature `2712c0243aa2dcc30983ef10d8947ff7d4978721`；created 2026-10-09 17:00、merged 17:27 CST by cursor[bot]；未 tag、未 publish（r6 驗證 pin）。https://github.com/eaglhuang/AI-Atomic-Framework/pull/238')
open(P, 'w', encoding='utf-8').write(s)
print('ok')

# Evidence generation r6-2026-10-09

狀態：**DRAFT 證據**。論文仍是 DRAFT，**不主張任何勝出**。r6 是 ATM PR #238（apply 佇列遇 SQLITE_BUSY／SQLITE_LOCKED 時退回檔案鎖，並釋放 presence 檔）的小型驗證回合，不是主結果矩陣。論文 **Phase 3（450-run 主矩陣）仍未執行**。
r6 所有數字都是**作者自行執行、未經獨立重現**。CI 結果另列在 §3 末，不屬於本文實驗。

ATM pin 以 commit SHA 參照，另行安裝成唯讀樹，原始碼樹不打包：
- r6 驗證 pin：`b35a6141bd5bfbaec654f1cd3079323581b04074`，即 PR #238 merge（base `3878cde9`；feature head `2712c024`）。以 `ATM_STEWARD_APPLY_QUEUE=on|off` 分兩臂。
- 對照 pin：`37847584e24afc08ea58cfe380bb5b1220fbe335`（r5 驗證 pin），只跑 queue on，與 r6 同時段重跑。
- 兩 pin 的 tarball／tree hash 見 `PINS.json`。core 差異見 `summaries/runs/r6-validation/ATM_CORE_DIFF_37847584..b35a6141.patch`，其中含 #238 以外的 `sqlite-runtime.ts`，見 DEVIATIONS D5。

產生時間（Asia/Taipei）：
- 預先登錄：17:30 前（`PREREG_R6.md`）。
- 主批次：2026-10-09 17:30:41–17:49:57。
- † 事後加重 stress：17:50:15–17:56:10。
- 正式分析：17:57 後。
- 論文修訂與封存：18:00 後。

r1–r5 generation 都沒有修改，見 `PRIOR_REFERENCES.md`。

## 1. 如何驗證／重建

| 指令 | 行為 | 是否寫入 |
|---|---|---|
| `sh verify.sh`（本目錄） | 以 `sha256sum -c --strict` 對照本目錄的 `SHA256SUMS`。若以多個 part 上傳，需全部解壓到同一路徑後再驗證，解壓順序不限 | 否，嚴格唯讀 |
| `harness/reproduce.sh analyze <新空目錄>` | 只讀 r1–r6 raw，依序執行：contract test、oracle v2 重評分、E4 鑑識、表重建、cell index、logical_id 稽核、r3／r4／r5 比較、**r6 比較（`analysis/r6_compare.py`）**、r1 extractor 比對、raw 唯讀指紋 | 只寫入新目錄 |
| `harness/runs/r6-validation/run_r6.sh` | 重跑 r6，順序為 replay→matrix→stress→faults→barrier。拒絕覆蓋既有的 `r6*` run；需要兩個 ATM pin（見 `PINS.json`） | 只寫入新 run |
| `summaries/runs/r6-validation/forensics/sqlite-busy/queue_busy_repro.*.mjs` | 直接呼叫 apply 佇列的壓力重現腳本（r5 鑑識腳本，只換 import 路徑） | 只寫入暫存目錄 |

r6 新 raw 以 deterministic tar 加 `gzip -n -9` 打包：
- `raw/r6-replay-q5.tgz`／`r6-replay-q6.tgz`／`r6-replay-nq6.tgz`：每臂 150 runs。
- `raw/r6-matrix.tgz`：27 runs。
- `raw/r6-stdout.tgz`。

stress、faults、barrier 的結果在 `summaries/runs/r6-validation/`。

## 2. 與 r5 的差異

**Harness**（完整 diff：`harness/R6_CHANGES.patch`，相對於封存的 r5 harness）
- `analysis/r6_compare.py`：新檔，由 `r5_compare.py` 衍生。新增 SQLITE 例外與 presence 殘留計數、block 拆分、stress／† stress、faults、barrier、反例檢查。
- `analysis/rescore_oracle_v2.mjs` 只新增 r6 stage 標籤；`tools/analyze.sh` 新增 r6 步驟。
- 新增 `runs/r6-validation/{run_r6.sh,pin_record.py}`。
- `REPRODUCE.md` 新增 r6 一節。
- harness 的量測程式（`src/`、`test/`）沒有改動。同機器上並行開發的 HIST 檔案不收錄，見 D9。

**文件**（完整文字 diff：`docs/r6-notes/TEXT_CHANGES_r5_to_r6.diff`）
- 論文正文：
  - §1.5、表 V1（r3–r6）、§4.11 改為 pin b35a6141，(d4) 列描述退回機制。
  - §6 表 R3 新增 b35a6141 兩列；新增**表 R6**（r6 E4 重播／cells／例外與 presence／stress）。
  - §7.1 限制 D6 改為「已在 #238 修正」，並附 r6 結果。
  - §7.3、§8 隨之更新。
  - 附錄 C 改為 r1–r6 索引；新增**附錄 G**（r6 過程、CI、偏離）；新增參考文獻 [23] PR #238。
  - r1–r5 相關段落（附錄 E、F、表 R4／R5）未改。
- `tables/F2_CORRECTNESS_TABLES.md` 新增表 A-r6，`docs/METRIC_DEFINITIONS.md` 新增 §9，`docs/VERSION_ANCHORS.md` 與 `docs/EXPERIMENT_CHECKLIST.md` 各新增 r6 一節。

**摘要**
- `summaries/runs/r6-validation/` 收錄：PREREG_R6.md、PINS.json、ATM core diff、r6.log、LOAD.log、barrier、faults、`forensics/sqlite-busy/`、`DEVIATIONS.md`。
- `summaries/runs/r6-analysis/r6-2026-10-09/` 是正式分析，含 `r6-compare/R6_TABLES.md` 與 `r6_summary.json`。
  - r5-analysis 不再攜帶，由此重算取代。
  - 重算後的 r5 replay／matrix 摘要與正式 r5 分析逐值相同。
  - r1 extractor 比對 IDENTICAL；raw 唯讀指紋前後一致。

## 3. 主要結果（事實；各項分列，不合併）

E4 重播：r5 同配置與 seeds，每臂 2 blocks × 75 runs＝150 runs、5,220 intents。三臂同時段交錯執行；harness 鎖 off；Wilson 95% 區間為描述性。

| 臂 | 完成（95% CI） | 失敗 runs（95% CI） | 遺失 | blocked（hash-drift） | SQLITE 例外 intents（runs） | presence 殘留 | 損壞 | re-compose 事件／成功 |
|---|---|---|---:|---|---|---:|---:|---|
| 37847584 queue on（q5） | 3,490（66.9%；0.656–0.681） | 0／150（0–0.025） | 0 | 1,730（0） | 1（1） | 1 | 0 | 0／0 |
| **b35a6141 queue on（q6）** | **3,500（67.0%；0.658–0.683）** | **0／150（0–0.025）** | **0** | 1,720（0） | **0（0）** | **0** | 0 | 0／0 |
| b35a6141 queue off（nq6） | 3,458（66.2%；0.650–0.675） | 0／150（0–0.025） | 0 | 1,762（0） | 0（0） | 0 | 0 | 217／58 |

- E4 完整 cells（p{2,4,8}×s{11,17,23}，每臂 9 runs、318 intents）：完成 213／209／210，三臂都是 0 遺失、0 例外。
- 逐 run 配對（描述性）：
  - q6 對 q5：較高／相同／較低為 62／22／66，合計 +10 intents。
  - nq6 對 q6：63／18／69，合計 −42。
  - 兩個差異都在 block 間變動的量級內（q5 兩個 block 差 48）。
- q5 的例外：run `r6v-e4-p8-s11-g-q5-r5`，1 個 intent 以 `ERR_SQLITE_ERROR database is locked` blocked（fail-closed：未寫入），並留下 1 個 presence 檔。
- 佇列壓力重現（拋出次數／呼叫次數）：
  - 預先登錄 8 processes × 300 calls × 3 rounds：37847584 為 1／7,200（presence 殘留 1），b35a6141 為 0／7,200（殘留 0）。
  - † 事後加重 16 × 1,000 × 3：37847584 為 78／48,000，全部發生在 `steward-apply-queue.ts` L252，presence 殘留 78；b35a6141 為 0／48,000，殘留 0。
- 故障情境（b35a6141，queue on 與 off 都跑）：全部 0 遺失、0 frame 損壞。
  - F6 真實 `unshare` 跨 PID namespace：namespace 分離確認 40／40，both_inside_lock 0。
  - F1 rename 前 SIGKILL：孤兒 temp 在取得鎖後刪除，20／20。
  - O2 活著的寫入者的 temp：60／60 未被刪除，cleaner 回報 skippedLiveHolder 60／60。
  - F2／F2b／F3／F4／F5／F7 每個 variant 3 次。
- barrier（b35a6141；seam queue off、stale-proposal queue on／off，6 案例 × 10 次）：0 遺失。
- **反例（§5.7）：無。** replay、cells、faults、barrier 的遺失、損壞與 frame 壞都是 0。
- r6 cells 經 oracle 重評分 0 改判、0 unscored；pin 與 env 檢查全部一致。
- CI（另列）：PR #238 feature head `2712c024` 與 merge `b35a6141` 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 都是 green。

## 4. 偏離（全文：`DEVIATIONS.md`；與 `summaries/runs/r6-validation/DEVIATIONS.md` 相同）

| 編號 | 內容 |
|---|---|
| D0 | 主批次 477 runs 全部 rc=0，pin 樹未被寫入 |
| D1 | pin 準備時，同 box 上另一程序正在下載同一 tarball；等它結束後才使用，並以 sha／內嵌 commit／`tar -d` 獨立驗證 |
| D2 | 預先登錄檔在執行前修正一處錯字，設計未改 |
| D3 | 同機負載（loadavg 最高 11.54）；時間類指標不與 r5 比較 |
| D4 | † 事後加重 stress，非預先登錄 |
| D5 | pin 對照混有 #238 以外的 core 變更（`sqlite-runtime.ts`） |
| D6 | 修正後「退回檔案鎖」的次數無法觀察；0 例外不代表沒有資料庫競爭 |
| D7 | 分析腳本變更，r1–r5 結果不變 |
| D8 | 範圍：未跑回歸、E5、before-precheck barrier、seam queue on；Phase 3 未執行 |
| D9 | 打包時排除同機器上並行的 HIST 開發檔 |

## 5. r5 限制 D6 的狀態

- r5 記錄的 apply 佇列 SQLITE_BUSY 例外與 presence 洩漏，已在 ATM PR #238（merge `b35a6141`）修正。
- r6 在 b35a6141 上的結果：
  - E4 重播與 cells 159 runs：0 例外、0 presence 殘留。
  - 預先登錄 stress：0／7,200。
  - † 加重 stress：0／48,000。
- 同時段 37847584 的結果：
  - E4 重播與 cells：1 例外，在 159 runs 中的 1 個 run。
  - 預先登錄 stress：1／7,200。
  - † 加重 stress：78／48,000。

**仍存在的限制**
1. 退回次數無法觀察（D6）。
2. pin 對照混有非 #238 變更（D5）。
3. 37847584 在一般負載下例外率很低；預先登錄的量測區分力有限，加重 stress 是事後探索性的。
4. 只在同機、同一檔案系統上測試；沒有測網路檔案系統或跨主機。
5. Wilson 區間假設 intent 彼此獨立，實際會偏窄；沒有做顯著性或非劣性檢定。
6. 150 次觀察不能當成正確性證明；Phase 3 未執行。

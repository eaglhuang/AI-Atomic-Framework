# r6 偏離與事件紀錄（DEVIATIONS；時間皆 Asia/Taipei CST）

預先登錄：`PREREG_R6.md`（執行時 sha256 `c5f42235da7b1fc9885d3c30afa1dbc1eb8884f158d3317365e04a32bad08b17`，記於 `r6.log` 第一行）。原則同 r5：不混用不完整批次；非預先登錄的部分標 †（post-hoc、探索性）；任何遺失／損壞照實報告。

## D0　主批次（未偏離）
- `run_r6.sh` 2026-10-09 17:30:41 開始、17:49:57 結束：replay 450 runs（3 臂 × 2 blocks × 75）→ matrix 27 runs → stress 6 rounds → faults（4a F6／F1／O2 reps 10；4b F2／F2b／F3／F4／F5／F7 reps 3）→ barrier（6 案例 × 10 reps）。`r6.log`：477 筆 `rc=0`、0 筆非零；faults 兩次 `rc=0`。
- 執行後兩個 pin 的 `packages/core/src` tree hash 與 broker 關鍵檔 hash 與 `PINS.json` 一致；兩個 pin 樹內未產生 `.atm/runtime/steward-commit-locks` 或 `broker-steward-apply-queue`（pin 未被寫入）。b35a6141 tarball 以 `tar -d` 比對內容與解壓樹一致（只有 mode／uid／gid／mtime 差異）。

## D1　pin 準備：同一 box 上的另一個程序同時下載同一 tarball
- 17:28 開始準備時，`/workspace/atm-main-b35a6141/` 已有另一個程序（同一 box 上的其他 agent）正以 `curl` 從 `codeload.github.com/.../tar.gz/b35a6141…` 下載並解壓。等待其結束後才使用；之後獨立驗證：tarball sha256 `93fa7839d8e0fee51e5ad224833df2b57397fead3e77e0528117f21f5d5e59ef`（197,301,078 bytes）、pax 內嵌 commit＝`b35a6141bd5bfbaec654f1cd3079323581b04074`、`tar -d` 內容無差異；`node_modules` 的 5 個 ajv 相依 symlink 由本回合建立（與其他 pin 相同）。方法與 r5 相同（GitHub commit tarball，未 clone）。

## D2　預先登錄檔在執行前改過一次（錯字）
- 初稿 sha256 `0da46c02…`；執行前把「codeload 商業 tarball」改為「codeload commit tarball」（錯字），未改任何設計。`r6.log` 記錄的是改後、執行前的版本 `c5f42235…`。

## D3　同機負載（計畫內記錄）
- 同一 box（8 vCPU、16 GB）上另有一個 benchmark executor 同時執行。各相位開始時的 loadavg 見 `LOAD.log`：replay 開始 0.99 → block1 grid 4.41 → block2 grid 5.99 → matrix 10.16 → stress 11.54 → faults 5.74 → faults-4b 0.20 → barrier 0.32。17:40:18 的 `top` 快照（`top-snapshot-1740.txt`）CPU 92.6% idle，load 主要來自本回合的 stress processes。
- 影響：時間類指標（wall ms、total_ms）受同機負載影響，不與 r5 的時間數字比較；正確性指標（完成／遺失／損壞／例外）不受影響的假設未經驗證，僅記錄。

## D4　† 事後加重 stress（非預先登錄、探索性）
- 原因：預先登錄的量測中，37847584（q5）在本時段的例外率很低（E4 replay＋matrix 159 runs 中 1 個 intent；stress 8×300×3＝7,200 次中 1 次），兩個 pin 在此頻率下無區分力（預先登錄判定規則已註明此情況）。
- 處置：同一 `queue_busy_repro.mjs`（只換 import 路徑），16 processes × 1,000 calls × 3 rounds／pin，兩 pin 交錯；17:50:15–17:56:10（loadavg 0.64→1.41）。輸出 `forensics/sqlite-busy/posthoc-stress16x1000-*.jsonl`、`posthoc-stress-summary.jsonl`。報告時標 †。

## D5　pin 對照混有 #238 以外的 core 變更
- `packages/core/src` 37847584→b35a6141 差異：`steward-apply-queue.ts`（#238）、`steward-kernel-lock.ts` 與新增 `sqlite-runtime.ts`（延後載入 `node:sqlite` 以過濾實驗性警告；來自 37847584 與 #238 base `3878cde9` 之間的 main 變更，不屬 #238）。完整 diff：`ATM_CORE_DIFF_37847584..b35a6141.patch`。q5 與 q6 的差異因此不能只歸因於 #238。

## D6　修正後的「退回檔案鎖」次數不可觀察
- b35a6141 遇 SQLITE_BUSY／SQLITE_LOCKED 時靜默退回 per-target 檔案鎖路徑，不拋出、不記錄。harness 不計數退回次數；因此 q6 的「0 例外」表示**沒有例外傳出 apply、也沒有 presence 殘留**，不表示沒有發生資料庫競爭。

## D7　分析腳本變更（不影響既有數字）
- 新增 `analysis/r6_compare.py`（由 `r5_compare.py` 衍生：臂／pin 清單、`r6[vm]-` 前綴、block 拆分、SQLITE 例外與 presence 殘留計數、stress、faults、barrier 摘要）；`analysis/rescore_oracle_v2.mjs` 只新增 `r6-replay`／`r6-matrix` stage 標籤；`tools/analyze.sh` 新增 r6 步驟。r1–r5 cells 的重評分結果不變（由正式分析檢查）。

## D8　範圍（計畫內）
- r6 是小型驗證：未跑單 process 回歸、E5、before-precheck barrier、seam queue on；未重跑 5692474f／bea35380／2118bc66。Phase 3（450-run 主矩陣）仍未執行。

## D9　打包範圍：排除同機器上並行的 HIST 開發檔（2026-10-09 18:00 CST）
- 打包時發現 harness 工作目錄裡有另一工作流新增的未完成檔案（`src/hist/*.mjs`、`test/hist_oracle_contract.mjs`、`hist-tools/`），mtime 介於 17:21 與 17:58 CST。它們不屬於 r6，r6 的 run 也沒有引用它們：`src/cli.mjs` 自 2026-10-08 起沒有改動，也沒有 import `src/hist`。因此 r6 generation 的 `harness/` 不收這些檔，`R6_CHANGES.patch` 也不含。r6 的資料與分析不受影響。

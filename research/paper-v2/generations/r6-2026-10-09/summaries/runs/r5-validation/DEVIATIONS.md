# r5 偏離與事件紀錄（DEVIATIONS；時間皆 Asia/Taipei CST）

本檔記錄 r5 執行中與預先計畫（todo r5-verify、`run_r5.sh` 初版）不同之處、中斷與處置。原則：不混用不完整批次；新增臂標為 post-hoc；任何遺失／損壞照實報告。

## D0　主批次（未偏離）
- `run_r5.sh` 17:40:09 開始，18:12:05 結束（`r5.log` 的 `end` 行）；barrier→replay(525)→matrix(87)→regression(198)→e5(10 inject＋30 cells)→faults（main＋2118bc66 對照）。`r5.log` 共 852 筆 `rc=0`、0 筆非零。
- 跑完後四個 pin 的 `packages/core/src` tree hash 與 broker 關鍵檔 hash 與 `PINS.json` 一致；37847584 樹內未產生 `.atm/runtime/steward-commit-locks` 或 `broker-steward-apply-queue`（pin 未被寫入）。

## D1　代理工作階段中斷（約 18:19–18:21）
- 中斷發生在主批次結束之後、正式分析 `./reproduce.sh analyze runs/r5-analysis/r5-2026-10-08` 執行期間。檢查結果：該分析其實已跑完（log 有 `raw unchanged`、`done`），runs 全部完整，**沒有不完整的實驗批次**，因此無需丟棄或重跑任何 run。
- 但因 D2 的分析腳本修正，第一版分析輸出不再作為正式結果：整目錄移至 `runs/r5-analysis/superseded-r5-2026-10-08-v1/`（保留、不引用），正式分析改以 v2 腳本重跑到 `runs/r5-analysis/r5-2026-10-08/`（腳本拒絕非空目錄，故先移走）。raw 不變（fingerprint 由 analyze 步驟比對）。

## D2　分析腳本 `analysis/r5_compare.py` v1→v2（不影響任何數字，只修判定）
- v1 的 `env_mismatch` 把 18 個 `r5r-e2-*-git_three_way-*-q` cells 判為不符：git_three_way writer 會寫 `compose_batches` 但不經 ATM steward apply、也不記 `atm_env`，被當成「env＝{}」。v2 只對帶有 `atm_env` 欄位的 steward-writer batch 檢查 env。修正後預期 `env_mismatch` 為空。
- v2 另新增：`exception_blocked_intents`（ATM 拋出例外而 fail-closed 的 intents）與 §1c 表；post-hoc 臂（D3）；配對比較 nqref/nq、nqr0/nqref、nqr1/nqref。
- v1 備份：`/workspace/reports/r5-work/r5_compare.py.v1`（封包內以 `harness/R5_CHANGES.patch` 呈現最終版）。

## D3　post-hoc 臂 nqref／nqr0／nqr1（18:24:59 起；**非預先登錄**）
- 原因：預先登錄的 re-compose 消融臂 qr0／qr1 疊在 queue on 上；主批次顯示 queue on 時 E4 重播 **re-compose 事件為 0**（q、qr0、qr1 各 75 runs），使該消融無從區分（各臂實質走同一路徑）。queue off（nq）則有 105 次事件、35 次成功。
- 處置：以同一 75-run 配置與 seeds 加跑 queue off 下的 maxRecompose 0（nqr0）與 1 次無退避（nqr1），並加一個同時段的 queue off 預設參照臂 nqref（因與主批次不同時段，不直接與 nq 比較）。`run_r5.sh` 只新增 `aenv` 三個 case（原檔備份 `/workspace/reports/r5-work/run_r5.sh.pre-posthoc`）；命令：`PHASES=replay ARMS="nqref nqr0 nqr1" bash runs/r5-validation/run_r5.sh`。
- 報告時標為 post-hoc、探索性；qr0／qr1 結果照原計畫照列（並註明無區分力）。

## D4　barrier 在 37847584 以 queue off 執行（計畫內，依 PR 警告）
- seam 與 before-precheck 會讓先到的 process 停在合成後；queue on 時它握著隊伍頭，另一方等滿 `ATM_STEWARD_APPLY_QUEUE_WAIT_MS`（10 s）後退回檔案鎖（非永久卡死）。正式 20 reps 以 `ATM_STEWARD_APPLY_QUEUE=off`；queue on 只跑 seam 探索性 5 reps（`seam-new-qon-exploratory-*`）。stale-proposal 模式 queue on／off 都跑 20 reps。每個 barrier 結果檔的 `atm_env` 欄位記錄實際設定。

## D5　故障情境次數
- F6（跨 PID namespace，真實 `unshare -Urpf --mount-proc`，util-linux 2.41.5）兩方向各 10 次 × {37847584 qon, qoff, 2118bc66}；每次以 `/proc/self/ns/pid` 確認 namespace 分離（`ns_split_confirmed` 60/60）且 namespace 內 pid＝1。
- F1、F3、F4、O2、F7 每 variant 10 次；F2、F2b、F5 每 variant 5 次（多 variant，沿 r4 設計）。

## D6　發現：37847584 apply 佇列的 SQLITE_BUSY 例外（不是 §5.7 反例；照實報告）
- 現象：queue on 的臂（q、qr0、qr1）共 8 個 intents／8 runs 以 `ERR_SQLITE_ERROR: database is locked` 結束（ATM `applyStewardPlan` 拋出例外，harness 記為 blocked）。未寫入、0 遺失、0 損壞；queue off 臂 0 次。
- 根因（程式碼閱讀＋獨立重現）：`steward-apply-queue.ts` `joinOne()` 在 presence DB 已 `BEGIN IMMEDIATE` 之後、try 區塊之外呼叫 `openDatabase(queue.sqlite)`；其第一個語句 `PRAGMA synchronous = OFF`（第 252 行）在另一 process 提交 queue.sqlite 時可能得到 SQLITE_BUSY。此錯誤傳出 `withStewardApplyQueue`，而 `isQueueUnavailable()` 只接受 ENOTDIR/EACCES/EPERM/EROFS/ENOSPC/ENOENT，因此重新拋出，未退回檔案鎖路徑；同時 presence 檔與連線洩漏（每個受影響 run 的 `p/` 目錄各留 1 個 presence 檔）。
- 重現：`forensics/sqlite-busy/queue_busy_repro.mjs`（8 processes × 300 次 `withStewardApplyQueue`），2,400 次中 4 次在第 252 行拋出，留下 4 個 presence 檔（`repro_output_2026-10-08T1822.txt`）。受影響 intents 清單：`forensics/sqlite-busy/affected_intents.json`。
- 判定：fail-closed（無遺失、無損壞），依 §5.7 不構成反例；屬可用性缺陷，列為已知限制與後續修正建議（把 queue DB 的開啟與 PRAGMA 放進 BUSY 重試或 fallback，並在例外時釋放 presence）。未修改 ATM pin。

## D7　其他
- 本次工作階段的工具等待計時與 box 時鐘不同步（等待回報的秒數大於 `date` 前進量）；所有時間以 `date`／檔案時間（CST）為準。

## D8　第二次中斷與分析 stdout
- v2 正式分析（18:31–18:32 CST）的 stdout 擷取檔 `analyze-v2.out` 只留下標頭一行（背景程序的輸出被工作階段結束截斷）；分析產物完整：`RAW_READONLY_CHECK.txt`＝raw unchanged（fingerprint `c9c3fab2…`）、檔案集合與 v1 相同、r1 extractors 兩項 IDENTICAL、`r5-compare.log` 為 `pin_mismatch [] env_mismatch [] unscored 0`、oracle rescore r5 各 stage cells_changed／ops_changed 皆 0。未重跑。
- 代理工作階段於 2026-10-08 晚間再度中斷，2026-10-09 08:01 CST 恢復；中斷時所有 runs 與分析已完成，恢復後只做論文、文件、封存與上傳步驟，未重跑任何實驗。

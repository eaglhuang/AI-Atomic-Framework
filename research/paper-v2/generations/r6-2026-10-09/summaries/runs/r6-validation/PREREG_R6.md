# r6 預先登錄（PRE-REGISTRATION；small validation of ATM PR #238）

寫於執行前：2026-10-09（Asia/Taipei, CST）。本檔 SHA256 於執行開始時寫入 `r6.log` 第一行，執行後不修改；任何偏離寫入 `DEVIATIONS.md`。
DRAFT evidence；作者自行執行、未獨立重現；不主張勝出。使用者核准範圍：修 SQLITE_BUSY（PR #238）→ 小型驗證封存為 r6。

## 目的（單一問題）
r5 DEVIATIONS D6：ATM 37847584 queue on 時，`steward-apply-queue.ts` 開啟 queue.sqlite 的 PRAGMA 遇 SQLITE_BUSY 拋出例外
（8 intents／8 runs，fail-closed，0 遺失／0 損壞），且每次洩漏 1 個 presence 檔。PR #238（merge b35a6141）改為 SQLITE_BUSY／SQLITE_LOCKED
退回 per-target 檔案鎖路徑，presence 檔在 finally 清除。r6 只回答：**同配置下 b35a6141 是否不再出現該例外與 presence 洩漏，且不引入遺失／損壞**。

## Pins（唯讀；GitHub codeload commit tarball，與 r5 相同方法；不 clone）
- `37847584`＝r5 pin（PR #216 merge），重用 r5 已驗證之樹（PINS.json 重新記錄 hash）。
- `b35a6141`＝PR #238 merge `b35a6141bd5bfbaec654f1cd3079323581b04074`，`https://codeload.github.com/eaglhuang/AI-Atomic-Framework/tar.gz/b35a6141bd5bfbaec654f1cd3079323581b04074`，
  node_modules＝與其他 pin 相同的 5 個 ajv 相依 symlink。

## 臂（同時段交錯；harness `--steward-apply-lock off`）
- `q5`  ＝ 37847584，`ATM_STEWARD_APPLY_QUEUE=on`（r5 主臂的同時段重跑對照）
- `q6`  ＝ b35a6141，`ATM_STEWARD_APPLY_QUEUE=on`（r6 主臂＝ATM 預設）
- `nq6` ＝ b35a6141，`ATM_STEWARD_APPLY_QUEUE=off`（佇列消融）

## 相位與次數（seeds 皆沿用 r3/r4/r5 預先登錄值）
1. **replay（E4，與 r5 完全相同的 MP 參數）**：每臂 2 個 block × 75 runs ＝ 150 runs／臂（450 runs）。
   block 1 ＝ r5 原樣：p2/s17 exact × 30 reps（r01–r30）＋ grid p{2,4,8} × s{11,17,23} × 5 reps（r1–r5）。
   block 2 ＝ 同配置、同 seeds，rep 編號續編（exact r31–r60；grid r6–r10），只增加次數以觀察低頻例外。
   workload seed＝s；scheduler seed＝s+1000；procs、compose window 100 ms、agents 8、trials 5、hot 1、overlap high、hold 8–25 ms、tick 15 ms、jitter 6 ms。
2. **matrix（r1 E4 主 cells，僅 multi-process）**：每臂 p{2,4,8} × s{11,17,23} ＝ 9 cells（D6 在 r5 也出現在 `r5m-e4-hot_conflict-steward-p4-s17-q`）。
3. **queue stress repro**：r5 `forensics/sqlite-busy/queue_busy_repro.mjs` 原樣（只換 import 路徑），8 processes × 300 次 `withStewardApplyQueue`，
   每 pin 3 次（37847584、b35a6141 交錯），計拋出次數與殘留 presence 檔。
4. **faults（harness 層，test/r5_fault_scenarios.mjs 原樣）**：pins `b35a6141-qon`、`b35a6141-qoff`。
   - 4a：`--only F6,F1,O2 --reps 10`（F6＝真實 `unshare -Urpf --mount-proc` 跨 PID namespace；F1＝持鎖者 SIGKILL 後孤兒 temp 清理；O2＝存活寫入者的 temp 不被清）。
   - 4b：`--only F2,F2b,F3,F4,F5,F7 --reps 3`（小量；F2／F2b／F5 腳本內上限 5 → 3）。
5. **barrier（確定性 2-process 交錯；test/barrier_interleave.mjs 原樣）**：b35a6141 seam queue off、stale-proposal queue on／off，各 10 reps × 兩種 region 組合。

## 指標（與 r5 相同腳本／定義；analysis/r6_compare.py 由 r5_compare.py 衍生，只改 cell 前綴、臂、pin 清單並新增 presence 計數）
- 每臂：完成／總 intents、失敗 runs／總 runs、遺失效果、blocked intents、其中 hash-drift（另列）、損壞檔、Wilson 95% CI（描述性）。
- **主要觀察量**：ATM 拋出例外而 blocked 的 intents（`blocked:ERR_*`，含 `ERR_SQLITE_ERROR database is locked`）與 runs 數；
  run 結束後 `atm/worktree/.atm/runtime/broker-steward-apply-queue/*/p/` 殘留 presence 檔數。
- 判定規則（預先寫定）：b35a6141 兩臂 0 例外、0 presence 殘留 → 記為「本配置下未再觀察到」（不是「證明不存在」）；
  ≥1 → 照實報告為 r6 發現。任何遺失效果或損壞檔＝§5.7 反例，照實報告，不隱藏。q5 若 0 次 → 註明低頻、對照無區分力。
- 不做顯著性檢定、不主張勝出；結果只作描述。

## 環境
同一 box（8 vCPU）上另有一個 benchmark executor 同時在跑；每個相位開始時記錄 `uptime` 與 `nproc` 到 `r6.log` 與 `LOAD.log`，並於 DEVIATIONS 註明。

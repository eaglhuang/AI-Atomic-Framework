# TASK-CID-0111 Close-Ready 檢核清單（最小版）

目標：在同一輪把 `TASK-CID-0111` 一次收尾。  
原則：用受管道徑 `taskflow` 完成，不走繞路命令。

## 一、Claim 前先檢查

- `TASK-CID-0097` 與 `TASK-CID-0099` 已為 `done/ready`（視 ATM 回報的前提狀態）。
- `TASK-CID-0111` 卡面狀態為 `ready`（非 `planned`）才可 claim。
- 確認任務卡可見欄位包含：
  - `deliverables`：`packages/core/src/broker/types.ts`、`packages/core/src/broker/team-lane.ts`、`packages/core/src/commands/broker.ts`
  - `scopePaths` 同上
  - `validators`：`npm run typecheck`、`npm test`、`git diff --check`
- 本卡 deliverables 有編譯/測試證據可回補（不要求你重新跑一次未必要）

## 二、Close-Ready 判斷條件（最小）

- 任務 close-ready 需要同時滿足：
  1. 這 3 個 deliverable 有對應 commit diff（實際實作已落地）
  2. `tasks evidence` 或 `evidence historical-batch` 形成對應 task slice，且該 slice 在 `okToCloseTask: true`
  3. 任一 required validator 通過並可被 close 使用（含 command-backed record）
  4. 若使用 historical-batch，需同時存在：
     - 可讀到 `historical-batch` 主檔
     - 任務 slice 中 `coverage` 為 `complete`（不可為 `partial`/`blocked`）

## 三、建議順序（同一輪）

1. 佔用任務（claim）：
   ```bash
   node atm.mjs next --claim --actor captain --prompt "TASK-CID-0111" --json
   ```
2. 若是 live 實作尚未完成，先補證據與驗證後再回到 close；若已完成 delivery，可先做 dry-run：
   ```bash
   node atm.mjs evidence historical-batch \
     --tasks TASK-CID-0111 \
     --commits <delivery-commit> \
     --actor captain \
     --validator-command "npm run typecheck" \
     --validator-command "npm test" \
     --validator-command "git diff --check" \
     --validators typecheck,test,"git diff --check" \
     --write --json
   ```
3. 先 preview close：
   ```bash
   node atm.mjs taskflow close \
     --task TASK-CID-0111 \
     --actor captain \
     --historical-batch <batch-id-or-path> \
     --dry-run \
     --json
   ```
4. 通過後收尾：
   ```bash
   node atm.mjs taskflow close \
     --task TASK-CID-0111 \
     --actor captain \
     --historical-batch <batch-id-or-path> \
     --write \
     --json
   ```
5. 收尾後做 `git status --short`，確認沒有殘留未預期改動。

## 四、如果卡住，停在哪就先補哪

- `ATM_TASKFLOW_CLOSE_HISTORICAL_BATCH_NOT_CLOSE_READY`：補 `evidence` / `historical-batch` 覆蓋條件，避免把不完整 slice 當 close-ready。
- `TASK` 還沒 `ready`：不要硬 close，先處理依賴卡（0097/0099）。
- `--historical-delivery` 被要求：用 `tasks` delivery commit 來源補齊後再 close。

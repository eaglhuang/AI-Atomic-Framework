# Keep

## ATM-TEST-RESET

這個段落記錄 ATM 反覆紅隊測試時的固定 reset 邊界，目標是避免代理把同步、重測、下游專案實作混在一起。

### 目前有效的重測範圍

ATM 治理重測目前只處理兩個 repo：

- `C:\Users\User\AI-Atomic-Framework`
- `C:\Users\User\3KLife`

以下路徑不在這條重測線內，除非使用者明確要求，否則不可因為「順手 reset」而修改：

- `C:\Users\User\3klife-npc-brain`
- `C:\Users\User\3KLife\examples\liu-bei-memory-intent-game\`

其中 `examples/liu-bei-memory-intent-game/` 是三國人物管線的小遊戲工作區，與 ATM 自我原子化任務驗收無關。就算它剛好在工作樹裡是 modified，也不能當成 ATM 測試殘留直接回退。

### 3KLife 的 ATM 重測 reset 邊界

當使用者要求把 ATM 任務重測現場退回「可重新測試的起點」時，只應整理這些檔案：

- `C:\Users\User\3KLife\atm.mjs`
- `C:\Users\User\3KLife\.atm\runtime\pinned-runner.json`
- `C:\Users\User\3KLife\docs\ai_atomic_framework\atm-self-atomization\tasks\TASK-ASA-*.task.md`

TASK-ASA 任務卡 reset 規則：

- `status` 回到 `planned`
- `started_at` 回到 `null`
- `started_by_agent` 回到 `null`
- `completed_at` 回到 `null`
- 清除 reopen / audit 這類臨時重開狀態，讓卡片恢復成「未開始」的新狀態
- 保留 `target_repo: AI-Atomic-Framework`
- 保留 `closure_authority: target_repo`

如果工作樹裡還有與 ATM 任務無關的修改，必須先把它們列為排除範圍，再做 reset；不要用一次性回退把下游專案其他進度一起清掉。

## ATM-SYNC-BEFORE-TEST

每次準備重跑 ATM 治理測試前，先做 framework side 的同步，不要等測到一半才發現 runner 版本過舊。

### 固定流程

1. 在 ATM framework repo 跑：
   - `node atm.mjs next --json`
   - `node atm.mjs framework-mode status --json`
   - `node atm.mjs guard framework-development --json`
2. 使用 repo 內建的 internal build sync 流程：
   - `node atm.mjs internal-release sync --repo <repo-a> --repo <repo-b> --json`
3. 若本輪測試只需要 `3KLife`，或明知 `npc-brain` 有別的實作進度，應明確把不相關 repo 排除，不要為了同步把另一條工作流捲進來。
4. 同步完成後，先檢查下游：
   - `.atm/runtime/pinned-runner.json`
   - `sourceCommit`
   - `sha256`
5. 確認下游已吃到最新 runner，再開始正式測試。

### 原則

- 使用 sync skill / internal sync command，不手動複製 `atm.mjs`
- 測試結果若發生在同步前舊 runner 上，只能當參考，不能當正式驗收
- 驗收標準不是「AI 最後有沒有做完」，而是「AI 一偏移時 ATM 是否立刻阻擋並提供下一步」

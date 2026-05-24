# Keep Summary

## ATM-TEST-RESET

- ATM framework 新版本下發到內部 adopter repo 之前，先走 repo 內建 sync skill 流程，不手動複製 `atm.mjs`。
- ATM 治理重測目前只包含：
  - `C:\Users\User\AI-Atomic-Framework`
  - `C:\Users\User\3KLife`
- `C:\Users\User\3klife-npc-brain` 不屬於這條重測線，除非使用者明確要求，否則不要碰。
- `C:\Users\User\3KLife\examples\liu-bei-memory-intent-game\` 是三國人物管線的小遊戲工作區，與 ATM 重測無關；重測 reset 不可回退或修改這個目錄。
- 3KLife 的 ATM 重測 reset 只應整理：
  - `atm.mjs`
  - `.atm/runtime/pinned-runner.json`
  - `docs/ai_atomic_framework/atm-self-atomization/tasks/TASK-ASA-*.task.md`
- TASK-ASA 重測起點要回到「未開始」樣子：
  - `status: planned`
  - `started_at: null`
  - `started_by_agent: null`
  - `completed_at: null`
  - 清除 reopen / audit 類暫時狀態
  - 保留 `target_repo` 與 `closure_authority`

## ATM-SYNC-BEFORE-TEST

- 先跑：
  - `node atm.mjs next --json`
  - `node atm.mjs framework-mode status --json`
  - `node atm.mjs guard framework-development --json`
- 再用內建 sync 指令：
  - `node atm.mjs internal-release sync --repo C:\Users\User\3KLife --repo C:\Users\User\3klife-npc-brain --json`
- 若這次測試只需要 `3KLife`，可明確 skip 無關 repo，不要碰 `npc-brain`。
- 同步完成後，先確認下游 `pinned-runner.json` 的 `sourceCommit` 已更新，再開始正式重測。

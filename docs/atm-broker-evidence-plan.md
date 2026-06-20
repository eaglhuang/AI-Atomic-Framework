# ATM Broker Evidence Plan (v2 - 快速執行版)

## 目標

把論文證據分成兩層：

1. **Synthetic evidence（B-02 / B-08 / B-13）**：靠本地腳本保證機制可重放。
2. **Field evidence（B-07 / B-12）**：兩位不同編輯器同時開同一範圍，刻意提高實際撞車。

## 目前實作進度

- `TASK-TEAM-0042` / `TASK-TEAM-0043` 已列為下一段 B-12 真實碰撞對。
- 現有掃描能力加上新腳本可把 run / task / actor / file / lane / verdict、以及 closure + team-run 一起輸出。

## 快速跑法

### 1) 同步兩個實體編輯器

- `TASK-TEAM-0042`：由 Codex 打開、主動進行 brokered 寫入。
- `TASK-TEAM-0043`：由 Cursor 打開、主動進行 brokered 寫入。
- 兩邊只走既有 ATM broker 流程，不要繞過任一 write intent。

### 2) 產出證據 bundle

在 ATM repo 執行：

```powershell
node --strip-types scripts/scan-broker-runs.ts --run-dir C:/Users/User/3KLife/docs/ai_atomic_framework/broker-collision-evidence/runs --log-file C:/Users/User/3KLife/docs/ai_atomic_framework/CID-Conflict-Run-Log.md --json-output C:/Users/User/3KLife/docs/ai_atomic_framework/broker-collision-evidence/broker-run-index.json --report-output C:/Users/User/3KLife/docs/ai_atomic_framework/broker-collision-evidence/broker-run-report.md --compact
```

這是論文摘要層（scenario/task/actor/lane/verdict）快速核對。

### 3) 產出 paper bundle（含 closure + team-runs）

```powershell
node --strip-types scripts/collect-broker-evidence.ts --run-dir C:/Users/User/3KLife/docs/ai_atomic_framework/broker-collision-evidence/runs --atm-root C:/Users/User/AI-Atomic-Framework --output-dir C:/Users/User/3KLife/docs/ai_atomic_framework/broker-evidence-bundle
```

輸出：

- `broker-evidence-bundle.json`
- `broker-evidence-bundle.md`

### 4) 結果對照欄位

每筆 run 至少要保留：

- `runId`
- `scenario`
- `task`
- `actors`
- `vendor`
- `shared files`
- `lane`
- `verdict`
- `closurePacket`
- `teamRuns`

若是 `blocked` 或 `queued`，同樣可作為 field evidence，只要 broker verdict 可核對。

## 目前最常見「為什麼很難撞到」

- 兩位編輯器未同時落在同一組共享檔。
- 其中一邊在衝突前就先提交。
- 實際 scope 不對，僅在各自非共享路徑操作。

建議：至少固定 2~3 次同起同進同檔，保證 shared-file 競爭條件形成。


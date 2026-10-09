# Steward-writer gaps — logical_id 解耦與封包（A5／F3）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07（Asia/Taipei） |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（READ-ONLY） |
| 範圍 | harness-only；**不**重跑 E1／E2 150 cells |
| Banner | **DRAFT evidence — 不宣稱勝出** |

---

## 1. `logical_id` 解耦（done）

| 項 | 說明 |
|----|------|
| 舊 stub | `logical_id === intent_id`（字串相同）；見歷史 E1／E2 `expected_effects.json` |
| 新映射 | `intent_id` = `{scenario_id}-i{k}`（排程／attempt 身份）；`logical_id` = `log:{scenario_id}:i{k}`（預先登記的唯一邏輯操作） |
| 產地 | `src/scenario.mjs` 生成 intents 時一併寫入 |
| 傳播 | `src/oracle.mjs`（`logical_id` prefer）；`src/runner.mjs` → steward／git_three_way submit；`src/steward-writer.mjs`／`git-three-way.mjs` 已接受 `input.logical_id`；`arm-stats` 計 lost 時 prefer `logical_id` |
| 標記／payload | `markerFor(intent_id)` **不變**（效果位元仍綁 attempt／intent 字串） |
| 向後相容 | 無 `logical_id` 的舊 scenario → oracle／runner fallback `intent_id` |

### E1／E2 相容 caveat（重要）

- **歷史 cells 仍為 stub 相等**；**不**自動重跑、**不**默認作廢 DRAFT 表。
- 新跑會改變 intent 物件欄位 → **`scenario_hash` 與歷史不同**（即使同 seed／params）。
- 若論文主表要改用「解耦後」分母口徑，須**明示**重跑並換表；目前 E2 仍標 DRAFT／stub 時代。
- MP compose window、final pin、E3+ 仍 open（本檔不處理）。

---

## 2. 封包缺口關閉（A5／F3）

| 檔 | 路徑 |
|----|------|
| Manifest | `/workspace/reports/atm-v2-harness/artifact_manifest.json` |
| Reproduce 說明 | `REPRODUCE.md` |
| 一鍵核驗 | `reproduce.sh`（預設 verify-only；`--matrix e2`／`--full` 才重跑） |
| Checksums | `checksums.sha256` |

---

## 3. 仍 open

- E3 window sweep、E4 MP、E5 fault、F1／F2 表圖
- Final ATM pin TBD
- MP compose window 硬化（若需）
- A3 措辭校正（optional）

---

## 4. Smoke（2026-10-07 23:11 CST）

| 項 | 值 |
|----|-----|
| run_id | `gaps-logical-id-smoke` |
| invoke | `--arm steward --atm-backend real --compose-window-ms 100 --seed 11 --scheduler-seed 1011 --agents 2 --trials 2` |
| oracle | correct=4／lost=0 |
| 證明 | `atm/scenarios/expected_effects.json`：`s11-t000-i0` → `log:s11-t000:i0`（四筆皆 ≠） |
| events | decision／oracle／compose_batches 皆帶相異 `logical_id` |
| E2 歷史 | `e2-hot_conflict-steward-s11` 仍 stub：`logical_id === intent_id`（**未**失效 DRAFT 表） |

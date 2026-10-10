# ATM vs 基準臂：可外部重跑的自動化 A/B 協定

狀態：**方法論 + 可執行骨架（selftest 僅驗證 runner 本身，不是 ATM 的量測結果）**。

## 1. 要回答的問題

在同一批軟體題目上，比較兩種多 agent 協作方式：

- **ATM 臂**：agent 透過 ATM 治理流程工作（由 `agentCmd` / `integrateCmd` 指定的固定指令）。
- **基準臂（baseline）**：每個 agent 一個 git worktree，各自產出分支，以 `git merge` 整合，主線跑測試（CI 等效）。

判準不是「ATM 看起來比較規範」，而是 §4 預先寫好的數字門檻。數據不支持就如實寫出，並依專案原則簡化或移除機制。

## 2. 人類角色如何被自動化取代

原預註冊協定（`research/paper-v2/.../HISTORICAL_BENCH_PREREG_v1.0_zh.md`）需要四個人類角色，單人無法跑。本協定用機制取代：

| 原角色 | 自動化替代 | 為何可信 |
|---|---|---|
| 隱藏題庫負責人 | 題庫事先 commit；隱藏 oracle 放在 repo 外（`AB_HIDDEN_DIR`），只 commit 其 sha256（`pins`） | runner 每次啟動都驗證，改題或改 oracle 即拒跑 |
| 裁判 | 隱藏 oracle（`hidden/check.mjs`）以程式判定，exit code 為準 | 不用 LLM judge，結果可由任何人重算 |
| baseline 操作者 | runner 固定流程：worktree → agent → commit → `git merge` | 每個 run 的步驟由程式決定，無人手動介入 |
| ATM 操作者 | arm 的 `agentCmd` / `integrateCmd` 固定指令 | 同樣以指令字串記錄在 protocol 中 |

隱藏 oracle 只在整合完成後才複製進主線工作樹，agent 全程看不到。

## 3. 設計

- **同題、同模型、同 prompt**：兩臂的差別只在協作機制；模型與 prompt 由 protocol 固定。
- **多 seed + 隨機寫入順序**：每個 (題, 臂, seed) 的 writer 順序由 seed 決定，可重現。
- **配對分析**：以 (題, seed) 為配對單位，對 baseline 做 paired bootstrap（10,000 次，固定 RNG seed）。
- **每個 run 獨立**：從 `seedDir` 重新建立暫存 repo，不共用狀態。
- **不刪證據**：每個 run 的 worktree、prompt、usage、integrate 報告都保留在輸出目錄。

## 4. 指標與預先登記的門檻

| 指標 | 角色 | 來源 |
|---|---|---|
| `mainGreenRate`：整合後主線 oracle 全綠的比例 | **主要指標** | hidden oracle exit code |
| `featurePass`：各 writer 功能是否在主線通過 | 次要 | oracle 逐項輸出 |
| `conflictsPerRun` | 次要 | git merge 失敗數或 integrateCmd 報告 |
| `interventionsPerRun` | 次要（自動化代理） | 衝突數 + agent 非零退出/逾時數 |
| `tokensPerRun`、`costUsdPerRun`、`costUsdPerGreen` | 成本 | agent 回報的 API usage；**缺值記為 null，不估算** |
| `wallSecPerRun` | 次要 | runner 計時 |

決策規則（寫在 `protocol.json` 的 `thresholds`，跑之前不得改）：

- **ATM 支持**：ATM 臂 − 基準臂 的 `mainGreenRate` 差 ≥ +10 個百分點，且 95% CI 下界 > 0。
- **ATM 被否定**：差 ≤ −10 pp，且 95% CI 上界 < 0。
- **無差異**：差的絕對值 < 10 pp，且 CI 包含 0。
- 其餘為 **inconclusive**，不得解讀為支持。

**成本門檻（已預註冊）**：`costRatioMax = 1.5`。品質優勢成立時，還要求 ATM 的「每綠成本」（總 API 成本 ÷ 主線綠的次數）不高於基準的 1.5 倍；超過則判為「品質支持、成本門檻未過」，不能宣稱 ATM 更划算。任一臂缺成本資料即為 inconclusive。

## 5. 已知限制（誠實清單）

1. **writer 循序執行**：目前不模擬真並行，衝突只在整合階段出現。真實並行版本是下一步。
2. **題庫小**：目前 selftest 只有 2 題。結論只能外推到題庫覆蓋的行為。
3. **oracle 只測題庫覆蓋到的功能**：通過不等於沒有語意破壞，需要題庫設計者補測項。
4. **成本依賴 agent 回報**：若 agent 不回報 usage，成本欄位為 null，報告會標示 `tokenNullRuns`。
5. **oracle 的可審查性**：正式 oracle 不在 repo 內，外人只能驗證 hash 相符，無法直接審查測試內容。若要公開審查，須在正式跑完後公開 oracle 本體（hash 已先 commit，可證明未被事後改動）。
6. **ATM 臂尚未驗證**：`atm` 臂的 `status` 為 `unverified`，`arms/atm-integrate.sh` 目前是拒跑的佔位腳本。正式跑之前必須在 bootstrap 過的暫存 repo 完成 preflight（broker proposal → compose → steward apply 跑通），才能把 status 改掉。在這之前，只有基準臂能跑。
7. **selftest 的 fake agent 是確定性腳本**，只用來檢查 runner 的正確性，數字沒有外部意義。

## 6. 已知的前車之鑑

`research/paper-v2/benchmark-main/2026-10-10-hist-main/STOP_REPORT.md` 記錄：HIST 主跑在 SymPy 一組配對發現 ATM steward 寫檔時多了 EOF 換行（忽略 `\ No newline at end of file`），依預註冊停止規則停在 2,500 / 9,750 runs。

這說明兩件事：獨立 oracle 能抓到 ATM 的真實缺陷；而「停止規則寫在前面、反例不隱藏」是這類比較可信的前提。本協定沿用同一原則。

## 7. 重跑

### 正式跑（需要使用者核准預算）

```bash
AB_BUDGET_USD=<核准上限> AB_HIDDEN_DIR=<oracle 目錄，不在本 repo> ./run-formal.sh ./out-formal
```

- 沒設 `AB_BUDGET_USD` 或 `AB_HIDDEN_DIR` 就拒跑。
- 預算在每個 run 之間檢查，超出上限會停止並保留已完成的結果，可續跑。
- `atm` 臂未驗證前會拒跑，除非設 `AB_ALLOW_UNVERIFIED=1`（只用於 preflight 或測試，不得用於正式結論）。
- 正式 protocol 為 3 seeds × 8 題 × 2 臂 × 2 writer，共 96 次 agent 呼叫（模型由 `AB_MODEL` 在執行時指定，並寫入每次呼叫的 usage 紀錄；成本由 CLI 的 usage 欄位記錄）。

### 自我測試（不耗 API）

```bash
./run-selftest.sh      # 用 fake agent 驗證 runner；identity 對照組應判為 no difference
```

### 手動步驟

```bash
cd research/ab-automated-protocol
node run_ab.mjs pin    --protocol protocol.json                  # 確認 hash 與 pins 相符
node run_ab.mjs run    --protocol protocol.json --out ./out      # 可續跑（已完成的 run 會跳過）
node run_ab.mjs report --protocol protocol.json --out ./out      # 輸出 summary.json 與預註冊判定
```

selftest 已驗證：T1（兩人改同一檔尾端）在基準臂發生衝突、主線不綠；T2（改不同檔）主線綠；identity 對照組（兩臂相同）差異為 0。

要跑真實比較，需要使用者提供：

- 真實 agent 的 `agentCmd`（模型、prompt 模板、usage 輸出格式）；
- ATM 臂的 `agentCmd` / `integrateCmd`；
- 題目來源與隱藏測試；
- API 成本上限。

## 8. 檔案

- `README.md`：本文件（方法論）
- `protocol.json`：預註冊參數、臂定義、門檻、pins
- `run_ab.mjs`：runner（`pin` / `run` / `report`，僅使用 Node 內建模組）
- `formal/`：正式題庫（8 題）、seed repo、`protocol.json`（3 seeds、門檻、pins）
- `agents/claude_headless.mjs`：真實 agent 轉接器（呼叫 `claude -p --model $AB_MODEL`，寫入 usage）
- `arms/atm-integrate.sh`：ATM 臂整合腳本（未驗證佔位）
- `run-formal.sh` / `run-selftest.sh`：一鍵執行
- `selftest/`：小題庫、fake agent、`claude` stub（僅供自我測試）

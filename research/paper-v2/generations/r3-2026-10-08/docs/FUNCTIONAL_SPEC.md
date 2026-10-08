# ATM 冷熱寫入准入實驗工具 — 功能規格書（Functional Spec）

| 欄位 | 內容 |
|------|------|
| 文件狀態 | Draft v0.1 |
| 日期 | 2026-10-06（Asia/Taipei） |
| 上位文件 | [PLAN_SPEC.md](./PLAN_SPEC.md) |
| 產品 | ATM（AI-Atomic-Framework） |
| 本文件範圍 | Scenario、Skill 契約、雙環境（ATM on／off）、事件落盤、匯出 |
| 本文件不涵蓋 | 具體 TypeScript 實作、npm 發佈、論文正文 |

---

## 1. 功能目標（使用者故事）

**主路徑：** 在已安裝 ATM 的環境中，任一 AI agent 對話呼叫一支泛用 skill → skill **自動持續**產生可衝突的寫入意圖並經 ATM 准入（碰撞／Composer 合併／排隊等）→ 每筆結果 append 到指定目錄 → 可匯出最終數據量。

**對照路徑：** **同一支 skill**、同一套 Scenario 種子與參數，在 **未開啟 ATM** 的環境跑出平行數據，供論文對照。

**跨 agent：** 多個對話群（可跨 Codex／Claude／Cursor）同時呼叫同一 skill、同一 `run_id`，對同一 fixture 真並行；ATM 負責衝突，skill 不中央排程。

---

## 2. 系統組成

| ID | 元件 | 職責 |
|----|------|------|
| F1 | `atm-bench` CLI／runtime | 場景生成、雙模式執行迴圈、落盤、匯出 |
| F2 | Skill 包裝層 | 泛用 skill 入口；一呼叫即綁定 run 並啟動／加入持續迴圈 |
| F3 | Fixture worktree | 可重置的目標碼庫；ATM on／off 各一份或同結構雙 root |
| F4 | Exporter | 讀 `runs/<run-id>/` → CSV／摘要 JSON |

ATM 本體（broker／registry／composer／冷熱）為依賴，不在本規格重寫；本工具透過 ATM 公開 API／CLI 閘道呼叫。

---

## 3. 執行模式

### 3.1 `mode=atm`（實驗組）

- Worktree 受 ATM 治理（WriteIntent → broker → 冷熱決策）。
- 預期事件類型含：`admit`、`cold_block`、`cold_queue`、`hot_provisional`、`composer_merge`、`cas_retry`、`reject`、`commit`、`abort` 等（見 §6）。
- 冷檔目標行為以 **排隊** 為規格目標；若當前實作仍為速擋，以 `atm_capability` 旗標記錄實際行為，對照表仍產出。

### 3.2 `mode=control`（對照組，無 ATM）

- **同一 skill 契約**；環境變數或 config 關閉 ATM 閘道（直接寫檔／無 admission）。
- 仍產生相同 Scenario 意圖流；事件記錄「無 ATM 下的寫入結果」（含 overwrite、合併衝突、測試失敗等 OS／git 層結果）。
- **禁止**在 control 模式偷偷走 broker。

### 3.3 雙環境如何並存

建議兩種部署擇一（實作可先做 A）：

| 方案 | 說明 |
|------|------|
| A. 雙 root（預設） | `ATM_BENCH_ROOT_ATM` 與 `ATM_BENCH_ROOT_CONTROL` 兩份 fixture；`run_id` 相同、`mode` 不同子目錄 |
| B. 雙 run | 兩次 run（`run_id` 不同）但共享 `scenario_seed`；匯出時依 seed 對齊 |

論文對照最小要求：同一 `scenario_seed`＋同一參數網格，兩邊都有完整 events。

---

## 4. Skill 契約（廠商無關）

### 4.1 設計原則

- 一呼叫即可：**加入**（或若不存在則 **建立並啟動**）指定 `run_id` 的持續迴圈。
- Skill **無狀態、可重入**：不在進程內假設「只有我一個 agent」。
- 持續跑的主循環在 `atm-bench` daemon／worker；skill 是觸發＋註冊 agent＋可選「拉取下一任務／提交產出」。

### 4.2 對外介面（邏輯 API）

名稱暫定；實作為 Cursor／Claude／Codex 可載入的 skill／tool 描述。

#### `atm_bench_start`（或合併進 join）

| 參數 | 必填 | 說明 |
|------|------|------|
| `run_id` | 是 | 本次實驗 ID；多 agent 共用同一值即並行同一 run |
| `mode` | 是 | `atm` \| `control` |
| `scenario_seed` | 是 | 場景生成種子 |
| `params` | 否 | 見 §5.2；缺省用 run 已存 params |
| `agent_id` | 是 | 穩定 ID（建議 `vendor:session`） |
| `vendor` | 是 | `cursor` \| `claude` \| `codex` \| `other` |
| `duration` / `max_trials` | 否 | 停止條件；缺省用 run 設定或一直跑到 stop |
| `output_dir` | 否 | 覆寫預設 `runs/<run-id>/` |

行為：

1. 若 `runs/<run_id>/meta.json` 不存在 → 建立 run、生成／快照 Scenario、依 `mode` 啟動 worker 迴圈。
2. 若已存在 → **校驗** `mode`、`scenario_seed`、核心 params 一致，否則回錯（避免污染對照）。
3. 將此 `agent_id` 註冊進 `meta.agents[]`。
4. 回傳：`{ run_id, mode, agent_id, status: "running", next_hint }`。

#### `atm_bench_tick`（持續產資料的主呼叫）

多對話群可高頻並行呼叫。

| 參數 | 必填 | 說明 |
|------|------|------|
| `run_id` | 是 | |
| `agent_id` | 是 | |
| `proposal` | 否 | 模型產出的 patch／意圖正文；若空，worker 發下一筆 **預生成 intent** 給呼叫端「去寫」或 worker 用 mock 寫 |

行為（持續迴圈的一步）：

1. 領取或確認本 agent 當前 `trial`／`intent`（來自 Scenario 佇列，種子化洗牌）。
2. 若 `mode=atm`：經 ATM 提交 WriteIntent／寫入；記錄決策（碰撞、排隊、Composer…）。
3. 若 `mode=control`：直寫；記錄衝突／覆蓋／測試結果。
4. Append 一筆或多筆 event 到輸出目錄。
5. 回傳簡短結果給模型（可含下一 intent 摘要），模型可再呼叫 `atm_bench_tick`。

> **「只要呼叫 skill 就會自動開始不斷跑」** 的規格解釋：  
> - **最小實作**：`atm_bench_start` 啟動背景 worker，**即使無人 tick** 也用 mock／內建 writer 依 Scenario 持續產事件（適合 overnight）。  
> - **真模型並行**：各對話反覆 `atm_bench_tick` 提交提案，與 worker 併發，更有公信力。  
> 兩者共用同一落盤格式；`meta.writer = mock|llm|mixed`。

#### `atm_bench_status` / `atm_bench_stop`

- `status`：trial 數、事件數、各 decision 計數、是否達 `max_trials`。
- `stop`：優雅停止該 `run_id`（兩 mode 分開 stop）。

### 4.3 Skill 檔應告訴模型的固定話術（摘要）

1. 向使用者確認／讀取 `run_id`、`mode`、`scenario_seed`（或從環境預設）。
2. 呼叫 `atm_bench_start` 加入 run。
3. 迴圈呼叫 `atm_bench_tick` 直到 stop／額度結束；不要略過 ATM／control 閘道自行改檔。
4. 不要刪改 `runs/` 原始 JSONL。

---

## 5. Scenario 生成（可測資料來源）

### 5.1 Scenario 物件（邏輯）

```text
Scenario {
  scenario_id
  seed
  fixture_id
  intents: Intent[]          // 預生成、順序／並行標籤已知
  labels: expected_conflict_class per intent-pair or per intent
  oracle: test_command | file_hashes
}
```

`Intent` 至少含：`intent_id`、`agent_slot`、`paths`／atom refs、`rw_set`、`hot_or_cold_hint`（生成器標註，非模型自稱）、`payload_template`（可給 LLM 的任務說明）。

### 5.2 參數網格（`params`）

| 參數 | 說明 | 示例 |
|------|------|------|
| `n_agents` | 邏輯槽位數 | 4–8 |
| `hot_ratio` | 熱檔意圖比例 | 0.2–0.8 |
| `overlap` | RW 重疊強度 | low／med／high |
| `cold_policy` | `block` \| `queue`（atm mode） | queue（目標） |
| `trial_count` | 目標 trial 數 | 1000+ |
| `tick_interval_ms` | mock worker 節奏 | 50–500 |
| `composer_enabled` | 是否允許 Composer 路徑 | true／false |

生成器必須 **純函數**：`(fixture, seed, params) → scenarios` 可重現。

### 5.3 Ground-truth 標籤（事先可知）

每筆 intent（或 intent 對）帶 `expected_class`，例如：

- `no_conflict`
- `cold_block` / `cold_queue`
- `hot_provisional`
- `composer_cowrite`
- `cas_contention`
- `control_racy_write`（僅 control 預期）

執行後比對 `decision`／`outcome`，用於覆蓋率與行為一致性，不只看「測試過不過」。

---

## 6. 事件落盤與目錄

### 6.1 目錄結構（固定）

```text
<output_dir>/                          # 預設 ./runs
  <run_id>/
    meta.json                          # seed、params、atm_version、agents、mode 分頁或子目錄
    atm/                               # mode=atm
      scenarios/
      events/*.jsonl                   # append-only，可按小時或分片
      artifacts/
    control/                           # mode=control
      scenarios/                       # 應與 atm 同源快照（同 seed）
      events/*.jsonl
      artifacts/
    export/
      summary.json
      trials.csv
      decisions.csv
```

同一 `run_id` 下 `atm/` 與 `control/` 可先後或並行填滿（並行時兩 worker、兩 root）。

### 6.2 `meta.json`（必填欄位）

- `run_id`, `scenario_seed`, `params`, `created_at`
- `atm_version` / `cli_version`（control 可標 `atm: null`）
- `agents[]`: `{ agent_id, vendor, joined_at, mode }`
- `stop_conditions`, `writer` (`mock`|`llm`|`mixed`)
- `fixture_commit` / `fixture_id`

### 6.3 單筆 event（JSONL 一行）

| 欄位 | 說明 |
|------|------|
| `ts` | ISO8601，Asia/Taipei 或 UTC+Z（匯出時統一） |
| `run_id` | |
| `mode` | `atm` \| `control` |
| `trial_id` | |
| `scenario_id` / `intent_id` | |
| `agent_id` / `vendor` | |
| `expected_class` | 生成器標籤 |
| `decision` | ATM 決策碼；control 用 `direct_write` 等 |
| `wait_ms` | 排隊等待；無則 0 |
| `composer` | bool／細節 id |
| `serialized` | 是否實質串行化 |
| `outcome` | `commit` \| `reject` \| `timeout` \| `error` \| `test_pass` \| `test_fail` |
| `reason_code` | 穩定枚舉 |
| `atm_capability` | 實際冷檔行為等能力旗標快照 |

### 6.4 匯出（`atm-bench export --run-id`）

產出至少：

- 各 `mode` 的 trial 數、decision 直方圖、平均 `wait_ms`
- 整合／oracle 通過率
- atm vs control 對齊表（同 `scenario_seed`＋`intent_id`）
- 數據量統計：`events_total`, `bytes`, `duration`

論文表只從 `export/` 讀，不手抄。

---

## 7. 持續迴圈行為（詳細）

```text
loop until stop_conditions:
  1. 取下一個 Intent（種子化佇列；多 agent 競領用原子 claim）
  2. 可選：把任務說明回給呼叫中的 LLM（tick）
  3. 取得 proposal（LLM 或 mock patch）
  4. mode=atm → ATM admission → 可能 queue / composer / reject
     mode=control → 直接套用 proposal
  5. 可選跑 oracle 測試
  6. append event(s)
  7. 釋放 claim，繼續
```

**碰撞：** 兩 agent 同熱／同冷區 → 事件應出現對應 `decision`（atm）或 racy／overwrite（control）。  
**Composer：** ATM 允許共寫合成時，`composer=true` 並可附 artifact id。  
**排隊：** 冷檔 `cold_queue` 時記錄入隊、出隊、`wait_ms`。

---

## 8. 非功能需求

| 項目 | 要求 |
|------|------|
| 可重現 | 同 seed＋params＋fixture → Scenario 一致；ATM 決策在相同進入序下可複核 |
| 併發安全 | events append 與 intent claim 進程安全（檔案鎖或單 writer 佇列） |
| 效能 | mock 模式 ≥ 數十 tick／秒（本機）；真模型受 API 限制 |
| 安全 | skill 不得外洩其他 run 的資料；`output_dir` 限制在工作區 |
| 失敗 | ATM／檔案錯誤寫 `outcome=error`，不中斷整個 run（可設定 fail-fast） |

---

## 9. 驗收標準（功能）

1. 呼叫 skill `start(mode=atm)` 後，無人工干預下（mock）可持續寫入 `atm/events/*.jsonl`，出現排隊／碰撞／composer 等至少一類非平凡決策。
2. 同一 `scenario_seed` 呼叫 `start(mode=control)`，寫入 `control/events/*.jsonl`，且 **無** broker 決策欄（僅 direct_write 類）。
3. 兩個以上 agent_id 並行 tick，事件中出現 ≥2 個不同 `agent_id`／`vendor`。
4. `export` 產出 atm vs control 對照表與數據量摘要。
5. 重跑同 seed，Scenario 快照 hash 一致。

---

## 10. 實作分期（對齊 Plan P2–P4）

| 迭代 | 範圍 |
|------|------|
| FS-1 | 目錄／meta／event schema＋Scenario 生成＋mock worker（atm 閘道＋control 直寫）＋export |
| FS-2 | Skill 描述檔（泛用）＋`start`/`tick`/`status`/`stop` 接 CLI |
| FS-3 | 雙 root 並行、冷排隊能力旗標、多 vendor 文件 |
| FS-4 | Overnight 參數檔與匯出論文表模板 |

---

## 11. 明確不做

- Skill 內實作 Claim Plane JIT／ChangeIntent 時序權威。
- Control 模式走 ATM。
- 單一 orchestrator 假並行冒充多 agent。
- 未核准前自動 `npm publish`。

---

## 12. 變更紀錄

| 版本 | 日期 | 說明 |
|------|------|------|
| v0.1 | 2026-10-06 | 初稿：一 skill 雙 mode、持續迴圈、碰撞／Composer／排隊落盤、匯出對照 |

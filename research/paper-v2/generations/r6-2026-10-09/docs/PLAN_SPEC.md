# ATM 冷熱寫入准入實驗工具 — 整體計劃規格書（Plan Spec）

| 欄位 | 內容 |
|------|------|
| 文件狀態 | Draft v0.1 |
| 日期 | 2026-10-06（Asia/Taipei） |
| 產品 | ATM（AI-Atomic-Framework） |
| 目的 | 支撐 ATM 第二篇論文（實作深化／熱冷分級實證）的可重跑、大量、跨 agent 實驗資料 |
| 後續文件 | 功能規格（Functional Spec）：Scenario schema、Skill 契約、匯出 schema（另開） |
| 本文件不涵蓋 | 具體 API 欄位級定義、UI、npm 發佈流程 |

---

## 1. 背景與目標

### 1.1 問題

ATM v1 論文（arXiv:2607.00041）已提出 CID broker、atom／virtual atom、七層閘門等 pre-write admission。實作上已具備熱檔 provisional／composer、registry／CAS 等機制；公開敘事上仍偏「想法層」，對手系（Claim Plane）則以實驗數字強調可靠 vs 序列化 trade-off。

ATM 第二篇需要的不是再發明「時序權威／ChangeIntent JIT」，而是：

1. 把**已落地的冷熱分級**用可重跑實驗講清楚；
2. 證明「不必靠全域序列化換可靠」——尤其是**冷檔由快速擋住改為排隊**後的行為；
3. 資料必須大量、可種子化、可跨 AI agent 運行時並行產生，才有公信力。

### 1.2 本計劃要交付什麼

一套開源（或可公開複現）的 **ATM Hot/Cold Admission Harness**，包含：

| 元件 | 角色 | 是否需 LLM |
|------|------|------------|
| A. 衝突場景生成器 | 離線產生帶 ground-truth 標籤的 Scenario | 否 |
| B. 觸發 Skill（泛用） | 多個對話／跨廠商 agent 並行呼叫，對同一 fixture 真寫入 | 呼叫端是 LLM；ATM 決策不依賴 LLM |
| C. 執行與事件落盤 | 經 ATM broker／registry，事件寫入共用目錄 | 否（ATM 本體） |
| D. 匯出與聚合 | JSONL／CSV → 論文表／圖 | 否 |

**明確不做／不學：** Claim Plane 的 committed／contingent → JIT 晉升敘事作為 ATM 改進方向。對照組最多當「同時代系統」一句話，不作為實作藍本。

### 1.3 成功標準（計劃級）

- 同一組種子＋參數網格，任何人重跑可得統計上等價結果（允許 LLM 隨機性，但 admission 決策與事件 schema 確定）。
- 支援 **≥2 家** AI agent 運行時同時對同一 worktree 呼叫 skill（主實驗）；附錄可加第三家。
- 單次 overnight 可產 **數千～數萬** trial 事件列（視模型吞吐）；mock／規則 agent 模式可無模型跑通全管道。
- 輸出目錄結構固定，論文圖表只從匯出腳本產生，不手抄 log。
- 對照條件至少含：無 ATM／僅冷擋／冷排隊／完整熱檔（provisional＋composer）——具體矩阵見功能規格。

---

## 2. 使用模型（使用者想像的執行方式）

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Codex 對話群 │  │ Claude 對話群│  │ Cursor 對話群│  …（可再多）
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │ skill 觸發      │ skill 觸發      │ skill 觸發
       └────────────┬───┴────────────────┘
                    ▼
         ATM Hot/Cold Skill（無狀態、可重入）
                    ▼
         共用 fixture worktree + ATM broker
                    ▼
         runs/<run-id>/events/*.jsonl
                    ▼
         export → tables/figures
```

設計約束：

- **真並行**：不靠單一 orchestrator 假裝併發；衝突與排隊由 ATM 處理。
- Skill **無狀態、可重入**：每個呼叫只帶 agent-id、run-id、intent／scenario 片段；不在 skill 內鎖死「全局排程」。
- 跨廠商公信力：主實驗 **2 家即可**；說服力來自並發度 × trial 數，不是品牌堆疊。

---

## 3. 架構總覽

### 3.1 A — 衝突場景生成器（Scenario Generator）

**輸入：** fixture repo（或合成檔樹）＋參數（agent 數、熱檔比例、重疊 RW、冷檔密度、intent 規模、種子）。

**輸出：** `Scenario` 集合，每筆含：

- 多個擬定 `WriteIntent`（讀／寫 atom 或路徑區間）；
- **事先可知的衝突類別標籤**（cold-block、cold-queue、hot-provisional、composer-cowrite、cas-retry、no-conflict 等）；
- 期望的整合檢查（測試指令或 oracle hash）。

**原則：** 標籤先於執行存在 → 事後可算 precision／行為覆蓋，不是人工讀 log。

### 3.2 B — 泛用觸發 Skill

- 對外契約固定（廠商無關）：例如 `atm_bench_submit`／`atm_bench_tick`（名稱功能規格定）。
- 對內 adapter：各家 agent 只「呼叫 skill」；模型負責依意圖產生 patch／提案文字，**admission 不信任模型自述**。
- 自動將每次呼叫的請求／ATM 決策／寫入結果 append 到 `runs/<run-id>/`。

### 3.3 C — ATM 執行路徑

沿用現有 broker／registry／冷熱分級；本計劃假設：

- 熱檔路徑：provisional／composer 等既有機制（修 bug，不重發明）；
- 冷檔路徑：**目標行為改為排隊**（相對今日「快速擋住」）——實作可與 harness 同期或略後，但實驗對照必須能量測「擋 vs 排」。

### 3.4 D — 落盤與匯出

```
runs/<run-id>/
  meta.json          # 種子、參數、ATM 版本、參與 agent 清單
  scenarios/         # 本 run 使用的 Scenario 快照
  events/            # 每事件一行 JSONL（append-only）
  artifacts/         # 可選：patch、測試 log
  export/            # 聚合後的 CSV／摘要 JSON
```

事件最小欄位（計劃級）：`ts, run_id, trial_id, agent_id, vendor, scenario_id, intent_id, decision, wait_ms, serialized, outcome, reason_code`（精確 schema → 功能規格）。

---

## 4. 實驗設計（論文對齊，計劃級）

### 4.1 研究問題（暫定）

1. 冷檔「擋 → 排」是否在不損失整合成功率下降低無效拒絕／提高有效並行？
2. 熱檔 provisional＋composer 相對「一律序列化」或「無 ATM」，在衝突密度上升時的可靠／吞吐曲線？
3. 跨兩家 agent 運行時並行時，ATM 決策分布是否穩定（非單一客戶端假象）？

### 4.2 對照條件（最低集合）

| 條件 ID | 說明 |
|---------|------|
| `none` | 無 ATM（或 admission bypass） |
| `cold_block` | 現行冷檔快速擋住 |
| `cold_queue` | 冷檔改排隊 |
| `full_hot` | 冷排隊＋熱 provisional／composer |

### 4.3 規模建議

- 主實驗：2 vendor × N 並行對話（建議 4–8）× 參數網格 × 多種子；overnight 真模型。
- 管道驗證：mock agent 先跑通（無 API 成本）證明 schema／ATM 路徑。
- 不做：與 Claim Plane 同表硬比 JIT；不做「我們也有 contingent」敘事。

### 4.4 公信力清單

- [ ] 開源 harness＋固定種子說明
- [ ] 公開 fixture 與 ATM 版本 pin
- [ ] 原始 `events/*.jsonl` 可下載或附錄存放
- [ ] 匯出腳本一鍵重製論文表
- [ ] 標明 LLM 隨機性與 admission 確定性邊界
- [ ] Threats：fixture 規模、任務類型、模型校準

---

## 5. 與相關工作的邊界（寫進計劃，避免跑題）

| 系統 | 關係 | 本計劃態度 |
|------|------|------------|
| Claim Plane（2607.21909／2608.00947） | 同時代 pre-write；測可靠 vs 序列化 | 對照一句話；**不採用**其 ChangeIntent 時序權威作為 ATM 改進 |
| Cordon／Semantic Transactions 綜述 | OS／effect outbox；文中已引 ATM 管 repo 共寫 | 互補層；本 harness **不管**外部支付／網路出盒 |
| ATP／Mnemosyne | Proposal Non-Authority | 非本實驗範圍 |

ATM v2 論文貢獻縫：**分級准入已落地 + 冷檔排隊 + 大量可重跑實證**，不是「又一個 admission 想法」。

---

## 6. 交付階段

| 階段 | 交付物 | 出口條件 |
|------|--------|----------|
| P0 | 本 Plan Spec 定稿（本文件） | 你確認目標／邊界／使用模型 |
| P1 | Functional Spec（Scenario、Skill 契約、事件／匯出 schema、對照開關） | 可據此實作不歧義 |
| P2 | Scenario 生成器＋mock 驅動＋落盤／匯出（無真模型） | 一條管道 end-to-end 綠 |
| P3 | 泛用 Skill＋至少 2 家 agent 呼叫說明；冷排隊對照可跑 | 雙對話並行寫入同一 fixture 有事件 |
| P4 | Overnight 真模型跑數 + 匯出表草稿 | 足夠論文主表的 trial 數 |
| P5 |（可選）冷排隊實作修 bug／PR；論文大綱對齊數據 | 機制與數字一致 |

**代碼能力說明：** 計劃與規格寫完後，實作可走本機／PR；先前限制主要是 Cursor Cloud Agent **用量額度**，不是「不能寫代碼」。若 Cloud Agent 仍 blocked，改以本機實作或你指定的 repo 工作流。

---

## 7. 風險與假設

| 風險 | 緩解 |
|------|------|
| 真並行被 OS／編輯器鎖檔扭曲 | fixture 與寫入路徑經 ATM；記錄 OS 錯誤碼；必要時用 ATM worktree 策略 |
| Skill 在不同 agent 的掛載方式不一 | 對外契約極簡；各家 README 一段「如何安裝／呼叫」 |
| LLM 產出 patch 品質差導致「機制看起來很差」 | 分層：機制指標（決策／排隊／合成）與任務 pass 分開報；mock 補機制覆蓋 |
| 冷排隊尚未改完 | 對照組先量測現況 cold_block；P3／P5 再切 cold_queue |
| 數據量巨大 | append-only JSONL＋按 run 分片；匯出只讀需要欄位 |

---

## 8. 非目標（本計劃明確排除）

- 實作 Claim Plane 式 contingent → JIT 晉升以「對齊論文」。
- 取代 Cordon effect outbox／支付類不可逆副作用。
- 單一中央 scheduler 模擬多 agent（那會喪失公信力）。
- 未確認前發佈 npm 或對 ATM 主線擅自大改（實作以 PR／你指定分支為準）。

---

## 9. 下一步（等你確認後）

1. 你對本 Plan Spec 的目標、邊界、2-vendor 並行模型若 OK → 開 **Functional Spec**。
2. Functional Spec 定 Scenario／Skill／事件 schema 後 → P2 mock 管道實作。
3. 論文大綱可與 P1 平行起草，但主表欄位以匯出 schema 為準。

---

## 10. 變更紀錄

| 版本 | 日期 | 說明 |
|------|------|------|
| v0.1 | 2026-10-06 | 初稿：三層產資料、跨 agent skill、冷排隊對照、與 Claim Plane／Cordon 邊界 |

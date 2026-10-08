# A2 — 指標分母定義（可執行；繁中）

| 欄位 | 內容 |
|------|------|
| 產出 | A2（對應審閱表 8／§十；`EXPERIMENT_CHECKLIST.md`） |
| 日期 | 2026-10-07（Asia/Taipei） |
| 依據 | `ATM_PAPER_V2_FEASIBILITY_REVIEW.md` §十表 8、§事件欄位（約 L285–289）、`COMPOSER_STEWARD_IMPL_PLAN.md` |
| 原則 | 主表必須**同時**報 offered、eligible、committed、correct、blocked、retry-exhausted、unresolved，以及 goodput／延遲。分母為 0 → 標 **N/A**，**禁止填 0%** 當安全成果。 |

---

## 0. 先決詞彙

### Logical operation vs attempt

| 詞 | 定義 | 計數規則 |
|----|------|----------|
| **Logical operation** | 實驗預先登記的一筆「意圖單元」：有穩定 `logical_id`、目標語意效果（oracle 可檢）、初始／重提時的 base／patch digest。對應「使用者／agent 想完成的一次編輯」。 | 每個 `logical_id` 在整 run **最多計一次**「有效完成」（correct／committed 等成功類）。取消、超時、未處理**不得**從 offered 分母消失。 |
| **Attempt** | 針對某一 `logical_id` 的一次具體試寫／合成／commit 嘗試（含首次與 re-propose／retry）。有獨立 `attempt_id`。 | **Attempted** = 所有 attempts 之和；retry 增加 attempted，不增加 offered。 |

**禁止誤用**：把同一 process 內高度相關的数百 intents 當獨立樣本去縮 CI；把 retry 次數加進 offered；把「沒跑到的 logical」從分母刪掉。

### Batch closure（合成窗關閉）

每個 compose／steward batch 必須在規格中固定：

1. **關閉條件**：時間窗（ms）或數量閾值（N proposals／檔），或兩者取先到。
2. **Late joiner**：**凍結＝新 batch**（關閉後抵達同檔 proposal 開新窗；見 `STEWARD_WRITER_C2.md`）。不採 blocked／re-queue。
3. **排程責任**：**凍結＝harness `ComposeWindowManager`**（非 ATM core）。
4. **事件**：關閉當下寫出 `batch_id` 與成員 `attempt_id` 列表。

Window = 0 表示「每提案立即單件 batch」（仍要有 `batch_id`）。

---

## 1. 指標定義表（審閱表 8 → 可執行）

### 1.1 offered

| 項 | 內容 |
|----|------|
| **分子** | —（計數本身） |
| **分母／量測** | Run 開始前（或 workload 生成時）預先登記的 **唯一** `logical_id` 個數。 |
| **何時適用** | 所有臂、所有主表與附錄率的共用分母之一。 |
| **禁止誤用** | 勿用「實際送進 broker 的次數」；勿在跑到一半因 timeout 縮小 offered；勿把 diagnostic 臂的 synthetic ops 混進主臂 offered 卻不重標。 |

### 1.2 attempted

| 項 | 內容 |
|----|------|
| **分子** | — |
| **分母／量測** | 該 run 內所有 `attempt_id` 的個數（含成功、blocked、rollback、timeout、crash 後可見的終端與非終端嘗試；至少所有曾發出 proposal／apply 的嘗試）。 |
| **何時適用** | 報 retry 成本、receipt completeness、每 attempt 延遲。 |
| **禁止誤用** | 勿與 offered 互換；勿只計「成功 attempt」。 |

### 1.3 eligible coverage

| 項 | 內容 |
|----|------|
| **分子** | 依**預先登記、獨立於受測方法**的政策判定為「該臂／該契約應可處理」的 logical operations 數。 |
| **分母** | offered。另可報 eligible／offered 本身。 |
| **何時適用** | 比較「政策接受集合」不同的臂（如 Git 允許 context 重疊而 ATM 拒）；報 false rejection 的前提。 |
| **禁止誤用** | **不得**用受測 composer／ATM 自己的 accept／reject 結果回頭定義 eligible（循環定義）。政策變更必須換 `policy_id` 並重算，不可事後改分母。 |

### 1.4 commit rate

| 項 | 內容 |
|----|------|
| **分子** | 唯一 `logical_id` 中，曾收到**有效 commit acknowledgement**（檔案／CAS／收據確認寫入成功，且該效果進入 canonical 狀態）的個數。 |
| **分母** | 主報：**committed／offered**。輔報：**committed／eligible**。 |
| **何時適用** | 所有寫入臂；拒寫／只讀診斷臂標 N/A 或另定義。 |
| **禁止誤用** | 准入（admission）成功 ≠ committed；compose `parallel-safe` ≠ committed；throw 後無收據 ≠ committed。 |

### 1.5 correct completion

| 項 | 內容 |
|----|------|
| **分子** | 唯一 `logical_id` 中，同時滿足：(a) 有有效 commit（若該臂需要寫入）；(b) **獨立 oracle** 判定效果保留／精確輸出／必要語意檢查通過；(c) 無違反 frame property（如不該出現的重複插入）。 |
| **分母** | offered（主）；輔報 correct／eligible、correct／committed。 |
| **何時適用** | 主結果正確性；RQ1／RQ2。 |
| **禁止誤用** | **禁止**只用 marker 字串是否存在當唯一裁判；marker 在仍可能錯位／重複；marker 不在也可能是後續合法刪除。 |

### 1.6 lost among committed

| 項 | 內容 |
|----|------|
| **分子** | 在「已被 acknowledged commit、且未被後續**合法**操作取代」的應存效果中，終態遺失（oracle 找無／被覆蓋且非合法後續）的個數。 |
| **分母** | 上述「應存效果」數（通常 ⊆ committed 效果集合；多效果／logical 時按效果計並在表註說明）。 |
| **何時適用** | 併發覆寫、stale writer、順序相關合成失敗後仍「看似 committed」的臂。 |
| **禁止誤用** | **Reject-all → 0 lost 不可當安全主結果**（分母／機會為 0 或未 commit）。必須同時報 offered／eligible／correct／blocked。勿把「從未 commit」算進 lost among committed。 |

### 1.7 eligible missing

| 項 | 內容 |
|----|------|
| **分子** | 到 **retry／run deadline** 仍未 **correct completion** 的 eligible logical operations（含：blocked 未恢復、timeout、retry exhausted、unresolved、crash 未復原）。 |
| **分母** | eligible（預先登記）。 |
| **何時適用** | 覆蓋率／完成度；與 commit rate 互補。 |
| **禁止誤用** | 勿把 ineligible 失敗算進來膨比率；勿在 deadline 後才完成的算 correct 卻仍留在 missing（雙重計算需有規則：以 deadline 截斷為準）。 |

### 1.8 unsafe acceptance

| 項 | 內容 |
|----|------|
| **分子** | 獨立 oracle／政策判定**應拒絕**，但系統卻 **committed**（或寫入 canonical）的案例數。 |
| **分母** | 獨立判定為「應拒絕」的案例數（該 run 或該套件固定集合）。 |
| **何時適用** | 重疊衝突、identity 違規、stale base、政策禁寫。 |
| **禁止誤用** | 分母為 0 → N/A，不可報 0%。勿用受測系統的 blocked 集合當「應拒絕」定義。 |

### 1.9 false rejection

| 項 | 內容 |
|----|------|
| **分子** | 依**指定獨立政策**本可安全合成／提交，卻被系統拒絕（blocked／throw／admission deny）的案例數。 |
| **分母** | 該政策允許（eligible ∩ 應接受）的案例數。 |
| **何時適用** | 與 Git／lock 等比對接受集合差異時；context 重疊政策消融。 |
| **禁止誤用** | 政策 A 的 false reject 不可直接與政策 B 的成功率比；須分開列「政策差異」與「執行失敗」。 |

### 1.10 receipt completeness

| 項 | 內容 |
|----|------|
| **分子** | 具**完整可對帳收據**的終端 attempts（含成功與失敗理由碼、digests、actor；系統 crash 後仍應有 recovery 收據或明確 `recovery-required` 記錄）。 |
| **分母** | 全部終端 attempts（含 crash 中斷後判定為終端者）。 |
| **何時適用** | 治理／可觀測性主張；故障注入。 |
| **禁止誤用** | 勿只抽樣成功路徑；throw 且無結構化收據計為不完整。 |

### 1.11 goodput（與尾延遲）

| 項 | 內容 |
|----|------|
| **分子** | correct completion 的 logical operations 數。 |
| **分母／量測** | **wall seconds**（端到端：排隊＋window＋retry＋驗證＋commit）。另報 throughput intents/s 時須標是否含 failed。 |
| **延遲** | 每 logical（或每 attempt）的 e2e 延遲；報 p50／p95／p99；跨 process 須固定 timebase。 |
| **何時適用** | RQ2／成本；與正確性表分開，避免「快但全丟」。 |
| **禁止誤用** | 用 wait=0 的 loop 臂當「原生 queue 成本」；用 marker-only pass 當 correct 再算 goodput。 |

### 1.12 write authority

| 項 | 內容 |
|----|------|
| **分子** | 監測期間，**proposer／非中立 actor** 對 canonical 路徑的直接寫入次數（違規寫）。 |
| **分母／量測** | 附：**監測途徑**（syscall／FS watch／agent 包裝 API）、**覆蓋率**（監測到的寫入／估算總寫入）、監測起迄。 |
| **何時適用** | 「提案者不能直接寫檔」主張；S3／identity gate。 |
| **禁止誤用** | **不以「零事件」單獨當權限證明**（可能沒監測到）。零違規必須同時報覆蓋率與監測方法；覆蓋不足標 caveat。 |

---

## 2. 主表必報集合（防 reject-all 假安全）

每個實驗格子至少輸出整數：

`offered, eligible, attempted, committed, correct, blocked, retry_exhausted, unresolved, unsafe_accept, false_reject`

衍生率一律附：**分子、分母、aggregation**（ratio-of-sums vs mean-of-per-run-ratios）。舊 T6／R1 重算見 A4。

---

## 3. Batch closure 最低事件欄位

每一筆 attempt／batch／commit 事件（JSONL 或等價）**至少**含：

| 欄位 | 說明 |
|------|------|
| `run_id` | 一次 matrix cell 執行 |
| `logical_id` | 唯一邏輯操作 |
| `attempt_id` | 該 logical 的第 k 次嘗試 |
| `batch_id` | compose／apply 批次（window=0 仍要有） |
| `base_digest` | 合成／寫入前檔或 tree digest（如 `fileBeforeHash`／commit） |
| `patch_digest` | proposal／patch 內容 digest |
| `output_digest` | 寫入後（或 blocked 時省略並標 `written=false`） |
| `actor` | proposer／steward id；另記 `pid`／process 角色 |
| `reason` | admission／blocked／commit／timeout／rollback 等 reason code |
| `timestamp` | 單調或可比較時間戳；跨 process 註 timebase |
| `sha`（或 `atm_sha`／`harness_sha`／`oracle_sha`） | 該 run 綁定的版本錨（見 `VERSION_ANCHORS.md`） |

可選但建議：`verdict`、`policy_id`、`eligible`（bool，來自預先登記）、`commit_ack`（bool）。

---

## 4. 與舊 harness 數字的關係（提醒）

- 既有 `runs/*` 的 pass／lost／commits 多半是 **marker／sync-writer 語意**，**不等同**本文件的 correct／lost-among-committed。
- 引用舊表時必須標「舊分母／舊 oracle」；主貢獻表須在 A5 封包＋本定義下重跑。

## 5. Harness `logical_id` 實作註（2026-10-07）

- 自 gaps 起：`src/scenario.mjs` 為每 intent 預登記 `logical_id = log:{scenario_id}:i{k}`，**字串不等於** `intent_id`。
- E1／E2 歷史 cells 仍為 stub（`logical_id === intent_id`）；**不**據此作廢 DRAFT 表。詳見 `runs/steward-writer/STEWARD_WRITER_GAPS.md`。

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
| **r2 實作（2026-10-08）** | oracle v2 `c4-fullbytes-frame-v2`（`src/oracle_v2.mjs`）：由不可變 base＋已提交操作（insert／replace／delete，依 commit 順序）以 oracle 自有 reference applier 產生**期望全 bytes**；structure（base 的 region 標籤須全在、順序不變）；frame（移除授權 payload 行後須與期望骨架逐位元相同）；合法刪除／取代判 `superseded`（不算 lost）。授權插入行只允許在**自己的 region 內**換序（跨 batch commit 順序不屬契約），`full_bytes_exact` 另報嚴格比較。契約案例：`test/oracle_v2_contract.mjs`（6 類＋對照，全過）。r1 的 c3 presence oracle 對 C1／C3／C5a／C6 判錯。 |

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

## 6. r3 新增口徑（2026-10-08 CST；ATM PR #213 驗證）

| 名稱 | 定義 | 來源 |
|---|---|---|
| re-compose 事件 | 一個 batch 的 ATM canonical commit guard 被抵達且 base 不符：觀察為 `atm_commit_attempts ≥ 2`（重合成後成功）或 `≥ 1` 且最終 `blocked`（重合成後仍未提交） | harness 觀察 seam（`src/steward-writer.mjs` `commitGuardObs`：計數 `mkdir <lockRoot>/<sha256>` 成功次數與 EEXIST 輪詢；不改變行為；5692474f 恆為 0） |
| 非完成（non-completion） | offered − correct − 失敗 ops；全部以 `blocked` 結束者依最終理由分類（`file-hash-drift`、`steward-final-patch-required`、未上鎖 stale 檢查、`re-compose→<重合成理由>`、`re-compose:`／`recovery-required:` 前綴）。**計入 goodput 分母（offered）、不計入 correct** | `analysis/r3_compare.py` |
| 完成 intent（completed） | ATM 回 `applied` 且 oracle v2 判定其效果確實存在於最終 bytes 的 intent；報告為「完成／總 intents」，不得改稱「成功率」或「全部成功」 | oracle v2 |
| 遺失效果（lost effect） | ATM 回 `applied`（已 ack）但 oracle v2 判定其效果不在最終 bytes 的 intent；以「合計 N 個遺失效果」計數，**不是**失敗次數（例：r3 old 臂「75 次重播中 8 次 run 失敗，合計遺失 12 個效果」） | oracle v2 |
| blocked intent | 以 `blocked` 結束的 intent（含 re-compose 後仍未提交者）；與遺失效果分開報告，並依最終理由分列；恆等式：完成＋遺失效果＋blocked＝總 intents | ATM 公開結果＋harness 觀察 seam |
| 失敗 runs／總 runs | 依下一列 failed run 定義計數之 run 數比；與遺失效果分開報告（一個失敗 run 可含多個遺失效果） | oracle v2 |
| 非劣性措辭 | 完成數未下降僅可寫成「本次觀察中未下降」；未做預先設定界限的非劣性檢定前，不得寫「不劣於」或「已證明不劣」 | 2026-10-08 13:51 作者與外部審閱者協議 |
| failed run | 任一 op 的 v2 判定為失敗，或任一檔 frame／structure 違規、foreign write、多餘檔（例如殘留 `*.atm-tmp`） | oracle v2 artifact-only rescore |
| 損壞檔 | frame 或 structure 違規檔（含撕裂尾端） | oracle v2 |
| 延遲分位數 | 線性插值（numpy `linear`）；per-intent `total_ms`（submit→done）、`apply_ms`、per-run `wall_clock_ms`；mean±sd 不是 CI | `analysis/r3_compare.py` |
| `interleave_suspect` 語意變更 | 5692474f：收據 `beforeHash` 為寫前重讀值，≠合成前讀值＝有人插入。bea35380：收據 `beforeHash`＝合成 base，故此特徵在新 pin 只是提示（r3 fix 臂 4 次，皆無遺失）；正確性一律以 oracle v2 判定 | `src/steward-writer.mjs` |

## 7. r4 新增口徑（2026-10-08 CST；ATM PR #214 驗證）

| 名稱 | 定義 | 來源 |
|---|---|---|
| transactional 嘗試次數（`atm_tx_attempts`） | 一個 batch 進入 ATM transactional apply 迴圈的次數；以 ATM 轉送的 `commitHooks.beforePrecheck` 觀察（只計數、不改行為；bea35380／5692474f 不轉送，恆為 0） | `src/steward-writer.mjs` `txAttemptObs` |
| 嘗試次數（attempts） | max(`atm_tx_attempts`, 提交鎖取得次數)。2118bc66 的早期 stale 不取鎖，只計鎖會低估，故取兩者最大值；「0 次」＝在計畫／合成階段即 blocked | `analysis/r4_compare.py` |
| re-compose 事件（r4） | attempts ≥ 2，或 attempts ≥ 1 且最終 `blocked` 且理由為 re-compose 系列 | 同上 |
| re-compose 成功 | re-compose 事件中最終 `applied` 者（attempts ≥ 2）；以 batch 計，另報 intents 數 | 同上 |
| 重試用盡 | 理由以 `re-compose attempts exhausted after N of M` 開頭的 blocked；與 `recovery-required:` 分開列 | ATM 公開理由 |
| blocked 細分（2118bc66） | `steward-final-patch-required` 依理由文字再分「同批次行號重疊」「區域錨定列已改」「同批同區域」；re-compose 之後者另列 | `analysis/r4_compare.py` |
| 逐 run 配對 | 同 seed／配置／rep 的兩臂完成數比較，報「較高／相同／較低」對數與合計差；**描述性，不是顯著性檢定** | 同上 |
| 反例（§5.7） | E4、barrier 或故障情境中任何遺失效果或損壞檔；不以完成率提升抵銷（r4：F6 跨 PID namespace） | 2026-10-08 協議 |

## 8. r5 新增口徑（2026-10-08 CST；ATM PR #216 驗證）

| 名稱 | 定義 | 來源 |
|---|---|---|
| 鎖取得（owner 寫入） | 37847584 的鎖目錄以遞迴 mkdir 建立，mkdir 計數恆為 0；改計 `steward-commit-locks/<64hex>/owner` 的寫入次數（`atm_commit_owner_writes`），所有有提交鎖的 pin 一致適用 | `src/steward-writer.mjs` |
| 嘗試次數（r5） | max(`atm_tx_attempts`, 鎖 mkdir 次數, owner 寫入次數) | `analysis/r5_compare.py` |
| 實際生效環境（`atm_env`） | 每個 steward batch 記錄的 `ATM_STEWARD_*` 變數；逐 run 檢查與臂設定一致（`env_mismatch`）。只檢查帶此欄位的 steward-writer batch（git_three_way 等不經 ATM steward apply） | 同上（v2） |
| 例外未完成（exception-blocked） | ATM `applyStewardPlan` 拋出例外而 harness 記為 blocked 的 intents（例：`ERR_SQLITE_ERROR`）；未寫入、計入 blocked，不計入遺失 | 同上 |
| Wilson 95% 區間 | 完成 intents／總 intents、失敗 runs／總 runs、遺失效果／總 intents 的 Wilson score 區間（z＝1.96）；描述性，intent 在 run 內不獨立，區間偏窄 | 同上 |
| 跨 namespace 確認（`ns_split_confirmed`） | 子程序 `/proc/self/ns/pid` 與 host 不同，且 namespace 內 pid＝1；F6／O2 每次記錄 | `test/r5_fault_scenarios.mjs` |
| 持鎖下清理（`owner_writes_so_far`） | 寫入者刪除非自己建立之 `*.atm-tmp` 時，已寫入 owner 檔的次數；≥1 表示刪除發生在取得鎖之後 | 同上 |
| 時段參照臂 | 同一設定在不同時段重跑（nq vs nqref），其差作為時段間變動的參考幅度；臂間差異對照此幅度閱讀 | DEVIATIONS D3 |

## 9. r6 新增口徑（2026-10-09 CST；ATM PR #238 驗證）

| 指標 | 定義 | 來源 |
|---|---|---|
| SQLITE 例外 intents | batch 的 `blocked_reason`／`blocked_reasons` 含 `SQLITE_BUSY`、`SQLITE_LOCKED`、`database is locked`、`database table is locked` 或 `ERR_SQLITE` 者，其 intents 數；另計受影響 runs | `analysis/r6_compare.py` |
| presence 殘留 | run 結束後 `atm/worktree/.atm/runtime/broker-steward-apply-queue/*/p/` 下的檔案數 | `analysis/r6_compare.py` |
| 壓力重現拋出次數 | `queue_busy_repro.mjs` 每個 process 回報的例外次數加總；presence 殘留＝暫存 repo 中 `p/` 下檔案數 | `runs/r6-validation/forensics/sqlite-busy/` |
| block | E4 重播 block1＝r5 原 rep 編號（exact r01–r30、grid r1–r5）；block2＝同配置續編（exact r31–r60、grid r6–r10） | `analysis/r6_compare.py` |

## 10. HIST 新增口徑（2026-10-10 CST；外部真實 PR 工作負載）

| 指標 | 定義 | 來源 |
|---|---|---|
| intent（HIST） | `git diff --unified=0 --diff-algorithm=histogram` 的每個 hunk；`logical_id = log:{pair_id}:{pr}:{path}:h{k}` | 預先登記 v1.0 §3.4 |
| 完成／總 intents | 已提交且 oracle 判定效果正確存在的 intents ÷ 總 intents（ratio of sums）；恆等式 完成＋遺失＋blocked（＋misplaced＋duplicate＋leak）＝總 intents 逐 run 驗證 | `analysis/analyze_main.py` |
| 失敗 run | oracle_v2-hist 對該 run 回報 `run_failed`（例如有遺失效果或損壞檔）；harness 錯誤的 run 不計入（HIST 主跑 v2 為 0） | 同上 |
| 損壞檔 | 最終 bytes 違反 frame 規則（base 上不屬於任何已提交操作的行未逐位元保留或順序改變）的檔 | oracle_v2-hist |
| blocked 最終理由分類 | harness_relocation（共用 harness 精確重新定位失敗，未呼叫 ATM；含 12 個重疊或重排停止）、atm_hash_drift、atm_recompose_mismatch、new_file（ATM steward 不能建立新檔）、git_merge_conflict、git_base_drift | 同上 |
| 分層 | O1 hunk 範圍相交或相鄰；O2 最小距離 1–3 行；O3 >3 行；O0 無共同原始碼檔 | 預先登記 v1.0 §3.3 |
| writer_version | final（最終合併版本）／pre-rebase（v1.1 選項 P：對方合併前、rebase 前的最後 head） | 預先登記 v1.1 §1 |
| 完成率 CI | 以配對為單位的 bootstrap 95% 區間；失敗 runs 與失敗配對另列 Wilson 95% 區間，0 時加 Clopper–Pearson 上界 | `analysis/analyze_main.py` |
| 語意終點 | STALE 方法：每個條件跑同一組聯集測試；歸因於臂的回歸＝臂最終樹失敗、但 b+A、b+B、gold 合成皆通過的測試；只用於兩寫入者皆 final 且 base valid 的配對；含 blocked intent 的 run 不可評估；pre-rebase 配對標「不可評估」不計 0 | `semantic/semantic_multi.py` |
| 修正前後 | 同配對、同 seed、同 harness 的重疊 runs 逐 run 對比（Django＋SymPy 2,500 runs）；描述性 | `analysis/before_after.py` |

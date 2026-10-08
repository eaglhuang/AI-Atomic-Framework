# Evidence generation r4-2026-10-08

狀態：**DRAFT 證據**。論文仍為 DRAFT，**不主張任何勝出**。r4 是 ATM PR #214（steward 完成率最佳化）的驗證回合，不是主結果矩陣；論文 **Phase 3（450-run）主矩陣仍未執行**。
所有 r4 數字皆為**作者自行執行、未經獨立重現**。

ATM pin（皆以 commit SHA 參照並另行安裝，唯讀，不打包原始碼樹）：
- r4 驗證 pin：`2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`（PR #214 merge；feature `b5729456bc14d9bf4c8acfce7be320fec691fee2`；base main `8b3622b7`）。
- 對照 pin：`bea35380d7f381f998c9930fa95f01b999c7f208`（PR #213；r3 驗證 pin）與 `5692474f7db70ab52a7a71c8af4867609e7e4b43`（修正前）。

產生時間：2026-10-08（Asia/Taipei）；r4 runs 14:37:46–14:54:55，before-precheck barrier v2 重跑 14:58:07–14:58:22。r1、r2、r3 generation 未修改（見 `PRIOR_REFERENCES.md`）。

## 1. 如何驗證／重建

| 指令 | 行為 | 是否寫入 |
|---|---|---|
| `sh verify.sh`（本目錄） | `sha256sum -c --strict` 對照本目錄 `SHA256SUMS`；若以兩個 part 上傳，需兩個都解壓到同一路徑後再驗證 | 否，嚴格唯讀 |
| `harness/reproduce.sh analyze <新空目錄>` | 只讀 raw（r1–r4）：contract test、oracle v2 重評分、E4 鑑識、表重建、cell index（1,723 cells）、logical_id 稽核、r3 比較、**r4 比較（`analysis/r4_compare.py`）**、r1 extractor 比對；前後 raw 指紋相同才算成功 | 只寫入 OUT |
| `harness/runs/r4-validation/run_r4.sh` | 重跑 r4（barrier→replay→matrix→regression→faults）；拒絕覆蓋既有 `r4*` run；需三個 ATM pin（`PINS.json`） | 只寫入新 run |
| `node harness/test/barrier_interleave.mjs --mode seam\|stale-proposal\|before-precheck --atm <tree> --out <dir>` | 確定性 2-process 交錯 | 只寫入 out 與暫存目錄 |
| `node harness/test/r4_fault_scenarios.mjs --pins "<名>=<tree>,…" --out <dir>` | 故障情境 F1–F6（F6 需 `unshare -Urpf --mount-proc`） | 只寫入 out 與暫存目錄 |

r4 新 raw（deterministic tar＋`gzip -n`）：`raw/r4-replay-pins.tgz`（old／fix／opt 225 runs）、`raw/r4-replay-secondary-ablation.tgz`（optlock／optr0／optr1 225）、`raw/r4-matrix.tgz`（63）、`raw/r4-regression.tgz`（180）、`raw/r4-stdout.tgz`（每 run stdout／stderr）。barrier 與故障情境的逐 rep 結果在 `summaries/runs/r4-validation/{barrier,faults}/`。

## 2. 與 r3 的差異

**Harness 程式**（完整 diff：`harness/R4_CHANGES.patch`，相對封存的 r3 harness）
- `src/steward-writer.mjs`：
  - 觀察 seam 的鎖路徑 regex 一般化為 `steward-commit-locks[\\/][0-9a-f]{64}$`，可同時對到 bea35380 的 tmp 鎖與 2118bc66 的 repo 鎖。不改的話，seam 會落在鎖內而 deadlock。
  - 新增 `txAttemptObs`，經 ATM 轉送的 `commitHooks.beforePrecheck` 計數 transactional 嘗試次數；只觀察，舊 pin 恆為 0。
  - 環境變數 `ATM_BENCH_RECOMPOSE_POLICY`（JSON）轉為公開輸入 `recomposePolicy`，只用於消融臂。
  - batch 欄位新增 `atm_tx_attempts`、`recompose_policy`。
- `test/barrier_interleave.mjs`：
  - 新增 `--mode seam|stale-proposal|before-precheck`。
  - before-precheck v2 讓 leader 等 follower 進入檢查點後才提交；v1 結果作廢，保留為 `superseded-v1-*`。
  - 新增 `blocked_re-compose_exhausted` 與 `blocked_after_re-compose(steward-final-patch-required)` 兩個分類。
- `test/r4_fault_scenarios.mjs`（新）：F1 持鎖者 SIGKILL、F2 偽造 owner、F3 存活持鎖逾時、F4 不同 TMPDIR、F5 重試用盡、F6 不同 PID namespace。
- `analysis/r4_compare.py`（新）；`analysis/cell_index.py` 新增 r4 封存對應；`analysis/rescore_oracle_v2.mjs` 新增 r4 stage；`tools/analyze.sh` 新增 r4 比較步驟。
- `runs/r4-validation/{run_r4.sh,pin_record.py}`（新）；`REPRODUCE.md` 新增 r4 節。

**文件**（相對 r3 同路徑；完整文字 diff：`docs/r4-notes/TEXT_CHANGES_r3_to_r4.diff`）
- 2026-10-08 13:51 的「分列指標」措辭修訂（原未封存）納入本 generation；單獨 diff：`docs/r4-notes/paper-edits-2026-10-08-1351-table-split.diff`。
- `paper/ATM_PAPER_V2_DRAFT_zh.md`：
  - frontmatter 追加 r4。
  - §1.5 新增 r4 條目。
  - 表 V1 新增 PR #214 列。
  - §4.11 改寫為實際設計、各項狀態與可消融性（broker 佇列標明未實作）。
  - §6 表 R4 由預留改為完整 r4 結果；r1–r3 文字保留。
  - §7.1 新增 r4 強度上限，§7.3 第 0 項更新。
  - 參考文獻：r3 時重複的編號 [6]（PR #213）改為 [20]，新增 [21] PR #214。
- `tables/F2_CORRECTNESS_TABLES.md`：表 A 新增 r4 列，表 A-r4 填入。
- `docs/METRIC_DEFINITIONS.md` §7（r4 口徑）、`docs/VERSION_ANCHORS.md`（r4 節）、`docs/EXPERIMENT_CHECKLIST.md`（r4 列；Phase 3 仍未做）。

**摘要**
- 新增 `summaries/runs/r4-validation/`：PINS.json（三 pin）、ATM core 與 tests diff、r4.log、barrier、faults。
- 新增 `summaries/runs/r4-analysis/r4-2026-10-08/`：analyze 標準輸出，含 `r4-compare/R4_TABLES.md`。
- r3-analysis 不再攜帶，由 r4-analysis 以同一管線重算（其中含 `r3-compare/`）；r3-validation 摘要原樣保留。

**來源註記**
- 所有 replay 臂逐 run 交錯，同時段、同機器；回歸逐格 fix→opt。
- runtime oracle 與 artifact-only oracle v2 在 693 個 r4 cell 上 0 改判。
- run 後三 pin core 樹 hash 不變；2118bc66 解壓樹與 tarball 0 差異。

## 3. 主要結果（事實；分列，不合併）

| 臂 | 完成／總 intents | 失敗 runs | 遺失效果 | blocked | 損壞檔 | re-compose 事件／成功 | wall mean／p95 ms |
|---|---|---:|---:|---:|---:|---|---|
| old 5692474f | 1,580／2,610（60.5%） | 5／75 | 6 | 1,024 | 0 | — | 594.7／718.7 |
| fix bea35380 | 1,553／2,610（59.5%） | 0／75 | 0 | 1,057 | 0 | 16／2 | 583.9／722.4 |
| **opt 2118bc66** | **1,748／2,610（67.0%）** | **0／75** | **0** | 862 | 0 | 91／24 | 597.1／738.7 |
| optlock（harness 鎖 on） | 1,841／2,610（70.5%） | 0／75 | 0 | 769 | 0 | 0／0 | 712.0／1,002.3 |
| optr1（重試 1、無退避） | 1,752（67.1%） | 0／75 | 0 | 858 | 0 | 104／33 | 601.3／718.2 |
| optr0（重試 0） | 1,718（65.8%） | 0／75 | 0 | 892 | 0 | 85／0 | 605.3／743.5 |

- opt 剩餘 blocked 全為 `steward-final-patch-required`：同批次行號重疊 181、區域錨定列已改 479（另 81 發生在 re-compose 後）、同批同區域 121。`file-hash-drift` 785→0、未上鎖 stale 68→0。
- 每 batch 最多 2 次嘗試，(c) 的第 3–5 次嘗試與退避在 E4 未觸發。
- 逐 run 配對（描述性）：opt 對 fix 55 高／6 同／14 低。場次間差參考：fix r3 1,524 → r4 1,553。
- barrier（240 次）：5692474f seam 合計遺失 40；bea35380、2118bc66 0。
- 故障情境：F1–F5 在 2118bc66 皆 0 遺失；rename 前被殺留孤兒 temp 檔，兩 pin 皆 10/10。**F6 不同 PID namespace：2118bc66 兩方向各 10/10 遺失（反例）**。bea35380 在 F4 不同 TMPDIR 10/10 遺失，在 F6 host→ns 方向 10/10 遺失。
- 單 process 回歸：15 組正確性相同；steward total_ms mean +2.4%。多 process opt 對 fix：wall mean +2.3%。
- CI（另列）：PR #214 CI：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate green；不重跑論文實驗。

## 4. 最佳化項目狀態（論文 §4.11）

| 項目 | 狀態 | r4 證據 | 能否單獨消融 | 尚缺 |
|---|---|---|---|---|
| (a) region 錨定 re-compose | 已實作（region 標記＋列內容；**CID 錨定未實作**） | `file-hash-drift` 785→0；stale-proposal barrier 上下分離 20/20 applied | 否：需改 ATM 程式碼或提案格式 | 無區域身分的提案不生效；harness 提案剛好帶 `L<line>:<region>`，屬外部效度限制 |
| (b) 早期 stale 改走 re-compose | 已實作 | 未上鎖 stale 68→0；before-precheck barrier 20/20＋20/20 | 否：與 (c) 不可分離 | — |
| (c) 有上限重試＋退避 | 已實作（4 次、4 ms、jitter 3 ms） | 消融 r0／r1／預設 1,718／1,752／1,748；F5 用盡→blocked | 可（`recomposePolicy`） | 多次重試與退避在 E4 未見作用 |
| (d1) repo 範圍鎖 | 已實作 | F4 不同 TMPDIR 0 遺失（bea35380 10/10 遺失） | 否（`commitLockRoot` 未轉送） | 網路檔案系統、跨主機未測 |
| (d2) 過期持鎖者處理 | 已實作；**跨 PID namespace 不安全** | F1／F2／F3 符合預期；**F6 反例** | 否 | 修正存活判斷（lease 或 broker 序列化） |
| (d3) broker 序列化 apply 佇列 | **未實作（延後）** | — | — | 全部 |

## 5. 審查項目對照（延續 r3 §4）

| 審查項目 | r3 狀態 | r4 狀態 | 尚缺 |
|---|---|---|---|
| P0-1 E4 lost result | ATM 端修正已驗證（非證明） | 2118bc66 在 E4／barrier 0 遺失；**F6 新反例**（跨 PID namespace） | MP 正確性結論依 §5.7 不自動恢復；F6 待修 |
| 完成率偏低（r3 約 58%） | 未處理 | (a)–(d2) 已實作並驗證：67.0%（一次觀察） | 約 33% 仍 blocked；未做顯著性檢定 |
| r3 新增限制 1：`recovery-required` 未觸發 | 未驗證 | **已測**（F2 存活持鎖、F3 逾時） | — |
| r3 新增限制 2：tmp 鎖不共享 | 未測 | **已測**（F4）；2118bc66 共鎖；跨容器見 F6 反例 | 網路檔案系統 |
| r3 新增限制 3：未 fsync | — | 不變 | 斷電測試 |
| r3 新增限制 4：外部寫入者 | — | 不變 | — |
| r3 新增限制 5：鎖內被 kill | 未測 | **已測**（F1）；發現孤兒 temp 檔 | temp 清理 |
| r3 新增限制 6：早期 stale→blocked | 保守 | 改走 re-compose（(b)） | — |
| re-propose stub | 未解決 | 部分：(a) 讓 ATM 在重合成時用區域身分重新定位，但 harness 仍不重產 proposal | — |
| mean±σ 非 CI／統計 | 未解決 | 未解決；r4 報逐 run 配對對數（描述性） | CI、檢定 |
| Phase 2 其他（lifecycle、policy matrix 等） | 未開始 | 未開始 | — |
| Phase 3（450-run 主矩陣） | 未執行 | **未執行** | — |

**r4 新增限制**
1. F6：跨 PID namespace 的存活判斷不可靠，2118bc66 會遺失已 ack 效果。
2. 孤兒 `.atm-tmp` 檔不清理。
3. 只以 `unshare` 模擬 PID namespace，未測真實容器、mount namespace、overlay 或網路檔案系統。
4. 回歸執行順序固定。
5. 消融只涵蓋 (c)。
6. barrier before-precheck 只能在 2118bc66 測。
7. F5 在 bea35380 不可測。
8. 75 次觀察不是正確性證明。

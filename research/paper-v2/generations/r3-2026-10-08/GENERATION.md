# Evidence generation r3-2026-10-08

狀態：**DRAFT 證據**。論文仍為 DRAFT，**不主張任何勝出**。未跑論文 Phase 3（450-run）主矩陣：r3 的執行是 PR #213 的驗證回合，不是主結果矩陣。
目的：驗證 ATM PR #213（steward 跨 process lost update 修正）。
ATM pin：
- r3 驗證 pin：`bea35380d7f381f998c9930fa95f01b999c7f208`（PR #213 merge；feature `4d7c9ed6287173f6f704e8d0a0d8a99683776bff`；base main `53e6fdb0`）。
- 對照 pin：`5692474f7db70ab52a7a71c8af4867609e7e4b43`。

兩者皆以 commit SHA 參照並另行安裝，唯讀，不打包原始碼樹。產生時間：2026-10-08（Asia/Taipei）。r1、r2 generation 未修改（見 `PRIOR_REFERENCES.md`）。

## 1. 如何驗證／重建

| 指令 | 行為 | 是否寫入 |
|---|---|---|
| `sh verify.sh`（本目錄） | `sha256sum -c --strict` 對照本目錄 `SHA256SUMS` | 否，嚴格唯讀 |
| `harness/reproduce.sh analyze <新空目錄>` | 只讀 raw：contract test、oracle v2 重評分、E4 鑑識、表重建、cell index、logical_id 稽核、**r3 比較（`analysis/r3_compare.py`）**、r1 extractor 比對；前後 raw 指紋相同才算成功 | 只寫入 OUT |
| `harness/runs/r3-validation/run_r3.sh` | 重跑 r3（barrier→replay→matrix→regression）；拒絕覆蓋既有 `r3*` run；需兩個 ATM pin（`PINS.json`） | 只寫入新 run |
| `node harness/test/barrier_interleave.mjs --atm <ATM_MONOREPO> --out <dir>` | 確定性 2-process 交錯測試 | 只寫入 out 與暫存目錄 |

r3 新 raw（deterministic tar＋`gzip -n`）：`raw/r3-replay.tgz`（225 runs）、`raw/r3-matrix.tgz`（45）、`raw/r3-regression.tgz`（180）、`raw/r3-sp-noise-and-smoke.tgz`（30＋3）、`raw/r3-stdout.tgz`（每 run stdout／stderr）。

## 2. 與 r2 的差異

**Harness 程式**（完整 diff：`harness/R3_CHANGES.patch`，相對封存的 r2 harness）
- `src/steward-writer.mjs`：新增只觀察、不改行為的 seam。它計數 ATM commit guard 鎖目錄 `mkdir` 的成功次數，得出 `atm_commit_attempts`，並計數 EEXIST 輪詢，得出 `atm_commit_lock_contention_polls`。兩者寫入 `compose_batches.*` 與 `steward_applies.*`；5692474f 恆為 0。
- `test/barrier_interleave.mjs`（新）：確定性 barrier 交錯測試。它以 node:fs 攔截加上 `syncBuiltinESMExports` 實作，不改 ATM。
- `analysis/r3_compare.py`（新）：在 `tools/analyze.sh` 中新增 r3 比較步驟。
- `analysis/rescore_oracle_v2.mjs`：新增 r3 stage 名稱。
- `tools/analyze.sh`：raw 指紋排除所有 `runs/*-analysis`（原本只排除 `r2-analysis`）。
- `runs/r3-validation/{run_r3.sh,run_r3_sp_noise.sh,pin_record.py}`（新）。
- `REPRODUCE.md`：新增 r3 節。

**文件**（相對 r2 同路徑，只增不刪）
- `paper/ATM_PAPER_V2_DRAFT_zh.md`：
  - frontmatter 追加 r3 錨點。
  - 表 V1 新增 PR #213 列。
  - §6 新增「表 R3b」r3 小節，r1／r2 反例文字原樣保留。
  - 參考文獻新增 [6]。
- `tables/F2_CORRECTNESS_TABLES.md`：新增 E4 r3 列與 barrier 列，並在停止規則後追加 r3 註。
- `docs/METRIC_DEFINITIONS.md` §6（新增 r3 口徑）、`docs/VERSION_ANCHORS.md`（r3 節）、`docs/EXPERIMENT_CHECKLIST.md`（r3 列）。

**摘要**
- 新增 `summaries/runs/r3-validation/`：PINS.json、ATM core diff、r3.log、barrier 結果。
- 新增 `summaries/runs/r3-analysis/r3-2026-10-08/`：analyze 標準輸出，含 `r3-compare/R3_TABLES.md`。
- r1 stage 摘要與 `r2-e4-forensics` 原封不動。

**來源註記**
- r3 runs 於 2026-10-08 10:45:55–10:53:15（台北）執行；SP 雜訊補測於 10:54–10:55 執行。
- 三臂逐 run 交錯，回歸則逐格 old→fix 交錯。
- runtime oracle v2 與 artifact-only 重評分在 480 個 r3 cell 上完全一致。

## 3. 主要結果（事實）

**Barrier 2-process 交錯**（每案 20 次；window 命中 20/20）
- 同 region：
  - 5692474f：20 次全遺失 leader 效果，follower `applied` 並覆寫。
  - bea35380：0 遺失。follower 經 1 次 commit 嘗試後 re-compose，重合成得 `compose-context-mismatch`，結果 `blocked`；最終 bytes 逐位元等於只含 leader 效果。
- leader 改下方、follower 改上方：
  - 5692474f：20 次全遺失。
  - bea35380：0 遺失。re-compose 後成功（2 次 commit 嘗試），兩效果逐位元皆在。
- 兩 pin 皆無殘留暫存檔。

**E4 重播**（r2 同配置；每臂 75 runs，含 p2/s17 共 35 次；oracle v2）

| 臂 | failed runs | lost | 損壞檔 | correct/offered | re-compose |
|---|---:|---:|---:|---|---:|
| old（5692474f，harness 鎖 off） | 8 | 12 | 0 | 1519/2610 | — |
| fix（bea35380，off） | 0 | 0 | 0 | 1524/2610 | 18 |
| fixlock（bea35380，on） | 0 | 0 | 0 | 1592/2610 | 0 |

- fix 臂的 18 次 re-compose 中，3 次後續 applied，15 次後續 blocked。
- r1 E4 18 cells 重跑：old 只有 fault_naive p8 s23 一格 lost=1；fix 全 0；fixlock（9 主臂格）全 0。
- 單 process E4：兩 pin 各 18 次，correct 皆 592/636、lost 0。

**非完成**：全部 `blocked`，計入 goodput 非完成。fix 臂依最終理由：

| 理由 | intent 數 |
|---|---:|
| file-hash-drift | 779 |
| steward-final-patch-required | 218 |
| 未上鎖 stale 檢查（不觸發重合成） | 70 |
| re-compose 後重合成失敗 | 15 |
| 其他 compose-context-mismatch | 4 |

- 公開理由以 `re-compose:` 或 `recovery-required:` 開頭者 0 次。
- 鎖競爭輪詢 9 次，無 lock timeout。

**延遲**
- 多 process：
  - fix vs old：wall mean 591.9→594.8 ms（+0.5%），p95 713.9→717.8 ms。
  - 每 intent total_ms：mean 93.9→95.0 ms，p95 210.7→220.0 ms。
  - fixlock：wall mean 688.3 ms，p8 為 894.7 ms。
- 單 process 回歸：15 組正確性計數完全相同。
  - steward：mean +0.23 ms（+0.3%）、p50 +0.98、p95 −6.55 ms，在同 pin rep 雜訊內。
  - bare composer：mean +2.95 ms（+1.8%）、p95 +9.5 ms，超出其雜訊（約 0.3 ms）。
  - file lock、OCC、Git 三方：|Δmean| ≤ 0.4%。
  - 執行順序固定 old→fix，順序偏差未排除。

## 4. 審查項目對照（延續 r2 §4）

| 審查項目 | r2 狀態 | r3 狀態 | 證據 | 尚缺 |
|---|---|---|---|---|
| P0-1 E4 lost result | 反例；系統面未修 | **ATM 端修正已驗證（觀察＋確定性測試；非證明）**；反例文字保留 | 表 R3b、`r3-compare/`、`barrier/` | 見下方「r3 新增限制」；MP 正確性結論依 §5.7 不自動恢復，待外審 |
| P0-1 附帶：2-process barrier 契約測試 | 尚缺 | **已完成**（2 案例 × 2 pin × 20） | `test/barrier_interleave.mjs` | 尚未納入 CI；只有單檔、兩 process 的案例 |
| P0-2 oracle | 已修正 | 不變；r3 全部以 v2 評分 | `oracle-rescore/` | 同 r2（`full_bytes_exact` 以 scenario 序；runtime v1 並存） |
| P0-3 reproduce／checksum | 已修正 | 不變；analyze 指紋排除擴及所有 `*-analysis` | `tools/analyze.sh` | — |
| Phase 1 A／E | 已完成 | 不變；cell index 擴及 r3：1030 cells（731 個 pin＝5692474f、284 個＝bea35380、15 個探針無 pin），每格對應 raw 封存檔 | `cell-index/`、`r3-compare/` | E1–E4 表重建仍只涵蓋 r1 主表（r3 表由 `r3_compare.py` 從 raw 產生） |
| Phase 1 B／C／D | 部分 | 部分；r3 raw 新增每 run stdout／stderr 封存（`r3-stdout.tgz`）與 ATM pin 樹完整性紀錄（`PINS.json`） | — | 每 run 的 harness 原始碼 hash 仍未寫入 meta |
| logical_id stub | 部分（稽核通過） | 不變 | — | — |
| re-propose stub | 未解決 | **未解決**：harness 不重產 proposal，故 re-compose 多半以 context 不符結束 | 表 R3b (3) | — |
| MP window process-local | 未解決 | 未解決（PR #213 不改 window） | — | — |
| mean±σ 非 CI／統計 | 未解決 | 未解決；r3 報 mean／p50／p95（線性插值）與同 pin rep 差作雜訊參考 | — | 未做 CI、檢定與 p99 |
| Phase 2 D（MP 最小交錯，barrier） | 只有統計 replay | **已完成**（確定性） | — | — |
| Phase 2 其他（lifecycle、policy matrix、write-monitor、recovery） | 未開始 | 未開始 | — | — |
| Phase 3（450-run 主矩陣） | 未執行 | 未執行 | — | — |

**r3 新增限制**
1. `recovery-required`（pid 回收、lock timeout）路徑：本實驗 0 次觸發，未驗證。
2. lock root 位於 `os.tmpdir()/atm-steward-commit-locks`：不同 tmp、容器或網路檔案系統之間鎖不共享，未測。
3. 未 fsync，斷電耐久性與舊版相同。
4. 非 ATM 的外部寫入者不受此鎖約束。
5. process 在鎖內被 kill 的恢復：未測。
6. 未上鎖的早期 stale 檢查仍回 `blocked`、不走重合成，屬保守行為，非安全問題。
7. 新 pin 的收據 `beforeHash` 改為合成 base，harness 的 `interleave_suspect` 在 fix 臂出現 4 次假陽性；oracle v2 確認無遺失。
8. barrier seam 依賴 node:fs 攔截點的位置。兩 pin 的攔截點都已記錄（5692474f：`writeFileSync`；bea35380：鎖 `mkdirSync`）。
9. 統計上，75 次觀察與兩種強制交錯都不是正確性證明。

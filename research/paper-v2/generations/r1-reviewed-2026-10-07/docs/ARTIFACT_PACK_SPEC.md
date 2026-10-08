# A5 — 實驗封包規格（最低檔案清單）

| 欄位 | 內容 |
|------|------|
| 產出 | A5（對應審閱表 12；`EXPERIMENT_CHECKLIST.md`） |
| 日期 | 2026-10-07（Asia/Taipei） |
| 根目錄 | `/workspace/reports/atm-v2-harness/` |
| 狀態圖例 | **已有**＝本環境可讀到實際路徑；**尚缺**＝主實驗／重現封包仍缺，須後續補齊 |

> 本規格定義「論文可核驗封包」的**最低集合**。舊冷熱 runs 可當支撐附件，**不能**替代 composer＋steward 主實驗封包。

---

## 1. 版本 manifest

| 最低內容 | 狀態 | 實際路徑／缺口 |
|----------|------|----------------|
| ATM／harness／oracle 完整 SHA、角色（historic／main／candidate／final） | **已有（規格）** | `/workspace/reports/atm-v2-harness/VERSION_ANCHORS.md` |
| 每 run 綁定 ATM SHA＋參數 | **部分已有** | 例：`runs/hf-loop-h1-a8-r1/meta.json`（有 `run_id`／seed／params）；**尚缺**統一欄位 `atm_sha`／`harness_sha`／`oracle_sha`／`git_dirty` |
| Lockfile／Node／OS／硬體 | **已有** | `artifact_manifest.json`（Node／OS／cpu／nproc／dirty／created_at_cst） |
| Candidate／final pin | **尚缺 final** | Candidate／ATM pin `5692474f…`；RQ2 invoke frozen (D5)；**E1／E2 done**（`runs/e2-matrix/` DRAFT）；final TBD until E3+／稿凍結 |

**最低檔**：`artifact_manifest.json`（**已有**）含：`atm_sha`, `atm_path`, `harness_commit_or_tree_id`, `oracle_sha`, `node`, `os`, `cpu`／`nproc`, `dirty`, `created_at_cst`, `checklist_ids`, pointers, DRAFT banner。

---

## 2. 原始事件與終態

| 最低內容 | 狀態 | 實際路徑／缺口 |
|----------|------|----------------|
| 逐 proposal／attempt／batch／commit 事件（含失敗／timeout） | **部分已有（舊 harness）** | 各 run 目錄下 `atm/`、`export/`（例：`runs/hf-loop-h1-a8-r1/{atm,export,meta.json}`）；**尚缺**符合 `METRIC_DEFINITIONS.md` §3 的完整欄位（`logical_id`／`batch_id`／digests／steward verdict） |
| base／patch／output digest | **尚缺（主實驗）** | Composer 探針僅有彙總列，無 per-attempt digest 日誌 |
| 最後檔案／tree 快照 | **部分已有** | 各 run `worktree/`＋oracle digests；主方法 runs 例 `runs/d5-steward/` |
| Composer 探針終態摘要 | **已有** | `runs/composer-probe/probe.out`（五情境 JSONL 摘要） |

事件 schema 最低欄位：見 `METRIC_DEFINITIONS.md` §3（`run_id`, `logical_id`, `attempt_id`, `batch_id`, digests, `actor`, `reason`, `timestamp`, SHAs）。

---

## 3. 可執行入口

| 入口 | 狀態 | 實際路徑／缺口 |
|------|------|----------------|
| **Composer 唯讀探針** `probe.mts` | **已有** | `/workspace/reports/atm-v2-harness/runs/composer-probe/probe.mts` |
| 探針輸出 | **已有** | `runs/composer-probe/probe.out` |
| Harness CLI／runner | **已有（舊臂）** | `src/cli.mjs`, `src/runner.mjs`, `src/real-broker.mjs`, `src/scenario.mjs`, … |
| `--atm-writer steward`／CLI `--arm steward` | **已有（C1／C4／D5 freeze）** | `src/steward-writer.mjs`；RQ2 main = `--arm steward` only；`runs/baselines/D5_SUMMARY.md`；診斷／基線見 `src/arms.mjs` |
| **獨立 oracle**（完整 bytes／效果 ID，非僅 marker） | **已有（C3）** | `src/oracle.mjs`；每 run `scenarios/expected_effects.json`＋`artifacts/oracle_summary.json`；見 `runs/steward-writer/STEWARD_WRITER_C3.md` |
| 產生器（workload／patch traces） | **部分已有** | `src/scenario.mjs`＋`fixture/manifest.json`；**尚缺**預先登記 `logical_id`＋獨立 eligible 標註檔 |
| 彙整／分析腳本 | **已有（舊矩陣）** | 例：`runs/cold-queue/analyze.mjs`, `runs/hot-file/analyze.mjs`, `runs/v017/analyze_{hot,cold}.mjs`, `runs/v017-q180/analyze_q180.mjs`, `runs/multiprocess/analyze.mjs`, `runs/scale/analyze.mjs` |
| 一鍵重建主表 | **已有（verify-only）** | 根目錄 `reproduce.sh`＋`REPRODUCE.md`；預設不重跑 150 cells；`--matrix e1|e2`／`--full` 才呼叫既有 `run_matrix.sh` |

---

## 4. 舊表來源路徑（支撐／動機；非主貢獻）

| 資料 | 狀態 | 路徑 |
|------|------|------|
| 關鍵表彙整 | **已有** | `PAPER_V2_KEY_TABLES.md` |
| 實驗筆記／口徑 | **已有** | `PAPER_V2_EXPERIMENT_NOTES.md` |
| 冷檔延遲 | **已有** | `COLD_QUEUE_LATENCY.md`；raw：`runs/cold-queue/`、`runs/v017-q180/summary.{json,md}` |
| 熱檔延遲 | **已有** | `HOT_FILE_LATENCY.md`；raw：`runs/hot-file/summary.{json,md}`；per-run 例 `runs/hf-*` |
| v0.1.17 冷熱重測 | **已有** | `V017_HOT_COLD.md`；`runs/v017/{hot,cold}_summary.{json,md}` |
| Composer 探針 | **已有** | `runs/composer-probe/{probe.mts,probe.out}`；計畫敘事：`COMPOSER_STEWARD_IMPL_PLAN.md` §2.6 |
| Fixture 清單 | **已有** | `fixture/manifest.json` |
| 審閱／指標依據 | **已有** | `ATM_PAPER_V2_FEASIBILITY_REVIEW.md`（表 8／表 12） |
| T6／R1 **每 run 原始分子分母**（A4） | **部分／待核** | 有 per-run 目錄與 `meta.json`／export；**尚缺**一份「表註用」的 raw counts 彙總（A4 任務）標明 ratio-of-sums |

---

## 5. 重現清單（reproduce checklist）

| 項目 | 狀態 | 說明 |
|------|------|------|
| Seed pairs（workload × scheduler） | **已有（E2）** | `runs/e2-matrix/SEEDS_REGISTERED.md`＋`seeds.json`（跑前登記）；`scheduler = workload + 1000`；150 cells paired |
| 運行順序／warmup／timeout／retry | **已有** | `REPRODUCE.md`＋各 `run_*.sh`／`meta.json` |
| Git flags／merge 基線參數 | **已有（D3）** | `--arm git_three_way`；`runs/baselines/D3.md`；n-way fold disclosed |
| Expected fixtures＋raw checksums | **已有** | 頂層 `checksums.sha256`；另 `runs/b5-b8/checksums.sha256`／`runs/composer-probe/checksums.sha256` |
| 版本錨與「CI≠主實驗」聲明 | **已有** | `VERSION_ANCHORS.md` §3 |

**目標檔（已有）**：

- `REPRODUCE.md` — 一鍵步驟、環境、seed 規則、DRAFT／CI≠主實驗聲明  
- `reproduce.sh` — 預設 verify-only；可選 probe／`--matrix e1|e2`／`--full`  
- `checksums.sha256` — 規格／manifest／E1／E2 摘要／seeds／probe／oracle  

---

## 6. 建議封包目錄佈局（目標；多數尚缺）

```
/workspace/reports/atm-v2-harness/
  VERSION_ANCHORS.md          # 已有（A1）
  METRIC_DEFINITIONS.md       # 已有（A2）
  ARTIFACT_PACK_SPEC.md       # 已有（本檔 A5）
  artifact_manifest.json      # 已有
  REPRODUCE.md                # 已有
  reproduce.sh                # 已有（verify-only 預設）
  checksums.sha256            # 已有
  oracle/                     # C3: src/oracle.mjs + per-run expected_effects.json / oracle_summary.json
  runs/composer-probe/        # 已有（B1 historic 紅燈）
  runs/b5-b8/                 # 已有（B5–B8；S4／邊界／排列／S5）
  runs/e1-pilot/              # 已有（E1 DRAFT）
  runs/e2-matrix/             # 已有（E2 DRAFT；150 cells）
  runs/<matrix-cell>/         # C／D／E 臂已有
  tables/                     # 尚缺（F1／F2 論文表；非本輪）
```

---

## 7. 與實驗階段的對應

| 階段 | 封包最低門檻 |
|------|----------------|
| **A（本輪）** | 本檔＋VERSION_ANCHORS＋METRIC_DEFINITIONS＋既有 probe／舊表路徑標註 |
| **B（S 族）** | **done**：`runs/composer-probe/`＋`runs/b5-b8/`（含 stock validators） |
| **C–E 主結果** | steward 臂事件日誌＋獨立 oracle＋artifact_manifest＋reproduce＋checksums **已齊**（E1／E2 仍標 DRAFT，不宣稱勝出） |
| **F** | F3 reproduce／checksums **已有**；`tables/`＋圖（F1／F2）尚缺 |

---

## 8. 本輪結論（A5）

**已有（可立即引用為「封包原料」）**：版本錨規格、指標定義、composer probe、舊冷熱 analyze／summary、KEY_TABLES、fixture manifest、分散的 harness src。

**尚缺（阻擋 final／主文凍結宣稱）**：final ATM SHA；E4–E5；F1／F2 論文表圖。**已補**：C1–C4；D1–D5；B5–B8；**E1／E2**（DRAFT）；**artifact_manifest.json／REPRODUCE.md／reproduce.sh／checksums.sha256**（F3）；`logical_id` 解耦（新跑；歷史 E2 仍 stub）。



---

## 9. B5–B8 更新（2026-10-07 22:43 CST）

| 項 | 路徑 |
|----|------|
| B5–B8 探針＋EXPECTED＋分項紀要 | `runs/b5-b8/` |
| checksums | `runs/b5-b8/checksums.sha256` |
| 紀要 | `runs/steward-writer/STEWARD_WRITER_B5_B8.md` |

B／E2 ladder 完成（DRAFT）；manifest／reproduce／checksums **已有**；final 仍待 E3+＋final pin。

## E1 pilot 封包（2026-10-07 22:50 CST）

| 項目 | 路徑／狀態 |
|------|------------|
| Summary | `runs/e1-pilot/E1_SUMMARY.md`（**pilot only — 不宣稱勝出**） |
| Compare JSON | `runs/e1-pilot/e1_compare_raw.json` |
| Workloads | `runs/e1-pilot/WORKLOADS.md` |
| Runner | `runs/e1-pilot/run_matrix.sh` |
| Per-cell | `runs/e1-<workload>-<arm>-s<seed>/`（45） |
| Chronicle | `runs/steward-writer/STEWARD_WRITER_E1.md` |
| 仍缺 | final pin（E3+）；MP compose window；F1／F2 表圖 |

## F3／gaps 封包（2026-10-07 23:15 CST）

| 項目 | 路徑／狀態 |
|------|------------|
| artifact_manifest.json | **已有**（根目錄；DRAFT banner） |
| REPRODUCE.md | **已有** |
| reproduce.sh | **已有**（executable；預設 verify-only） |
| checksums.sha256 | **已有** |
| logical_id 解耦 | **已有**（harness；見 `runs/steward-writer/STEWARD_WRITER_GAPS.md`） |
| E1／E2 cells | **保留**；未自動重跑；scenario_hash 新舊可能不同 |
| Banner | **DRAFT evidence — 不宣稱勝出** |

## E3 sweep 封包（2026-10-07 23:17 CST）

| 項目 | 路徑／狀態 |
|------|------------|
| Summary | `runs/e3-sweep/E3_SUMMARY.md`（**DRAFT — 不宣稱勝出**） |
| Compare JSON | `runs/e3-sweep/e3_compare_raw.json` |
| Seeds | `runs/e3-sweep/SEEDS_REGISTERED.md`／`seeds.json`（跑前） |
| Runner | `runs/e3-sweep/run_sweep.sh` |
| Chronicle | `runs/steward-writer/STEWARD_WRITER_E3.md` |
| Cells | 120；window 含 0；logical_id 解耦 |
| 仍缺 | E4 MP；E5 fault；F1／F2 表圖；final pin |

## E4 multiprocess 封包（2026-10-07 23:26 CST）

| 項目 | 路徑／狀態 |
|------|------------|
| Summary | `runs/e4-multiprocess/E4_SUMMARY.md`（**DRAFT**） |
| Compare | `e4_compare_raw.json` |
| Seeds／Runner | `SEEDS_REGISTERED.md`／`run_matrix.sh` |
| Chronicle | `runs/steward-writer/STEWARD_WRITER_E4.md` |
| 仍缺 | E5 fault inject；F1／F2；final pin |

## E5 fault 封包（2026-10-07 23:29 CST）

| 項目 | 路徑／狀態 |
|------|------------|
| Summary | `runs/e5-fault/E5_SUMMARY.md`（**DRAFT**） |
| Compare | `e5_compare_raw.json` |
| Probe | `inject.mts`／`inject-r{1,2}.out` |
| Chronicle | `runs/steward-writer/STEWARD_WRITER_E5.md` |
| Candidate final | ATM `5692474f…`（待外部審核升 final） |

## External review pack（2026-10-07 23:31 CST）

| 項目 | 路徑 |
|------|------|
| 說明 | `REVIEW_PACK_FOR_EXTERNAL_AI.md` |
| 精簡目錄 | `review-pack/`（55 files） |
| tgz | `review-pack.tgz` |
| Candidate final | ATM `5692474f…`（待審核升 final；不 publish／tag） |

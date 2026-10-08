# EVIDENCE_INDEX — ATM 論文 2.0 證據總索引

> **DRAFT — 不宣稱勝出。** 狀態欄「done」只代表該實驗已跑完並有紀錄，**不代表**結論已獨立驗證。
> 路徑相對於 `research/paper-v2/`。時間皆為 Asia/Taipei（CST）。

## 1. Generations

| Generation | 狀態 | ATM pin | SHA256SUMS sha256 | 檔案數 | 說明 |
|------------|------|---------|-------------------|------:|------|
| `generations/r1-reviewed-2026-10-07/` | **reviewed — NOT final**（外審 3×P0） | `5692474f7db70ab52a7a71c8af4867609e7e4b43` | `30d663c28f6c5a200988bb1e61a3c765408a43a668c5c575ee9aef8f0ced033f` | 274（不含 SHA256SUMS） | [GENERATION.md](./generations/r1-reviewed-2026-10-07/GENERATION.md) |

r1 簡寫：`R1=generations/r1-reviewed-2026-10-07`。

## 2. 審核紀錄（r1）

| 檔案 | sha256 | 說明 |
|------|--------|------|
| `R1/review/review-pack.tgz` | `c9a98cc843528e9b3cd406cacc79c7fef71531a1f404da9bde48683e72ca8fab`（142,794 B） | 外部 AI 實際審閱的原包（逐位元） |
| `R1/review/REVIEW_PACK_FOR_EXTERNAL_AI.md` | 見 SHA256SUMS | 包說明（與包內同檔一致） |
| `R1/review/EXTERNAL_REVIEW_2026-10-07.md` | 見 SHA256SUMS | 外審全文：P0-1 E4 p2 s17 lost=1；P0-2 oracle presence-based；P0-3 checksum／reproduce 問題 |

## 3. 階段 A–F（r1）

| 階段 | 項目 | 程式碼 | 摘要 | raw | 狀態 | 注意事項 |
|------|------|--------|------|-----|------|----------|
| A1 | 版本錨 | — | `R1/docs/VERSION_ANCHORS.md` | — | done | candidate final pin 待審；checksum mismatch（P0-3） |
| A2 | 指標分母 | — | `R1/docs/METRIC_DEFINITIONS.md` | — | done | 要求完整 bytes＋frame，現 oracle 未達（P0-2） |
| A3 | 措辭校正 | — | `R1/paper/` | — | **todo** | 正文仍寫 `3b0f7660`／PR #198 未合 |
| A4 | T6／R1 分母稽核 | `R1/harness/runs/hot-file/analyze.mjs` | `R1/docs/T6_R1_DENOMINATOR_AUDIT.md`、`R1/summaries/runs/hot-file/t6_r1_raw_counts.json` | 舊 hot-file raw：`archive/support-raw-r1/`（已上傳；動機用，非 RQ） | done | 64.9%＝ratio-of-sums 518/798 |
| A5／F3 | 封包規格、manifest、reproduce | `R1/harness/reproduce.sh` | `R1/docs/ARTIFACT_PACK_SPEC.md`、`artifact_manifest.json`、`checksums.sha256`（原樣） | — | done（**有缺陷**） | reproduce verify 會重寫指紋；4 mismatch／18 缺件（P0-3） |
| B1–B4 | v0.1.17 探針基準；S1b／S2／S3 | `R1/harness/runs/composer-probe/probe.mts` | `R1/summaries/runs/composer-probe/` | `R1/raw/b-probes.tgz` | done | historical probe checksum 3 項在 review-pack 缺 |
| B5–B8 | S4 stale、邊界、排列、S5 rollback | `R1/harness/runs/b5-b8/probe.mts` | `R1/summaries/runs/b5-b8/`、`R1/summaries/runs/steward-writer/STEWARD_WRITER_B5_B8.md` | `R1/raw/b-probes.tgz` | done | rollback＝例外補償，非 crash atomicity |
| C1–C3 | steward writer、window、oracle | `R1/harness/src/steward-writer.mjs`、`oracle.mjs` | `R1/summaries/runs/steward-writer/STEWARD_WRITER_C1..C3.md` | `R1/raw/steward.tgz` | done | re-propose stub（C2 L50/L97）；oracle presence-based（P0-2） |
| C4 | 診斷臂 | `R1/harness/src/arms.mjs` | `…/STEWARD_WRITER_C4.md`、`c4_compare_raw.json` | `R1/raw/c.tgz` | done | 非競爭者 |
| D1–D5 | lock／OCC／git3／bare／steward | `R1/harness/src/*` | `R1/summaries/runs/baselines/`、`…/STEWARD_WRITER_D1..D5.md` | `R1/raw/d.tgz` | done | lock／OCC 也經 ATM admission（共同准入下比較） |
| E1 | pilot 45 cells | `R1/harness/runs/e1-pilot/run_matrix.sh` | `R1/summaries/runs/e1-pilot/` | `R1/raw/e1.tgz` | done（pilot） | logical_id stub（可由 events 重算） |
| E2 | 主矩陣 150 cells | `R1/harness/runs/e2-matrix/run_matrix.sh`（`extract_e2.py` 為 0 bytes） | `R1/summaries/runs/e2-matrix/`（含 seeds.json、SEEDS_REGISTERED.md） | `R1/raw/e2.tgz` | done（DRAFT） | logical_id stub；steward goodput 低於 lock／OCC；mean±σ 非 95% CI |
| E3 | window sweep 120 cells | `R1/harness/runs/e3-sweep/run_sweep.sh`、`extract_e3.py` | `R1/summaries/runs/e3-sweep/` | `R1/raw/e3.tgz` | done（DRAFT） | 負結果：長窗口無完成率收益 |
| E4 | multiprocess 18 cells | `R1/harness/runs/e4-multiprocess/run_matrix.sh`、`extract_e4.py`、`src/mp-*.mjs` | `R1/summaries/runs/e4-multiprocess/` | `R1/raw/e4.tgz` | done（**P0-1**） | 主臂 p2 s17 lost=1；window process-local；fault 臂非競爭者 |
| E5 | 故障注入 | `R1/harness/runs/e5-fault/inject.mts`、`run_matrix.sh` | `R1/summaries/runs/e5-fault/` | `R1/raw/e5.tgz` | done（DRAFT） | 18＝cell 分類，非 logical 終態分布；OCC cells 41/26/15 |
| gaps | logical_id 解耦 smoke | `R1/harness/src/scenario.mjs` | `…/STEWARD_WRITER_GAPS.md` | `R1/raw/gaps.tgz` | done | 新 run 用 `log:{scenario}:i{k}` |
| F1 | 主文圖 | — | `R1/tables/F1_FIGURES.md` | 來自 E2–E5 | done（DRAFT） | |
| F2 | 正確性表 | — | `R1/tables/F2_CORRECTNESS_TABLES.md` | 來自 E2–E5 | done（DRAFT） | E4 只選 p8（P0-1）；E5 為 cell 分類 |
| 論文 | 草稿 | — | `R1/paper/ATM_PAPER_V2_DRAFT_zh.md`（＋`_pre_review`、`_hotcold_archive`） | — | DRAFT | 正文過時 |

## 4. raw 封存（r1；deterministic tar＋`gzip -n`；每檔 < 50 MB）

| 檔案 | bytes | sha256 |
|------|------:|--------|
| `R1/raw/e1.tgz` | 1,141,537 | `efc3b19f09f5e4bb5e1821962eece5f48d9233b6d9e1e345607ac40f0d007168` |
| `R1/raw/e2.tgz` | 3,684,062 | `25e648e2681abdddc279d060f1ddae8df090ee83213f7fb165aafbdcc5eee355` |
| `R1/raw/e3.tgz` | 4,036,715 | `1fed09dba2639d64d29dfee4637b204f920e4cb926e3062d59fdd60853727a1f` |
| `R1/raw/e4.tgz` | 933,773 | `b9c79193c2a4f077cfb2118d59f4946f3d670aa0acad431dce0ff8d0c692458f` |
| `R1/raw/e5.tgz` | 142,345 | `ea5a3492ffe5ae4150ea71c70d62954a7f39d7d33b87997ff12bb518f24603b7` |
| `R1/raw/c.tgz` | 68,510 | `4357bf1830557e55560177e629d00e91d220dd313f1a8965deec69451c20f535` |
| `R1/raw/d.tgz` | 450,814 | `b2e1a144ec4ac95c34d02746b3a2ad37598d42d9e4ee37ce4078f38cf7a3b79c` |
| `R1/raw/b-probes.tgz` | 16,448 | `55f67997bfbd81584ba3f862aa9a75e5aeb0f39f3fdeef02069b8e1062c872ad` |
| `R1/raw/steward.tgz` | 163,078 | `a350d3facc1c2039b304bceb4fe1a6997409da7523ae649ecafd192a57d0db8a` |
| `R1/raw/gaps.tgz` | 27,610 | `98a22e1ada9df196044269bf0a50c094629d48436c4f5569d57110427e01252c` |

## 5. 舊支撐實驗（hot/cold v0.1.17、q180、scale、multiprocess、cold-queue、compare）

> **已上傳，保持壓縮。** 這是 harness 建立前的 hot/cold 動機 runs，**不是** RQ 證據，不可拿來宣稱效能。兩個 tarball 各自合法、彼此獨立，各含一半 run 目錄。

| 內容 | 位置 | 說明 |
|------|------|------|
| 摘要 | `R1/summaries/runs/{cold-queue,compare,hot-file,multiprocess,scale,v017,v017-q180}/`、`R1/docs/supporting/*.md` | 已上傳 |
| 分析／執行腳本 | `R1/harness/runs/{cold-queue,hot-file,multiprocess,scale,v017,v017-q180,probe-cold}/*` | 已上傳 |
| raw（246 dirs） | **已上傳** [`archive/support-raw-r1/`](./archive/support-raw-r1/README.md) | 見下表；`sha256sum -c SHA256SUMS`；解出：`tar -xzf support-raw-r1-a.tgz && tar -xzf support-raw-r1-b.tgz` → `runs/`（不要把解出的 `runs/` 提交進 git） |

| 檔案 | bytes | sha256 |
|------|------:|--------|
| `archive/support-raw-r1/support-raw-r1-a.tgz` | 15,201,998 | `5bebae601975b72260355864aa055903275ec5a64f5e8573767bbae3979d40ee` |
| `archive/support-raw-r1/support-raw-r1-b.tgz` | 15,776,518 | `89fa2469003e95d1a2092a5f5bf0a8c1a939c8b715841dda826f6d915b386323` |

先前 box-only 單檔 `/workspace/upload/box-only/support-raw-r1.tgz`（30,974,334 B，sha256 `6c47948671bdbe8842c1ee58db83ad2864ef8b980f6b2b1f4929840ec8073470`）**沒有**上傳。現在進 repo 的是上面兩個獨立 tarball，不是該單檔的位元組切割，其 sha256 不能用來核對這兩份檔案。

## 6. 不在 repo 的參照
- ATM pin 原始碼：GitHub `eaglhuang/AI-Atomic-Framework` commit `5692474f7db70ab52a7a71c8af4867609e7e4b43`；box tarball `/workspace/atm-main-5692474f/atm-main.tar.gz` sha256 `1d498a397e6a5db119d40b8f539dc165cb0028fbfe9577f953023f8ec8d45795`。
- 論文 v1：arXiv:2607.00041（box `refs/` 有副本，未上傳）。
- `node_modules/`：依 `R1/harness/package.json` 安裝；實際版本見 `R1/harness/installed-deps.package-lock.json`（不是正式 lockfile，原 harness 無 `package-lock.json`）。

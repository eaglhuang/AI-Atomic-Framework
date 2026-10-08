# Generation r1 — reviewed 2026-10-07（**非 final；DRAFT；不宣稱勝出**）

> **狀態：已被外部審核指出 3 項 P0 阻擋，本代不可升 final、不可作為論文主結果的獨立驗證。**
> 本代是「外部 AI 審核當下」的證據快照（snapshot of the reviewed state）。依 generation 政策，本目錄**不可再修改**；任何 P0／P1 修正一律進入新的 generation（例如 `r2-…`），不得回寫本代。

| 欄位 | 值 |
|------|----|
| Generation | `r1-reviewed-2026-10-07` |
| 快照建立 | 2026-10-08 09:32 CST（Asia/Taipei）；只複製、不改 harness／runs |
| ATM pin（唯讀，僅以 SHA 參照，不附樹） | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（PR #198 merge，candidate final pin，**pending review**） |
| ATM 來源 tarball（box 本機，不上傳） | `/workspace/atm-main-5692474f/atm-main.tar.gz` sha256 `1d498a397e6a5db119d40b8f539dc165cb0028fbfe9577f953023f8ec8d45795`（36,053,896 bytes） |
| 外審對象 | `review/review-pack.tgz` sha256 `c9a98cc843528e9b3cd406cacc79c7fef71531a1f404da9bde48683e72ca8fab`（142,794 bytes；已逐位元驗證） |
| 外審全文 | `review/EXTERNAL_REVIEW_2026-10-07.md`（原附件逐位元複製） |
| Harness | `atm-bench` 0.3.0-latency；Node v24（box：`/workspace/.nvm/versions/node/v24.21.0`） |
| 校驗 | `./verify.sh`（唯讀；`sha256sum -c SHA256SUMS`；缺檔／改檔即非零退出） |

## 1. 外部審核已知問題（本代未修，留給 r2）

### P0（阻擋 final）
1. **P0-1 E4 正常主臂有 lost**：`summaries/runs/e4-multiprocess/E4_SUMMARY.md` 第 69 行 — `main_steward_mp`、p2、seed 17、scheduler 1017：correct=20、**lost=1**、blocked=13（三 seeds lost mean=0.33）。F2 只選 p8（lost=0），不能代表 MP 整體零遺失。該格 raw 在 `raw/e4.tgz` 的 `runs/e4-hot_conflict-steward-p2-s17/`。應觸發論文既有停止規則：先保存、定位、建回歸。
2. **P0-2 Oracle 只到 presence 層級**：`src/oracle.mjs`（C3）以 exact_line／token 出現次數＋可選 region 判定，**未**證明達到完整 bytes＋frame 契約。需 6 類正負例（鄰近原文被改壞、放錯位置、缺 region、重複效果、合法刪除／替換、合法後續取代）。
3. **P0-3 封包不是已驗證的可重現交付**：
   - `docs/checksums.sha256` 共 25 筆；在 review-pack 中 3 match／4 mismatch（VERSION_ANCHORS.md、ARTIFACT_PACK_SPEC.md、artifact_manifest.json、EXPERIMENT_CHECKLIST.md）／18 缺路徑。**本代原樣保留（含 mismatch），不修。**
   - review-pack 的扁平 `runs-summaries/` 讓 E2／E3／E4／E5 的 `seeds.json`、`SEEDS_REGISTERED.md` 同名互蓋（只剩 E5 版）。**本代 `summaries/` 改以原相對路徑存放，已無碰撞**（這是打包方式修正，不是內容修正）。
   - `harness/reproduce.sh` 的 verify 模式**會重寫** manifest（L97–172）與 checksums（L199–234），且未先比對舊指紋。**請勿用它驗證本代**；本代以獨立的唯讀 `verify.sh` 取代。verify／analyze／rerun／seal 分離留給 r2。

### 其他（P1／措辭／統計）
- E1／E2 的 `logical_id` 為 stub（＝intent_id）；可由 events 重算救回，不必直接廢棄。新 run 用 `log:{scenario}:i{k}`。
- re-propose 仍是 stub（`STEWARD_WRITER_C2.md` L50、L97）。
- MP compose window 只在 process 內（process-local），不跨 OS process。
- fault 臂（`fault_naive`、`fault_nolock` 等）是**非競爭者**，不可用來推導勝過 lock／OCC。
- 論文正文過時：仍寫 `3b0f7660`、PR #198 未合併；與本代 pin `5692474f` 不一致。
- E5 F2 的 18 筆是 **cell 分類**，不是 logical operation 終態分布；3 個 OCC-exhaust cells 實含 41 offered／26 correct／15 blocked。
- `mean±σ` 不是 95% CI；需 seed 點、配對效果量、cluster CI；標清 mean-of-ratios vs ratio-of-sums。
- E3：window 0／100／400 ms 完成率皆 100%，長窗口只增加等待——**負結果**，應如實保留。
- steward goodput 低於 file-lock／OCC（E2 hot_conflict 26.11 vs 76.26／87.90 correct/s）；研究定位應為「治理增加什麼保證、付出多少成本」。
- 審核建議分三階段：①補既有證據（不加 run）②小型契約測試 ③約 450 runs 的公平比較＋正確統計。

## 2. 本代內容

| 目錄 | 內容 | 來源（box） |
|------|------|-------------|
| `harness/` | `src/`、`fixture/`、`skills/`、`package.json`、`installed-deps.package-lock.json`、`reproduce.sh`、`REPRODUCE.md`、`README.md`、`.gitignore`；所有 `runs/**/run_*.sh`、`run_matrix.sh`、`run_sweep.sh`、`analyze*.mjs`、`overlap.mjs`、`extract*.py`、`probe.mts`、`probe.mjs`、`inject.mts`（原相對路徑） | `/workspace/reports/atm-v2-harness/` |
| `docs/` | 規格、指標、版本錨、封包規格、checklist、manifest、checksums（原樣）、計畫、可行性審查（.md＋.docx）、吸收筆記、T6/R1 稽核、PAPER_V2_* | 同上根目錄 |
| `docs/supporting/` | 舊支撐實驗報告（hot/cold v0.1.17、q180、scale、multiprocess、compare、smoke）與 v017 除錯 log | 同上 |
| `docs/related-audits/` | ATM 相關但非論文 v2 主線的稽核（ATOM_*、BROKER_HARD_GATE_AUDIT、VAI_*、VIRTUAL_ATOM_INDEX_ANALYSIS） | 同上 |
| `paper/` | `ATM_PAPER_V2_DRAFT_zh.md`＋`_pre_review`＋`_hotcold_archive` | 同上 |
| `tables/` | F1／F2 | `tables/` |
| `summaries/runs/…` | 各階段摘要、compare_raw.json、seeds、matrix.log、probe 輸出，**原相對路徑** | `runs/<stage>/` |
| `raw/*.tgz` | 逐 cell 原始 run 目錄（events、meta、atm 狀態、worktree 含 `.git`），路徑存為 `runs/<cell>/…` | `runs/<cell>/` |
| `review/` | 外審原包、包說明、外審全文 | — |
| `BUILD_BUNDLE_r1.sh` | 產生本代的打包腳本（僅供稽核；路徑為 box 專用，**不要**在本目錄重跑） | `/workspace/upload/tools/` |

### raw 封存（deterministic：`tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu | gzip -n -9`）

| 檔案 | bytes | 檔案數 | 內容 | sha256 |
|------|------:|------:|------|--------|
| `raw/e1.tgz` | 1,141,537 | 3,430 | E1 45 cells＋`e1-diag-*`＋`e1-probe-steward` | `efc3b19f09f5e4bb5e1821962eece5f48d9233b6d9e1e345607ac40f0d007168` |
| `raw/e2.tgz` | 3,684,062 | 11,038 | E2 150 cells＋`e2-diag-*` | `25e648e2681abdddc279d060f1ddae8df090ee83213f7fb165aafbdcc5eee355` |
| `raw/e3.tgz` | 4,036,715 | 11,563 | E3 120 cells | `1fed09dba2639d64d29dfee4637b204f920e4cb926e3062d59fdd60853727a1f` |
| `raw/e4.tgz` | 933,773 | 2,542 | E4 18 cells（steward sp／p2／p4／p8、fault_naive／fault_nolock p8，各 3 seeds）＋3 smoke | `b9c79193c2a4f077cfb2118d59f4946f3d670aa0acad431dce0ff8d0c692458f` |
| `raw/e5.tgz` | 142,345 | 421 | E5 12 injection cells＋occ_exhaust＋clean_steward | `ea5a3492ffe5ae4150ea71c70d62954a7f39d7d33b87997ff12bb518f24603b7` |
| `raw/c.tgz` | 68,510 | 186 | C4 四臂（`c4-*`） | `4357bf1830557e55560177e629d00e91d220dd313f1a8965deec69451c20f535` |
| `raw/d.tgz` | 450,814 | 1,303 | D1–D5（21 dirs，含 `d2-occ-exhaust`） | `b2e1a144ec4ac95c34d02746b3a2ad37598d42d9e4ee37ce4078f38cf7a3b79c` |
| `raw/b-probes.tgz` | 16,448 | 30 | B1–B4 `composer-probe/`、B5–B8 `b5-b8/` | `55f67997bfbd81584ba3f862aa9a75e5aeb0f39f3fdeef02069b8e1062c872ad` |
| `raw/steward.tgz` | 163,078 | 525 | C1–C3 `steward-c*`（7 dirs） | `a350d3facc1c2039b304bceb4fe1a6997409da7523ae649ecafd192a57d0db8a` |
| `raw/gaps.tgz` | 27,610 | 77 | `gaps-logical-id-smoke` | `98a22e1ada9df196044269bf0a50c094629d48436c4f5569d57110427e01252c` |

已確認：重建 `e5.tgz` 得相同 sha256（可重現）。還原方式：在 `harness/` 下 `tar xzf ../raw/e2.tgz` 即得 `runs/e2-*/`。

## 3. 審核後漂移（重要）
本代 `docs/`、`summaries/` 取自 **2026-10-08 快照時的 box 現況**。與 `review/review-pack.tgz` 內容相比，下列檔案在打包 review-pack（2026-10-07 23:30 CST）之後被更新過；**審核當下的確切 bytes 以 `review/review-pack.tgz` 為準**：
- `docs/checksums.sha256`、`docs/artifact_manifest.json`（打包後又執行了 `reproduce.sh`，被重寫）
- `docs/ARTIFACT_PACK_SPEC.md`、`summaries/runs/steward-writer/INDEX.md`（23:30–23:31 補記 review-pack 位置）
- review-pack 內的 `README.md` 是封包專用說明，與 `harness/README.md` 不同檔
其餘 review-pack 內檔案與本代對應檔逐位元相同（`REVIEW_PACK_FOR_EXTERNAL_AI.md` 亦同）。

## 4. 已知缺口與排除
- `package-lock.json`：harness 從未產生（`.gitignore` 列有）。改附 `harness/installed-deps.package-lock.json`＝`node_modules/.package-lock.json`（npm 安裝後的實際版本，ajv 8.17.1、ajv-formats 3.0.1 等）。它不是正式 lockfile。
- `harness/runs/e2-matrix/extract_e2.py` 為 **0 bytes**（原樣）；E2 主表 analysis-only 重建腳本本代缺。
- `node_modules/`、ATM pin 樹（以 SHA 參照）、`refs/arxiv-2607.00041.*`（v1 已公開論文，以 arXiv:2607.00041 引用）、`review-pack/` 解開目錄（與 `review/review-pack.tgz` 同內容）均未納入。無 `.env`／secret／backup 目錄（已掃描 token／私鑰樣式，零命中）。
- 舊支撐 runs 的 raw（246 dirs：`cq-*`、`cq1-*`、`hf-*`、`v017-*`、`mp-*`、`sc-*`、`small-*`、`unpaced-*`、`smoke-*`、`probe-*`）**只留在 box，不上傳**：壓縮後 30,974,334 bytes，加上本代約 14 MB 會超過約 40 MB 預算與 46 MB 分割上限。box 路徑 `/workspace/upload/box-only/support-raw-r1.tgz`，sha256 `6c47948671bdbe8842c1ee58db83ad2864ef8b980f6b2b1f4929840ec8073470`。其摘要與分析腳本已在 `summaries/runs/{cold-queue,compare,hot-file,multiprocess,scale,v017,v017-q180}/` 與 `harness/runs/…`。
- raw 內 `meta.json` 等含 box 絕對路徑（`/workspace/...`），重跑時需自行對應。

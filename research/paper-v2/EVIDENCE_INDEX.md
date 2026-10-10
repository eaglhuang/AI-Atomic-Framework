# EVIDENCE_INDEX — ATM 論文 2.0 證據總索引

> **DRAFT — 不宣稱勝出。** 狀態欄「done」只代表該實驗已跑完並有紀錄，**不代表**結論已獨立驗證。
> 路徑相對於 `research/paper-v2/`。時間皆為 Asia/Taipei（CST）。

## 1. Generations

| Generation | 狀態 | ATM pin | SHA256SUMS sha256 | 檔案數 | 說明 |
|------------|------|---------|-------------------|------:|------|
| `generations/r1-reviewed-2026-10-07/` | **superseded by r2（保留、不可變）**（外審 3×P0） | `5692474f7db70ab52a7a71c8af4867609e7e4b43` | `30d663c28f6c5a200988bb1e61a3c765408a43a668c5c575ee9aef8f0ced033f` | 274（不含 SHA256SUMS） | [GENERATION.md](./generations/r1-reviewed-2026-10-07/GENERATION.md) |
| `generations/r2-2026-10-08/` | **DRAFT — 回應 P0（未再外審）；r3 起為歷史（保留、不可變）** | `5692474f7db70ab52a7a71c8af4867609e7e4b43` | `25d4a2936b52623665f8351138d6c65c7393f8793b67bac46b84c3a272ac87fe` | 309（不含 SHA256SUMS） | [GENERATION.md](./generations/r2-2026-10-08/GENERATION.md) |
| `generations/r3-2026-10-08/` | **DRAFT — ATM PR #213 修正驗證（未再外審）；r4 起為歷史（保留、不可變）** | 驗證 pin `bea35380d7f381f998c9930fa95f01b999c7f208`；對照 `5692474f7db70ab52a7a71c8af4867609e7e4b43` | `7a8c0cb4e27960b9477f58323c46566bbbb4591009da9da9ebd919243cd869ed` | 329（不含 SHA256SUMS） | [GENERATION.md](./generations/r3-2026-10-08/GENERATION.md) |
| `generations/r4-2026-10-08/` | **DRAFT — ATM PR #214 完成率最佳化驗證（未再外審）；r5 起為歷史（保留、不可變）** | 驗證 pin `2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`；對照 `bea35380d7f381f998c9930fa95f01b999c7f208`、`5692474f7db70ab52a7a71c8af4867609e7e4b43` | `6aa0d178a32ee2b9df74679b2da4aa2575fd4bb10e8e4571418a18fffe81a7e7` | 363（不含 SHA256SUMS） | [GENERATION.md](./generations/r4-2026-10-08/GENERATION.md) |
| `generations/r5-2026-10-08/` | **DRAFT — ATM PR #216 核心層鎖／孤兒 temp 清理／apply 佇列驗證＋四版同場重跑（未再外審；作者自行執行、未獨立重現）；r6 起為歷史（保留、不可變）** | 驗證 pin `37847584e24afc08ea58cfe380bb5b1220fbe335`（queue on／off 兩臂）；對照 `2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`、`bea35380d7f381f998c9930fa95f01b999c7f208`、`5692474f7db70ab52a7a71c8af4867609e7e4b43` | `2a4bfb184debaeb85a7283d990b92ba270732c344052497052761844f42a257a` | 431 | [GENERATION.md](./generations/r5-2026-10-08/GENERATION.md) |
| `generations/r6-2026-10-09/` | **DRAFT — ATM PR #238 apply 佇列 SQLITE_BUSY 修正小型驗證（未再外審；作者自行執行、未獨立重現）** | 驗證 pin `b35a6141bd5bfbaec654f1cd3079323581b04074`（queue on／off 兩臂）；對照 `37847584e24afc08ea58cfe380bb5b1220fbe335`（queue on） | `56cda563e8423d391ff4f85ad19a6a9ee1feb3ae5a188f4cad5d4b63cbc3dd3f` | 486 | [GENERATION.md](./generations/r6-2026-10-09/GENERATION.md) |

r1 簡寫：`R1=generations/r1-reviewed-2026-10-07`。 r2 簡寫：`R2=generations/r2-2026-10-08`。r3 簡寫：`R3=generations/r3-2026-10-08`。r4 簡寫：`R4=generations/r4-2026-10-08`。r5 簡寫：`R5=generations/r5-2026-10-08`。r6 簡寫：`R6=generations/r6-2026-10-09`。驗證（唯讀）：r1 目錄執行 `bash verify.sh`（r1 腳本需 bash）；r2–r6 目錄執行 `sh verify.sh` 或 `bash verify.sh`。

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

## 7. r2 回應外審 P0（2026-10-08）

> 完整對照與狀態見 `R2/GENERATION.md` §4。§3 中 r1 列的「P0」註記於 r2 的處置如下；r1 檔案本身未改。

| 項目 | r2 位置 | 狀態 | 結論／數字 |
|------|---------|------|-----------|
| P0-1 E4 p2 s17 lost=1 | `R2/summaries/runs/r2-e4-forensics/E4_FORENSICS.md`、`R2/raw/r2-e4-forensics.tgz` | 鑑識完成 → **反例** | 真實多 process lost update（s17-t000-i0 被另一 process 的 s17-t000-i6 覆蓋，同 base 3c1ad38d）；主因 harness 未把 steward apply 納入 apply lock，促成因素 ATM pin steward apply 為 check-then-write／非原子寫入。replay r1cfg 75 run：4 失敗、6 lost、1 torn write；slock 75 run：0。slock 僅為 mitigation candidate |
| P0-2 oracle presence-based | `R2/harness/src/oracle_v2.mjs`、`R2/harness/test/oracle_v2_contract.mjs`、`R2/summaries/runs/r2-analysis/r2-2026-10-08/oracle-rescore/` | 已修正 | full-bytes＋frame＋structure；10 個 contract 案例通過；r1 全部 stage 重評分 0 判定改變；r2 replay 1 cell 10 判定 correct→frame_violation（3164→3154） |
| P0-3 reproduce／checksum | `R2/harness/reproduce.sh`、`R2/harness/tools/{verify,analyze,rerun,seal}.sh`、`R2/SHA256SUMS`、`R2/MANIFEST.json` | 已修正 | verify 嚴格唯讀（`sha256sum -c --strict`）；原始路徑、無 flattened seed 碰撞；r1 舊 `checksums.sha256`／`artifact_manifest.json` 不再攜帶 |
| Phase 1 E 重建 | `R2/summaries/runs/r2-analysis/r2-2026-10-08/{tables,r1-extractors,cell-index}/` | 已完成 | E1 45/45、E2 150/150、E3 120/120、E4 18/18 cell 全欄一致；r1 E3/E4 extractor 輸出 IDENTICAL；547 cell index |
| logical_id stub（E1/E2） | `…/logical-id-audit/` | 部分（稽核通過） | 200/200 cell：1 submit／1 terminal／≤1 correct；129 op 有多次 attempt（CAS retry） |
| 草稿／F2 | `R2/paper/ATM_PAPER_V2_DRAFT_zh.md`、`R2/tables/F2_CORRECTNESS_TABLES.md` | 已更新（DRAFT） | 版本錨點更正；E4 改為反例表（p2/p4/p8/SP＝63/106、60/106、56/106、94/106，p2 lost=1） |
| 未解決 | — | open | ATM 端 guard／部署契約、barrier 控制的 2-process 契約測試、真 logical_id／re-propose、process-local window、CI／統計、Phase 2–3、正文逐節同步 |

r2 raw（deterministic tar＋`gzip -n`）：

| 檔案 | bytes | sha256 |
|------|------:|--------|
| `R2/raw/r2-e4-forensics.tgz` | 8,181,088 | `dcabd78b8136622deea92e27de9ac2063bd8f9c7fd8d306e5f786fed358bab62` |
| `R2/raw/r2-smoke.tgz` | 108,716 | `06f54986b642a4cba1f3d01bd7f4ce2bbb6a4596af77761498f1f8bcfeb4399b` |

r2 不重複打包 r1 raw；r2 分析所讀之 r1 raw 即 §4 所列（亦見 `R2/R1_REFERENCES.md`）。

## 8. r3：ATM PR #213（merge `bea35380`）steward 跨 process 修正驗證（2026-10-08）

> 完整對照見 `R3/GENERATION.md`。r1／r2 檔案與 §7 內容不變；r2 的 E4 反例保留為歷史。

| 項目 | r3 位置 | 狀態 | 結論／數字 |
|------|---------|------|-----------|
| r3 pin | `R3/summaries/runs/r3-validation/PINS.json`、`…/ATM_CORE_DIFF_5692474f..bea35380.patch` | 已記錄 | commit tarball 內嵌 commit 相符；harness 載入的 `packages/core` 只差 3 個 steward 檔 |
| 確定性 barrier 交錯 | `R3/harness/test/barrier_interleave.mjs`、`R3/summaries/runs/r3-validation/barrier/` | 已完成 | 5692474f：40/40 lost；bea35380：0/40（同 region→follower blocked、只留 leader；上下分離→re-compose 後兩者皆在） |
| E4 重播（r2 同配置，每臂 75） | `R3/summaries/runs/r3-analysis/r3-2026-10-08/r3-compare/R3_TABLES.md`、`R3/raw/r3-replay.tgz` | 觀察（非證明） | 5692474f：8 失敗 runs／12 lost；bea35380（harness 鎖 off）：0／0、損壞 0、18 re-compose（計入非完成）；bea35380＋harness 鎖：0／0 |
| r1 E4 18 cells 重跑 | `R3/raw/r3-matrix.tgz` | 觀察 | 5692474f：1 lost（fault_naive p8 s23）；bea35380：0 |
| 單 process 回歸 | `R3/raw/r3-regression.tgz` | 觀察 | 15 組正確性計數相同；steward 延遲差在雜訊內；bare composer mean +1.8%／p95 +9.5 ms |
| 草稿／F2 | `R3/paper/ATM_PAPER_V2_DRAFT_zh.md` 表 R3b、`R3/tables/F2_CORRECTNESS_TABLES.md` | 已更新（DRAFT） | 不主張勝出；MP 正確性結論依 §5.7 不自動恢復 |
| 未解決 | — | open | recovery-required 路徑、tmpdir 鎖範圍、鎖內 crash、fsync、外部寫入者、re-propose stub、CI／統計、Phase 2 其餘、Phase 3 |

r3 raw（deterministic tar＋`gzip -n`；r1／r2 raw 不重包，見 `R3/PRIOR_REFERENCES.md`）：

| 檔案 | bytes | sha256 |
|------|------:|--------|
| `R3/raw/r3-matrix.tgz` | 2,538,593 | `47ca242c4a7ec230499383ff970c5c7f74048a96431d201079da732e84f6357d` |
| `R3/raw/r3-regression.tgz` | 4,590,821 | `1d8da8253fd80cad465acc7ce5b301fb3e2b022931773c0a22af3fc2ad39637e` |
| `R3/raw/r3-replay.tgz` | 12,384,664 | `02e4ea1e18ed5415a7ef7551a4f55200bf9ba971f55cb36b52bd4f5b5e85332a` |
| `R3/raw/r3-sp-noise-and-smoke.tgz` | 1,831,095 | `12c45bf9f6f94f0a7fb6b39c859b32f4dc7ff697e0379297e6605b60996b5bd9` |
| `R3/raw/r3-stdout.tgz` | 32,075 | `0d9e606c4b25cbdb206ce254640accdbabc2dae1223b609326c998380178a096` |

## 9. r4：ATM PR #214（merge `2118bc66`）steward 完成率最佳化驗證（2026-10-08）

> 完整對照見 `R4/GENERATION.md`。r1–r3 檔案與 §7、§8 內容不變。r4 全部數字為作者自行執行、**未獨立重現**；完成與遺失分開報告。CI 另列：PR #214 CI：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆綠，但 CI 不重跑論文實驗。

| 項目 | r4 位置 | 狀態 | 結論／數字 |
|------|---------|------|-----------|
| r4 pin | `R4/summaries/runs/r4-validation/PINS.json`、`…/ATM_CORE_DIFF_bea35380..2118bc66.patch` | 已記錄 | commit tarball 內嵌 commit 相符；harness 載入的 `packages/core` 改 5 檔、新增 `steward-region-rebase.ts`；run 後三 pin core 樹 hash 不變 |
| 最佳化 (a)–(d) | 論文 §4.11 | (a)(b)(c)(d1)(d2) 已實作；**(d3) broker 序列化 apply 佇列未實作**；CID 錨定未實作（只做 region 標記） | 只有 (c) 能經 `recomposePolicy` 消融；(a)(b)(d) 不改程式碼就無法關閉 |
| E4 重播（r3 同配置，每臂 75） | `R4/summaries/runs/r4-analysis/r4-2026-10-08/r4-compare/R4_TABLES.md`、`R4/raw/r4-replay-pins.tgz` | 觀察（非證明） | 2118bc66：完成 1,748/2,610、0/75 runs 失敗、0 遺失、862 blocked（全為 `steward-final-patch-required`）、損壞 0；bea35380：1,553、0、0、1,057；5692474f：1,580、5/75 runs 失敗、合計遺失 6、1,024。非全部成功；未做顯著性／非劣性檢定 |
| 消融與次要臂 | `R4/raw/r4-replay-secondary-ablation.tgz` | 觀察 | 重試 0／1／4：1,718／1,752／1,748；第 3–5 次嘗試未觸發；2118bc66＋harness 鎖：1,841、0 遺失 |
| r1 E4 18 cells 重跑 | `R4/raw/r4-matrix.tgz` | 觀察 | 5692474f：2 個遺失效果（fault_naive p8、fault_nolock p8）；bea35380、2118bc66：0 |
| 確定性 barrier（seam／stale-proposal／before-precheck） | `R4/harness/test/barrier_interleave.mjs`、`R4/summaries/runs/r4-validation/barrier/` | 已完成（240 次；v1 before-precheck 作廢另存） | 5692474f seam 合計遺失 40；bea35380、2118bc66 0 |
| 故障情境 F1–F6 | `R4/harness/test/r4_fault_scenarios.mjs`、`R4/summaries/runs/r4-validation/faults/` | 已完成 | F1–F5：2118bc66 0 遺失（rename 前被殺留孤兒 temp 檔）；**F6 跨 PID namespace：2118bc66 兩方向各 10/10 遺失＝反例** |
| 單 process 回歸 | `R4/raw/r4-regression.tgz` | 觀察 | 15 組正確性相同；steward total_ms mean +2.4% |
| 草稿／F2 | `R4/paper/ATM_PAPER_V2_DRAFT_zh.md` §4.11、表 R4；`R4/tables/F2_CORRECTNESS_TABLES.md` 表 A-r4 | 已更新（DRAFT） | 含 2026-10-08 13:51 分列措辭修訂；不主張勝出 |
| 未解決 | — | open | F6 存活判斷、broker 佇列、temp 清理、CID 錨定、fsync、外部寫入者、真實容器、統計、獨立重現、**Phase 3 450-run 未做** |

r4 raw（deterministic tar＋`gzip -n`；r1–r3 raw 不重包，見 `R4/PRIOR_REFERENCES.md`）：

| 檔案 | bytes | sha256 |
|------|------:|--------|
| `R4/raw/r4-matrix.tgz` | 3,554,858 | `caef94dfcc542c192195ae24bbe917978f0ba5b5b8e94f8deb3b730f6e3f3526` |
| `R4/raw/r4-regression.tgz` | 4,597,078 | `5ae39cc6ad38e90d1815373c6ca4bd1c05874632c478b69c9a130eaa5f38df4c` |
| `R4/raw/r4-replay-pins.tgz` | 12,395,334 | `a1511386bdf12c5fa0a9f5374502bfa38ce22d13767350ce4d4d9834f6bb6774` |
| `R4/raw/r4-replay-secondary-ablation.tgz` | 12,459,625 | `3ba5ad0fe8bf6883d7e47f17c657887310bb6c0a989302336b8a174ef849669b` |
| `R4/raw/r4-stdout.tgz` | 52,626 | `b5f90c04e59f3dbbf7de9d109c941e70560211d9d9200978eef2878dec98565d` |

r4 上傳包大小超過 25 MB，因此拆成兩個獨立 tarball，兩者都解到同一個 `generations/r4-2026-10-08/` 路徑，必須兩者都解開後才能執行 `verify.sh`。

## 10. r5：ATM PR #216（merge `37847584`）核心層鎖、孤兒 temp 清理與 apply 佇列驗證（2026-10-08）

> 完整對照見 `R5/GENERATION.md`；偏離與事件見 `R5/summaries/runs/r5-validation/DEVIATIONS.md`。r1–r4 檔案與 §7–§9 內容不變。r5 全部數字為作者自行執行、**未獨立重現**；完成與遺失分開報告；Wilson 區間為描述性。CI 另列：PR #216 feature head 與 merge 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆 green（只跑框架測試；CI 記錄無法證明跨 namespace 測試真的互鎖）。Phase 3（450-run 主矩陣）**未執行**。

| 項目 | r5 位置 | 狀態 | 結論／數字 |
|---|---|---|---|
| r5 pin | `R5/summaries/runs/r5-validation/PINS.json`、`…/ATM_CORE_DIFF_2118bc66..37847584.patch` | 已記錄 | tarball 內嵌 commit 相符；四 pin 前後 core tree hash 不變 |
| E4 重播（同配置，每臂 75；四版同場） | `R5/summaries/runs/r5-analysis/r5-2026-10-08/r5-compare/R5_TABLES.md`、`R5/raw/r5-replay-main.tgz` | 觀察（非證明） | 37847584 queue on／off：完成 1,716／1,705（/2,610），0/75 失敗、0 遺失；2118bc66 1,727、0；bea35380 1,534、0；5692474f 1,515、6/75 失敗、6 遺失 |
| re-compose 消融 | `R5/raw/r5-replay-recompose-ablation.tgz` | 預先登錄臂無區分力；事後臂探索性 | queue on＋0／1 次：re-compose 0 次（無區分力）；queue off（事後）預設／0／1 次：1,759／1,679／1,723；同設定時段差 54 |
| r1 E4 18 cells 重跑 | `R5/raw/r5-matrix.tgz` | 觀察 | 5692474f 2 遺失；其餘 0 |
| 確定性 barrier | `R5/summaries/runs/r5-validation/barrier/` | 已完成 | 5692474f seam 40/40 遺失；其餘 0；37847584 seam／before-precheck 以 queue off（queue on 探索性 0/10） |
| 故障情境（F1–F7、F2b、O2；含 F6 真實 `unshare`） | `R5/harness/test/r5_fault_scenarios.mjs`、`R5/summaries/runs/r5-validation/faults/` | 已完成 | 37847584 qon／qoff 0 遺失；F6 namespace 分離確認 60/60；2118bc66 F6 20/20、偽造 owner 10/10 遺失、孤兒 temp 10/10；37847584 孤兒於取鎖後刪除 20/20、活 temp 60/60 未刪 |
| 已知限制（非 §5.7 反例） | `R5/summaries/runs/r5-validation/forensics/sqlite-busy/` | 已鑑識、已重現 | apply 佇列 SQLITE_BUSY 例外：queue on 臂 8 intents 未完成（fail-closed，0 遺失），presence 檔洩漏 |
| 單 process 回歸、E5 | `R5/raw/r5-regression.tgz`、`R5/raw/r5-e5.tgz` | 觀察 | 完成與遺失不變；E5 注入五臂 12/12 |
| 草稿／F2 | `R5/paper/ATM_PAPER_V2_DRAFT_zh.md` §4.11、§6 表 R3–R5、附錄 E／F；`R5/tables/F2_CORRECTNESS_TABLES.md` 表 A-r5 | 已更新（DRAFT） | 正文只列結果；過程與 PR 移至附錄；不主張勝出 |

r5 raw（deterministic tar＋`gzip -n -9`；r1–r4 raw 不重包，見 `R5/PRIOR_REFERENCES.md`）：

| 檔案 | bytes | sha256 |
|---|---:|---|
| `R5/raw/r5-e5.tgz` | 745,920 | `0f622825e79ddac44955a7de34e8a5eb36076e29ab43bb2a140dae7642866141` |
| `R5/raw/r5-matrix.tgz` | 4,957,071 | `9a55b1b81bab0fa1a9b61f5b005b1f44a056e8782a3e967aa187c0eba4312dd9` |
| `R5/raw/r5-regression.tgz` | 5,331,411 | `0c0e4b78757add8b1120abe5639e3169c5b537ad0eea9bd6430964fdf7b18b28` |
| `R5/raw/r5-replay-main.tgz` | 20,878,145 | `4b27c57e867b73506b9adadbc6e1185609f1f6da0513f561c22079df8a28bfd2` |
| `R5/raw/r5-replay-recompose-ablation.tgz` | 21,212,703 | `6a8b03015e04a3b14d0136e66538cd4d3222cb80aeb44aef50c433df2c39a546` |
| `R5/raw/r5-stdout.tgz` | 83,694 | `bd0d989b35c76893a4f0605a606d60ffc21094a198c5102374fa570939f04fb5` |

r5 上傳包拆成三個獨立 tarball（各 < 25 MB），都解到同一個 `generations/r5-2026-10-08/` 路徑，三者都解開後才能執行 `verify.sh`（解壓順序不限）。

## 11. 工作稿快照（working docs snapshots；非 generation）

> **DRAFT 工作稿，不是封存的證據 generation，不主張任何結論。** 目的：論文 2.0 的所有產出都進 repo，不只留在 box 上。每個快照目錄建立後即不可變；之後的工作稿另開新日期目錄。r1–r6 generation 不受影響。論文數字只引用 generation，不引用工作稿快照。

| 快照 | 狀態 | 比對基準 | SHA256SUMS sha256 | 檔案數 | 說明 |
|---|---|---|---|---:|---|
| `working-docs/2026-10-09/` | DRAFT 工作稿快照（不可變；非 generation） | main tree `ed12396c`（含 r1–r5 與 `archive/` 各 tgz 成員內容） | `e980067ebfc8b48ce92800ee5291f3bdb0f9715961028ea33783afd88cb0c0c2` | 79（不含 SHA256SUMS） | [SNAPSHOT.md](./working-docs/2026-10-09/SNAPSHOT.md)；逐檔盤點 `INVENTORY.tsv`（1,580 檔：1,503 已在 main、33 過時版、44 缺）；驗證：`sh working-docs/2026-10-09/verify.sh` |

內容：`benchmark-survey/`（公開 benchmark 調查、歷史 commit/PR benchmark 預先註冊計畫草稿，尚未執行任何 run）；r5 v1 分析（superseded）與 r2 早期 rescore 輸出中與 main 不同者；r2／r4／r5 封存前中間版與論文 checkpoint；2026-10-06 harness 原始碼早期備份；先前交接用 EVIDENCE_INDEX／README 提案、patch 與 build 腳本。論文 v1 arXiv 副本仍依 §6 不上傳。

## 12. r6：ATM PR #238（merge `b35a6141`）apply 佇列 SQLITE_BUSY 修正驗證（2026-10-09）

> 完整對照見 `R6/GENERATION.md`；偏離與事件見 `R6/DEVIATIONS.md`。r1–r5 檔案與 §7–§11 內容不變。r6 是小型驗證（每臂 150 runs），全部數字為作者自行執行、**未獨立重現**；完成與遺失分開報告；Wilson 區間為描述性。CI 另列：PR #238 feature head `2712c024` 與 merge `b35a6141` 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆 green。Phase 3（450-run 主矩陣）**未執行**。

| 項目 | r6 位置 | 狀態 | 結論／數字 |
|---|---|---|---|
| 預先登錄 | `R6/PREREG_R6.md` | 執行前固定（sha256 `c5f42235…`） | 臂 q5（37847584 queue on）、q6（b35a6141 queue on）、nq6（b35a6141 queue off）；r5 seeds |
| r6 pin | `R6/PINS.json`、`R6/summaries/runs/r6-validation/ATM_CORE_DIFF_37847584..b35a6141.patch` | 已記錄 | tarball 內嵌 commit 相符；兩 pin 前後 core tree hash 不變；diff 含 #238 以外的 `sqlite-runtime.ts`（D5） |
| E4 重播（r5 同配置，每臂 2×75） | `R6/summaries/runs/r6-analysis/r6-2026-10-09/r6-compare/R6_TABLES.md`、`R6/raw/r6-replay-*.tgz` | 觀察（非證明） | 完成 q5／q6／nq6：3,490／3,500／3,458（/5,220）；0/150 失敗、0 遺失；SQLITE 例外 1（q5，1 run）／0／0；presence 殘留 1／0／0 |
| E4 完整 cells | `R6/raw/r6-matrix.tgz` | 觀察 | 213／209／210（/318）；0 遺失、0 例外 |
| 佇列壓力重現 | `R6/summaries/runs/r6-validation/forensics/sqlite-busy/` | 預先登錄＋† 探索性 | 8×300×3：37847584 1／7,200、b35a6141 0；† 16×1,000×3：78／48,000、0（presence 殘留 78／0） |
| 故障情境（b35a6141 qon／qoff；含 F6 真實 `unshare`） | `R6/summaries/runs/r6-validation/faults/` | 已完成 | 0 遺失、0 frame 壞；F6 namespace 分離 40/40、both_inside_lock 0；孤兒 temp 取鎖後刪除 20/20；活 temp 60/60 未刪 |
| 確定性 barrier | `R6/summaries/runs/r6-validation/barrier/` | 已完成 | 6 案例 × 10，0 遺失 |
| r5 已知限制 D6 | 論文 §7.1、附錄 G | **已於 #238 修正** | b35a6141 0 例外、0 presence 殘留；退回檔案鎖次數不可觀察（D6） |
| 反例（§5.7） | `R6_TABLES.md` §6 | 無 | 遺失、損壞、frame 壞全為 0 |
| 草稿／F2 | `R6/paper/ATM_PAPER_V2_DRAFT_zh.md` §4.11、§6 表 R3／R6、§7.1、附錄 G、參考文獻 [23]；`R6/tables/F2_CORRECTNESS_TABLES.md` 表 A-r6 | 已更新（DRAFT） | 正文只列結果；過程在附錄 G；不主張勝出 |

r6 raw（deterministic tar＋`gzip -n -9`；r1–r5 raw 不重包，見 `R6/PRIOR_REFERENCES.md`）：

| 檔案 | bytes | sha256 |
|---|---:|---|
| `R6/raw/r6-matrix.tgz` | 1,552,057 | `b8509e88e954bb343d58d0845e7abc75140a20233f4e006d7821252f2ce68be2` |
| `R6/raw/r6-replay-nq6.tgz` | 8,372,349 | `a474dfc3cb7123a9a5e9fe7466dc0b60607eb01c7392cbc6da13671e6a85c813` |
| `R6/raw/r6-replay-q5.tgz` | 8,514,969 | `10871c47d8c94566e4afdb30e46c02ccb7a0665983de1fe62987761130c32d10` |
| `R6/raw/r6-replay-q6.tgz` | 8,497,808 | `5761d9ff336caeef8c5f423741aac828d660bdf0c24a637a8e960cc0fedd75c8` |
| `R6/raw/r6-stdout.tgz` | 44,283 | `b2dbd4d0f6160270717133725611121946d882c4ffddc1b49d94ca24923d8648` |

r6 上傳包拆成多個獨立 tarball，都解到同一個 `generations/r6-2026-10-09/` 路徑，全部解開後才能執行 `verify.sh`（解壓順序不限）。

## 13. 歷史真實 PR benchmark 試跑（HIST-PAIRS，STALE 方法）：冒煙測試＋Django pilot（2026-10-09，試跑，不列入正式結果）

> 作者執行，尚未獨立重現。CI 只驗證檔案與 SHA256SUMS 一致，不重跑實驗。450-run 矩陣仍未完成；主跑（約 9,750 runs）尚未開始，需作者確認。

| 試跑 generation | 路徑 | 內容 | 驗證 |
|---|---|---|---|
| 冒煙測試 | `benchmark-trials/2026-10-09-hist-smoke/` | Django 3 對 × 5 arm × 1 seed（15 runs）＋15 個植入故障 run；完整挖掘資料（PR 快照、資格與排除理由、候選對、抽樣）；harness 原始碼快照；Django LICENSE/NOTICE | `sh benchmark-trials/2026-10-09-hist-smoke/verify.sh` → 422 OK |
| Django pilot | `benchmark-trials/2026-10-09-hist-pilot/` | Django 30 對 × 5 arm × 2 seed = 300 runs；語意終點（STALE：同一聯集測試、只計合併後新失敗）；與 git gold 的獨立逐位元組比對 | `sh benchmark-trials/2026-10-09-hist-pilot/verify.sh` → 2356 OK |

- ATM pin：b35a6141（#238 合併後的 main）。
- 冒煙：steward 完成 69/71 個 intent，失敗 0/3 run，遺失效果 0，blocked 2（ATM 無法以 steward patch 建立新檔），損毀檔 0；植入故障 15/15 被 oracle 抓到。
- Pilot：steward 完成 933/964，失敗 0/60 run，遺失效果 0，blocked 31（file-hash-drift 22、re-compose context mismatch 5、新檔 4），損毀檔 0。git_three_way 基準 arm：失敗 2/60 run，合計遺失 5 個效果（預期中的 lost update，照實列出）。
- 限制：Django 2024–2025 在凍結規則下 O1（同一 hunk）層為 0 對，本試跑未涵蓋同 hunk 情境；偏離紀錄見各 generation 的 DEVIATIONS.md。

## 14. 歷史真實 PR benchmark：六專案重新挖掘（合併 commit base）與可行性評估（2026-10-09，只挖掘，沒有 run，不列入正式結果）

> 作者執行，尚未獨立重現。CI 只驗證檔案與 SHA256SUMS 一致。本 generation **沒有任何 arm run**，也沒有抽主樣本；主跑（約 9,750 runs）尚未開始，需作者確認。450-run 矩陣仍未完成。

| generation | 路徑 | 內容 | SHA256SUMS sha256 | 檔案數 | 驗證 |
|---|---|---|---|---:|---|
| 挖掘＋可行性 | `benchmark-trials/2026-10-09-hist-mining/` | 6 個 prereg 專案（Django、SymPy、xarray、pytest、Sphinx、FastAPI）的 PR 快照（含 merge_commit_sha）、PR 資格與排除理由、所有配對與理由碼、可行性 dry-run、prereg v1.1 提案草稿（未套用）、挖掘腳本與凍結規則副本 | `d2d6512a665f0e841aebb8f1e76343cbfa81856f880e687ac89f468489a2bef5` | 85（不含 SHA256SUMS） | `sh benchmark-trials/2026-10-09-hist-mining/verify.sh benchmark-trials/2026-10-09-hist-mining` → 85 OK |

- PR base 改回 prereg §3.1(4) 的合併 commit 公式（修正試跑偏離：沒有 token 時無法取得合併 commit、162 個 fast-forward PR 被排除）。其他凍結選取規則不變。
- 候選配對（凍結規則）：Django 239、SymPy 99、xarray 568、pytest 108、Sphinx 223、FastAPI 196；六個專案在每 PR 最多 2 對的限制下都抽得到 50 對（dry-run，非正式主樣本），但幾乎全由 O3 補位。
- O1（同一 hunk）：合計 7 對（SymPy 6、Sphinx 1），其中 6 對是兩邊修改相同，**改法不同的只有 1 對**。1,205 個 drift 排除中 1,164 個是後合併的 PR 在合併前已 rebase 到對方之上。
- prereg v1.1 提案（草稿，**未套用**，待作者決定）：對已 rebase 的 PR 改用 rebase 前的 head，估計多出 70 個改法不同的 O1（每 PR 上限 2 時約 65）。見 `PREREG_v1.1_PROPOSAL_zh.md`。
- 未納入：各專案 `pairs_eligible.jsonl`（含上游程式碼，約 510 MB），SHA-256 記在 MANIFEST.json `regenerable_not_included`，可由 `scripts/build_pairs_merge.py` 決定性重建。GitHub token 只經環境變數使用，不在任何檔案中。

## 15. 歷史真實 PR benchmark：預先登記 v1.1（凍結）與主樣本（2026-10-10，沒有任何 run 結果）

> 作者執行，尚未獨立重現。CI 只驗證檔案與 SHA256SUMS 一致。本 generation 在任何主跑結果產生**之前**凍結選取規則、種子、主樣本與逐 run 的 seed 表；**沒有 run 結果**。450-run 矩陣仍未完成。

| generation | 路徑 | 內容 | SHA256SUMS sha256 | 檔案數 | 驗證 |
|---|---|---|---|---:|---|
| prereg v1.1＋主樣本 | `benchmark-main/2026-10-10-hist-prereg-v1.1/` | 預先登記 v1.1 正式版（選項 P：已 rebase 的 PR 改用 rebase 前 head）、凍結收據（抽樣前 2026-10-10 00:13:09 台北時間）、選項 P 建構與抽樣腳本、P 候選池、主樣本 300 對＋O0 30 對（含上游程式碼與授權聲明）、9,750 runs 的 seed 表、pins | `3ff382d11044821d642e5a61b8de934817b664b03492a734f660d05b75de9a86` | 36（不含 SHA256SUMS） | `sh benchmark-main/2026-10-10-hist-prereg-v1.1/verify.sh benchmark-main/2026-10-10-hist-prereg-v1.1` → 36 OK |

- 作者決定（2026-10-10 00:05 台北時間）：採用選項 P、先小量確認再主跑。
- 選項 P 候選池 405 對：O1 改法不同 72、O1 相同修改 5、O2 39、O3 289。
- 主樣本 300 對（6 專案 × 50）：O1 72／O2 51／O3 177；規則 v1.0 189／v1.1-P 111。O1 中改法不同 63（其中 rebase 前 62）、相同修改 9。
- 計畫 runs：主矩陣 7,500＋舊 pin（5692474f，只跑 steward）1,500＋O0 750＝9,750。ATM pin 20effd45（`packages/core` 與 b35a6141 相同）。
- 含 rebase 前 writer 的配對（所有 O1-P）只算寫入安全終點，語意終點標「不可評估」。

## 16. 歷史真實 PR benchmark：prereg v1.1 小量確認試跑（2026-10-10，試跑，不列入正式結果）

> 作者執行，尚未獨立重現。CI 只驗證檔案與 SHA256SUMS 一致。試跑，不算正式結果。450-run 矩陣仍未完成。

| generation | 路徑 | 內容 | SHA256SUMS sha256 | 檔案數 | 驗證 |
|---|---|---|---|---:|---|
| 確認試跑 | `benchmark-trials/2026-10-10-hist-confirm-v1.1/` | 5 對（含 2 個 O1 改法不同的 rebase 前配對）× 5 arm × 1 seed＝25 runs；O1 配對上 5 種植入故障；舊 pin steward 5 runs；共 36 runs | `fd1aa23b33a77c1ee3f60aed8492808fc101d6017aa9a318c532b4e1d1181fe9` | 359（不含 SHA256SUMS） | `sh benchmark-trials/2026-10-10-hist-confirm-v1.1/verify.sh benchmark-trials/2026-10-10-hist-confirm-v1.1` → 359 OK |

- 現行 pin（20effd45）steward：完成 130/146、失敗 run 0/5、遺失 0、被擋 16（其中 15 個是 harness 在呼叫 ATM 前的重新定位失敗，1 個是新建檔）、損毀 0；沒有 §5.7 反例。
- 植入故障 5/5 都被 oracle 抓到（覆寫遺失＋overlap_both_applied、還原 hunk、frame 位元組、尾端撕裂＋ast、外來檔＋殘留暫存檔）。
- 配對在主樣本抽完之後才從剩餘的 P 配對抽出，不在主樣本中。

## 17. 歷史真實 PR benchmark 主跑（2026-10-10）：§5.7 反例停止（只跑完 Django、SymPy，2,500／9,750 runs）

> 作者執行，尚未獨立重現。CI 只驗證檔案與 SHA256SUMS 一致。只做描述，不宣稱勝出。450-run 矩陣仍未完成。

| generation | 路徑 | 內容 | SHA256SUMS sha256 | 檔案數 | 驗證 |
|---|---|---|---|---:|---|
| 主跑（停止） | `benchmark-main/2026-10-10-hist-main/` | 依 prereg v1.1 的主跑：Django、SymPy 各 50 對 × 5 arm × 5 seed＝2,500 runs；§5.7 停止報告與鑑識；分析腳本與表格；語意終點的環境準備（未執行） | `55ef0a8a5f0a3ca7076c206023c704eb2fcabe6f5d66ea7f61ecc71c0c1e9c1b` | 18,146（不含 SHA256SUMS） | `sh benchmark-main/2026-10-10-hist-main/verify.sh benchmark-main/2026-10-10-hist-main` → 18146 OK |

- **反例（§5.7）**：steward（ATM 20effd45）在 `sympy:26412_26438`（O1、rebase 前版本）5 個 seed 中有 4 個出現 1 個遺失效果＋1 個損毀檔。根因可在單一寫入者、無並行下重現：PR 的檔案結尾沒有換行，ATM 套用 patch 時忽略 `\ No newline at end of file`，多寫了一個結尾換行；`git apply` 結果正確。舊版 5692474f 也一樣。整個樣本只有這一對會觸發。
- steward：完成 9,037/10,840（83.4%）、失敗 run 4/500、遺失 4、被擋 1,799（harness 重新定位 1,567、ATM hash drift 175、ATM 重新組合不符 22、新建檔 35）、損毀 4。
- 基準遺失照實列出：git_three_way 24（5 runs）、occ 24（4 runs）、bare_composer 1 遺失＋3 損毀。
- 未執行：xarray、pytest、Sphinx、FastAPI 主批次、O0、舊 pin、語意終點。要等作者決定（修 ATM 換 pin 開新 generation，或以同 pin 另標續跑）。

## 18. HIST main run v2 (2026-10-10): full rerun on the EOF-fixed ATM b1fd9d22 (9,750/9,750 runs, 0 steward counterexamples)

> Author-executed, not independently reproduced. CI only checks that the files match SHA256SUMS. Descriptive only; no win claims.
> The 450-run matrix is still not done. The stopped generation `2026-10-10-hist-main` stays unchanged as the "before fix" record.

| generation | path | contents | SHA256SUMS sha256 | files | verify |
|---|---|---|---|---:|---|
| main run v2 | `benchmark-main/2026-10-10-hist-main-v2/` | Full rerun under prereg v1.1: main 7,500 + O0 750 + old pin 1,500 steward = 9,750 runs; semantic endpoint; before/after; EOF-fix gate forensics | `c8289e15b1d2707e3bbbc7d96102b299daad4030e5ae596a74e3dbbd46df5111` | 76,692 (excluding SHA256SUMS) | `sh benchmark-main/2026-10-10-hist-main-v2/verify.sh benchmark-main/2026-10-10-hist-main-v2` → 76692 OK |

- **ATM b1fd9d22** (PR #252, the EOF-newline fix). The harness is unchanged.
- **Gate:** in the single-writer repro, steward output is byte-identical to git apply.
- **Main set, steward:** completed 29,077/34,300 (84.8%), failed runs 0/1,500, lost 0, corrupted 0.
  - Blocked 5,223: harness relocation 4,468 + 12, ATM hash drift 483, ATM re-compose mismatch 140, new file 120.
- **Baseline losses** are listed as is: git_three_way 36 lost (16 runs), occ 32 (10 runs), bare_composer 3 corrupted (2 runs).
- **O0:** 0 failed runs in every arm.
- **Old pin 5692474f, steward:** 25 failed runs, 57 lost effects, 5 corrupted files (secondary set).
- **Semantic endpoint:** 52 base-valid pairs, 0 arm regressions in every arm.
- **Before/after** (Django+SymPy, 2,500 runs), steward: lost 4 → 0, corrupted 4 → 0, failed runs 4 → 0.

## 19. 工作稿快照 2026-10-10：論文 2.0 草稿寫入 HIST 結果（DRAFT；非 generation）

> **DRAFT 工作稿，不是封存的證據 generation，不主張任何結論、不宣稱勝出。** 論文數字只引用 generation（r1–r6、§13–§18 的 HIST generation），不引用工作稿快照。快照建立後不可變；先前所有 generation 與 `working-docs/2026-10-09/` 不受影響。

| 快照 | 狀態 | 比對基準 | SHA256SUMS sha256 | 檔案數 | 說明 |
|---|---|---|---|---:|---|
| `working-docs/2026-10-10/` | DRAFT 工作稿快照（不可變；非 generation） | 修改前備份與 `generations/r6-2026-10-09/{paper,docs}/` 逐位元相同 | `9d269e2ec55f3afcc9977ea91fdcac70aa4ae218e8a37a8fc7167be632fb15bb` | 13（不含 SHA256SUMS） | [SNAPSHOT.md](./working-docs/2026-10-10/SNAPSHOT.md)；驗證：`sh working-docs/2026-10-10/verify.sh working-docs/2026-10-10` |

內容：論文 2.0 草稿（新增 §5.8 HIST 設計、§6.1 表 R7–R12：主樣本寫入安全、區間、blocked 理由、分層、結尾換行反例修正前後、HIST 版本演進、語意終點；§7.1 HIST 強度上限、§7.2 STALE、附錄 H 過程紀錄、參考文獻 [24]–[29]）；VERSION_ANCHORS、EXPERIMENT_CHECKLIST、METRIC_DEFINITIONS 各加一節 HIST；修改前備份與 diff。數字全部抄自 §13–§18 的封存分析輸出。Phase 3 450-run 主矩陣仍未執行。

DRAFT HIST-v2 prereg（非 generation、尚未凍結、沒有 run）：[`working-docs/2026-10-10-hist-v2-prereg/`](./working-docs/2026-10-10-hist-v2-prereg/README.md)，prereg SHA256 `ddb24018597ca8e485a4f42c0bc0972d2795e06e799efb4dabf63cb29839ad65`；〔待決 Dx〕未決前不得凍結。

## 6. 不在 repo 的參照
- ATM pin 原始碼：GitHub `eaglhuang/AI-Atomic-Framework` commit `5692474f7db70ab52a7a71c8af4867609e7e4b43`（r3 另加 `bea35380d7f381f998c9930fa95f01b999c7f208`，box tarball `/workspace/atm-main-bea35380/atm-main.tar.gz` sha256 `9346e5b175b176618f435aeb4b41ab93ef7575f9bf77d77c47a5aeac87ad34b5`；r4 另加 `2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`，box tarball `/workspace/atm-main-2118bc66/atm-main.tar.gz` sha256 `aa959607c35c51b7fc3c4e3d81b3d9e979ee62f4d9361ef9e9f5ee72e78abd88`；r5 另加 `37847584e24afc08ea58cfe380bb5b1220fbe335`，box tarball `/workspace/atm-main-37847584/atm-main.tar.gz` sha256 `e17a90ddceaf3c70d580c96e31f14cf8251d5a664985c1eb494f0d8db8045e3d`；r6 另加 `b35a6141bd5bfbaec654f1cd3079323581b04074`，box tarball `/workspace/atm-main-b35a6141/atm-main.tar.gz` sha256 `93fa7839d8e0fee51e5ad224833df2b57397fead3e77e0528117f21f5d5e59ef`）；box tarball `/workspace/atm-main-5692474f/atm-main.tar.gz` sha256 `1d498a397e6a5db119d40b8f539dc165cb0028fbfe9577f953023f8ec8d45795`。
- 論文 v1：arXiv:2607.00041（box `refs/` 有副本，未上傳）。
- `node_modules/`：依 `R1/harness/package.json` 安裝；實際版本見 `R1/harness/installed-deps.package-lock.json`（不是正式 lockfile，原 harness 無 `package-lock.json`）。

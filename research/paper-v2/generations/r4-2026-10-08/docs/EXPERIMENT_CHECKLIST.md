# ATM 論文 v2 — 必要實驗題目清單（可逐項執行）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07（Asia/Taipei） |
| 依據 | `COMPOSER_STEWARD_IMPL_PLAN.md`、可行性審閱 `ATM_PAPER_V2_FEASIBILITY_REVIEW.md`、草稿 `ATM_PAPER_V2_DRAFT_zh.md` |
| 原則 | 先規格／正確性，再 harness，再對照基線，最後規模與統計；前一階不過關不進下一階 |
| 約束 | 不 merge／不 npm publish／不打 tag（除非文一明示）；改 ATM 以 PR 為主 |

狀態：`todo` → `doing` → `done`／`blocked`

---

## A. 規格與校正（論文可信的前提；可先做、幾乎不改行為碼）

| ID | 題目 | 產出 | 依賴 | 狀態 |
|----|------|------|------|------|
| **A1** | 凍結版本錨點表（v1 tag／v0.1.17 historic／main／#198 candidate／final） | `VERSION_ANCHORS.md`（2026-10-07） | — | **done** |
| **A2** | 指標分母定義（offered／eligible／committed／correct／blocked／lost-among-committed／unresolved） | `METRIC_DEFINITIONS.md`（2026-10-07） | — | **done** |
| **A3** | 校正措辭：composition determinism、unified-diff context、identity＝角色檢查、rollback≠crash atomicity | 草稿 P0 修訂 | 審閱吸收 | todo |
| **A4** | 舊表 T6／R1 分母核對：附每 run 原始分子分母；64.9% 不逕改 | `T6_R1_DENOMINATOR_AUDIT.md`＋`runs/hot-file/t6_r1_raw_counts.json`＋T6 勘誤註 | 既有 runs | **done** |
| **A5** | 實驗封包清單：probe／oracle／rebuild 入口要有哪些檔 | `ARTIFACT_PACK_SPEC.md`（2026-10-07） | — | **done** |

---

## B. 單檔正確性（S 族；對應 RQ1；M0→M1）

| ID | 題目 | 期望 | 依賴 | 狀態 |
|----|------|------|------|------|
| **B1** | 固化 v0.1.17 探針紅燈基準（含 S1a 綠＋S1b／S2／S3 紅） | `runs/composer-probe/`（README／EXPECTED／probe.out／checksums） | — | **done** |
| **B2** | S1b：上方插入＋下方修改；**兩種排序** | 皆 applied；輸出 byte hash 相同 | M1 core 合成 | **done**（#198） |
| **B3** | S2：同行重疊衝突 | `blocked` 收據＋檔不變；**不 throw** | M1 P0-2/3 | **done**（#198） |
| **B4** | S3：proposer＝stewardId（API＋CLI） | `invalid-steward-identity`；檔不變 | M1 P0-4 | **done**（#198） |
| **B5** | S4：compose 後 base 被改（stale） | blocked／可 re-propose | 既有路徑回歸 | **done** |
| **B6** | 邊界擴展：同 gap 雙插入、相鄰端點、context 重疊但變更不交疊、檔首／檔尾、多 hunk | 依凍結契約拒或收 | A1 契約選定 | **done** |
| **B7** | 排列／property：重排 proposal 不變、拒絕前後 hash、frame property | metamorphic 測試綠 | M1 | **done** |
| **B8** | 多檔 rollback／failAfterWrites（S5） | rolled-back；標「例外補償」非 crash atomicity | 既有 | **done** |

> **B1 done（2026-10-07）**：historic 紅燈已固化於 `runs/composer-probe/`。**B2–B4 done（同日）**：#198 merge 後獨立驗收轉綠；v0.1.17 仍是紅燈基準。
> **B5–B8 done（2026-10-07 22:43 CST）**：真 S4／邊界契約／排列 property／S5 rollback；證據 `runs/b5-b8/`。**B 階完成**。

---

## C. Harness 真接線（對應 M2；無此不能報主結果）

| ID | 題目 | 產出 | 依賴 | 狀態 |
|----|------|------|------|------|
| **C1** | `--atm-writer steward`：真 `PatchProposal`→compose→中立 steward apply | 新 writer 臂 | M1 | **done** |
| **C2** | compose window／batch closure 語意＋事件欄位 | verdict／blocked／repropose／proposer_direct_writes | C1 | **done** |
| **C3** | 獨立 oracle（完整 bytes／效果 ID，不只 marker） | oracle 腳本＋對帳 | A2 | **done** |
| **C4** | 診斷臂：raw overwrite、admission-only（stale）、ideal sync | 動機／上界參考；不作正確性競爭者 | C1 | **done** |

---

## D. 強基線對照（審閱表 6；主效果所依）

| ID | 題目 | 回答的問題 | 依賴 | 狀態 |
|----|------|------|------|------|
| **D1** | per-file lock 序列化基線 | 保守正確成本 | C1–C3 | **done** |
| **D2** | optimistic CAS＋retry（失敗重建／rebase） | OCC 成本 | C1–C3 | **done** |
| **D3** | Git three-way（同 base／同 patches；披露 n-way fold） | 既有合併能力比較 | C1–C3 | **done** |
| **D4** | bare composer（同合成＋guarded apply，關 broker 准入） | 隔離合成收益 vs 路由治理 | C1 | **done** |
| **D5** | 完整 ATM composer＋steward（主方法） | RQ2 主臂 | M1+C | **done** |

---

## E. 工作負載與主矩陣（對應 RQ2–RQ3；pilot→主結果）

| ID | 題目 | 最小規模建議 | 依賴 | 狀態 |
|----|------|------|------|------|
| **E1** | Pilot：3 workloads（cold／hot 不相交／hot 混衝突）× 5 主臂 × 少 seeds | 找變異與瓶頸；**不宣稱勝出** | D | **done** |
| **E2** | 主矩陣（預先登記 seeds）：正確完成率、eligible coverage、goodput、p50/p95/p99、retry | 配對 traces；workload seed≠scheduler seed | E1 | **done** |
| **E3** | Window／batch size sweep（含 0 window） | 延遲 vs coverage tradeoff | E1 | **done** |
| **E4** | Multi-process（2/4/8）：收據對帳、CAS／apply-lock 消融（fault 臂隔離） | 0 殭屍 lease；監測寫入 | C＋D5 | **done** |
| **E5** | 故障注入：context mismatch、stale CAS、kill、rollback 失敗、收據遺失 | 終態分類 blocked／rolled-back／recovery-required | C | **done** |

---

## F. 論文表圖與重現（對應 M5）

| ID | 題目 | 產出 | 依賴 | 狀態 |
|----|------|------|------|------|
| **F1** | 主文圖：責任流程、反例、goodput–latency、outcome 堆疊 | `tables/F1_FIGURES.md` | E2 | **done** |
| **F2** | 正確性／unsafe accept／false reject／零事件上界表 | `tables/F2_CORRECTNESS_TABLES.md` | E2 | **done** |
| **F3** | 一鍵重建主表＋artifact checksums | `reproduce.sh`／manifest／`checksums.sha256`（verify-only；未重建論文主表） | 全 | **done** |

---

## 建議執行順序（給代理逐項做）

1. **A1–A5**（規格；可與稿修並行）  
2. **B1**（**done**）：v0.1.17 探針紅燈已固化 `runs/composer-probe/`  
3. **M1 core 修復**（#198 merged）→ **B2–B8 轉綠（done）**  
4. **C1–C4** → **D1–D5** → **E1 pilot（done）** → **E2 main（done）**  
5. 下一階 **E5** → **F1／F2**（E4 done）

---

## 本輪「下一個」預設

**A1／A2／A4／A5／B1–B8／M1／C1–C4／D1–D5／E1–E5／F1／F2／F3 已完成**（DRAFT）（2026-10-07 Asia/Taipei）。

**M1**：[#198](https://github.com/eaglhuang/AI-Atomic-Framework/pull/198) 已 merge 進 `main`（merge `5692474f…`；#196 closed）。獨立驗收 S1a／S1b／S2／S3／**S4／S5**＋邊界／排列全綠。未 publish、未打 tag。

**C1–C4／D1–D5**：見既有紀要；RQ2 主臂 = `--arm steward`。

**E1 done（2026-10-07 22:50 CST）**：pilot；`runs/e1-pilot/`。**pilot only — 不宣稱勝出**。

**E2 done（2026-10-07 22:55 CST）**：主矩陣 3×5×10＝150 cells；seeds 預登記＋`scheduler=wl+1000`；`runs/e2-matrix/E2_SUMMARY.md`；紀要 `STEWARD_WRITER_E2.md`。**DRAFT evidence — 不宣稱勝出**。

**F3／gaps done（2026-10-07 23:15 CST）**：`artifact_manifest.json`＋`REPRODUCE.md`＋`reproduce.sh`＋`checksums.sha256`；`logical_id` 解耦。

**E3 done（2026-10-07 23:17 CST）**：window sweep；`runs/e3-sweep/`。

**E4 done（2026-10-07 23:26 CST）**：MP 2/4/8；18 cells；主臂 0 zombie＋收據對帳＋pdw=0；fault naive／nolock 隔離；`runs/e4-multiprocess/E4_SUMMARY.md`；`STEWARD_WRITER_E4.md`。**DRAFT — 不宣稱勝出**。下一階預設：**F1**（表圖）。

**E5 done（2026-10-07 23:29 CST）**：18 cells；`runs/e5-fault/E5_SUMMARY.md`；**DRAFT**。

規格項 **A3** 可並行。

---

## A1／A2／A4／A5／B1 完成紀錄

| ID | 完成日（Asia/Taipei） | 產出路徑 | 備註 |
|----|----------------------|----------|------|
| A1 | 2026-10-07 | `VERSION_ANCHORS.md` | GitHub 核對：v0.1.17→`8dd6a1c6…`；main→`3b0f7660…`；#198 head→`65e8aab3…`；v1＝tag `v0.9.0-alpha.1` |
| A2 | 2026-10-07 | `METRIC_DEFINITIONS.md` | 審閱表 8 全指標＋logical/attempt＋batch 事件欄位 |
| A4 | 2026-10-07 20:20 CST | `T6_R1_DENOMINATOR_AUDIT.md`；`runs/hot-file/t6_r1_raw_counts.json` | 64.9%=lost/commits（ratio-of-sums 518/798）；審閱 48.79%=172.7/354 intents；**不改**原表％ |
| A5 | 2026-10-07 | `ARTIFACT_PACK_SPEC.md` | steward＋oracle 已有（C1/C3/D5）；仍缺 artifact_manifest／reproduce.sh |
| B1 | 2026-10-07 20:18 CST | `runs/composer-probe/` | 重跑≡舊 out；Node v24.10.0；ATM peel `8dd6a1c6…`；見 README／EXPECTED／checksums.sha256 |
| C1 | 2026-10-07 21:17 CST | `src/steward-writer.mjs`；`runs/steward-writer/STEWARD_WRITER_C1.md`；`runs/steward-c1-smoke/` | ATM pin `5692474f…`；proposer_direct_writes=0；batch≥2 共寫 marker 全在；sync 回歸綠 |
| C2 | 2026-10-07 21:20 CST | `runs/steward-writer/STEWARD_WRITER_C2.md`；`runs/steward-c2-smoke/`／`steward-c2-w0` | close_reason count|timeout|immediate；compose_batch JSONL；window=0 → size=1；repropose stub 0 |
| C3 | 2026-10-07 21:22 CST | `src/oracle.mjs`；`STEWARD_WRITER_C3.md`；`runs/steward-c3-smoke/` | effect_id+bytes；correct 19／lost 0；multi-batch 仍 correct；eligible 預登記 |
| C4 | 2026-10-07 21:25 CST | `src/arms.mjs`；`STEWARD_WRITER_C4.md`；`runs/c4-*` | --arm 四臂；診斷標籤；admission_only lost=6／raw lost=7（動機）；steward correct=15 |
| D1 | 2026-10-07 21:28 CST | `FileLockTable`；`STEWARD_WRITER_D1.md`；`runs/d1-file_lock`／`d1-steward` | baseline_serial；correct 15／lost 0；lock_wait 可觀測；下一階 D2 |
| D2 | 2026-10-07 21:29 CST | OCC CAS＋retry；`STEWARD_WRITER_D2.md`；`runs/d2-occ`／`d2-file_lock`／`d2-steward` | baseline_occ；correct 15／lost 0；cas_retry Σ=6；exhaust(max=0) blocked=5；下一階 D3 |
| D3 | 2026-10-07 21:32 CST | `git merge-file` fold；`STEWARD_WRITER_D3.md`；`runs/d3-git_three_way`／steward／occ／file_lock | baseline_git；correct 15／lost 0；n-way disclosed；same-hunk unit blocked；下一階 D4 |
| D4 | 2026-10-07 21:33 CST | `BareAdmitBroker`；`STEWARD_WRITER_D4.md`；`runs/d4-bare_composer`／steward／occ | baseline_bare_composer；admit bypass；correct 12 vs steward 15；下一階 D5 |
| D5 | 2026-10-07 21:35 CST | RQ2 freeze；`D5_SUMMARY.md`；`runs/d5-*` | main_method only steward；D ladder complete；下一階曾 E1 |
| B5 | 2026-10-07 22:43 CST | `runs/b5-b8/`（S4 true stale＋re-propose） | `canonical target base hash is stale`／file-hash-drift |
| B6 | 2026-10-07 22:43 CST | `runs/b5-b8/B6.md`；#198 契約凍結於 EXPECTED | 六格全綠；同 gap 拒／context-only 收 |
| B7 | 2026-10-07 22:43 CST | `runs/b5-b8/B7.md` | 重排 hash 不變；permutation count 真實 |
| B8 | 2026-10-07 22:43 CST | `runs/b5-b8/B8.md`；stock rollback | `rolled-back`；標例外補償；**B ladder complete → E1** |
| E1 | 2026-10-07 22:50 CST | `runs/e1-pilot/`；`E1_SUMMARY.md`；`STEWARD_WRITER_E1.md` | 45 cells＋2 diag；**pilot only — 不宣稱勝出**；下一階預設 E2 |
| E2 | 2026-10-07 22:55 CST | `runs/e2-matrix/`；`E2_SUMMARY.md`；`STEWARD_WRITER_E2.md`；`--scheduler-seed` | 150 cells＋2 diag；seeds 預登記；**DRAFT — 不宣稱勝出**；下一階預設 E3 |
| F3／gaps | 2026-10-07 23:15 CST | `artifact_manifest.json`；`REPRODUCE.md`；`reproduce.sh`；`checksums.sha256`；`STEWARD_WRITER_GAPS.md` | verify-only；logical_id 解耦；**未**重跑 E2；DRAFT；其後 E3 done |
| E3 | 2026-10-07 23:17 CST | `runs/e3-sweep/`；`E3_SUMMARY.md`；`STEWARD_WRITER_E3.md` | 120 cells；window 含 0；**DRAFT**；下一階預設 E4 |
| E4 | 2026-10-07 23:26 CST | `runs/e4-multiprocess/`；`E4_SUMMARY.md`；`STEWARD_WRITER_E4.md` | 18 cells；0 zombie 主臂；**DRAFT**；下一階預設 E5 |
| E5 | 2026-10-07 23:29 CST | `runs/e5-fault/`；`E5_SUMMARY.md`；`STEWARD_WRITER_E5.md` | 18 cells；終態三類；**DRAFT**；下一階 F1 |
| F1／F2 | 2026-10-07 23:30 CST | `tables/F1_FIGURES.md`；`tables/F2_CORRECTNESS_TABLES.md` | DRAFT 表圖素材；不宣稱勝出 |
| r2 P0-1 | 2026-10-08 CST | `runs/r2-e4-forensics/E4_FORENSICS.md`；`runs/r2f-e4-*`（150 runs） | **E4 反例成立**：跨 process steward lost update＋撕裂檔；r1 設定 75 runs 中 4 失敗；steward 跨 process 鎖 75 runs 0 失敗（候選，非證明） |
| r2 P0-2 | 2026-10-08 CST | `src/oracle_v2.mjs`；`test/oracle_v2_contract.mjs`；`analysis/rescore_oracle_v2.mjs` | 全 bytes＋frame＋structure；6 類契約全過；r1 raw 重評 0 改判 |
| r2 P0-3 | 2026-10-08 CST | `tools/{verify,analyze,rerun,seal}.sh`；`reproduce.sh` 改為分派 | verify 唯讀；analyze 從 raw 重建 E1–E4 333 cells 全欄相符；E3／E4 r1 extractor 重跑 IDENTICAL |
| r3 pin | 2026-10-08 CST | `runs/r3-validation/PINS.json`、`ATM_CORE_DIFF_5692474f..bea35380.patch` | ATM PR #213 merge bea35380 另行安裝；5692474f 不動 |
| r3 barrier | 2026-10-08 CST | `test/barrier_interleave.mjs`；`runs/r3-validation/barrier/` | 確定性 2-process 交錯：5692474f 40 次中每次遺失 1 個效果（合計 40）；bea35380 0/40 |
| r3 E4 | 2026-10-08 CST | `runs/r3v-*`（225）、`runs/r3m-*`（45）、`runs/r3s-*`（30） | 作者自行執行、未獨立重現。5692474f：75 次重播中 8 次 run 失敗，合計遺失 12 個效果，完成 1,519/2,610；bea35380（harness 鎖 off）：0/75 失敗、0 個遺失效果、完成 1,524/2,610（兩者約 58%，非全部成功、未證明不劣）；blocked 1,079／1,086（分列見 F2 表 A-r3）；18 re-compose 僅 3 次成功；損壞 0；r1 18 cells：0 個遺失效果 |
| r3 回歸 | 2026-10-08 CST | `runs/r3r-*`（180） | 單 process 15 組正確性計數相同；steward 延遲差在雜訊內；bare composer +1.8% mean |
| r3 措辭修訂 | 2026-10-08 13:51 後 | 論文 §1.5、§4.11、§6 表 R3b／R4、§7.1、§7.3；`tables/F2_CORRECTNESS_TABLES.md` 表 A-r3／A-r4 | 依作者與外部審閱者協議改分列指標；CI 另列；未做項目明列；**未封存** |
| r4 pin | 2026-10-08 CST | `runs/r4-validation/PINS.json`、`ATM_CORE_DIFF_bea35380..2118bc66.patch` | ATM PR #214 merge 2118bc66 另行安裝於 `/workspace/atm-main-2118bc66/`；5692474f／bea35380 不動；run 後三 pin core 樹 hash 不變 |
| r4 E4 | 2026-10-08 14:37–14:58 CST | `runs/r4v-*`（450）、`runs/r4m-*`（63） | 作者自行執行、未獨立重現。2118bc66（harness 鎖 off）：0/75 runs 失敗、0 個遺失效果、完成 1,748/2,610（67.0%）、blocked 862（全為 `steward-final-patch-required`）；bea35380 1,553、0／0；5692474f 1,580、5/75 runs 失敗、合計遺失 6 個效果；損壞 0；分列見 F2 表 A-r4；非全部成功、未做顯著性／非劣性檢定 |
| r4 消融 | 同上 | `runs/r4v-*-optr0-*`、`*-optr1-*` | 只有 (c) 可經 `recomposePolicy` 關閉：重試 0／1／4 完成 1,718／1,752／1,748；第 3–5 次嘗試未觸發。(a)(b)(d) 無法在不改程式碼下關閉 |
| r4 barrier | 同上 | `test/barrier_interleave.mjs`；`runs/r4-validation/barrier/` | seam／stale-proposal／before-precheck 每案 20 次：5692474f seam 合計遺失 40；bea35380、2118bc66 0。before-precheck v1（leader 未等待）作廢保留為 superseded |
| r4 故障 | 同上 | `test/r4_fault_scenarios.mjs`；`runs/r4-validation/faults/` | F1–F5：2118bc66 0 遺失（rename 前被殺留孤兒 temp 檔）；**F6 跨 PID namespace：2118bc66 兩方向各 10/10 遺失（反例）**；bea35380 F4 不同 TMPDIR 10/10 遺失 |
| r4 回歸 | 同上 | `runs/r4r-*`（180） | 單 process 15 組正確性計數相同；steward total_ms mean +2.4%（hot_disjoint +4.1%、cold +3.4%，與雜訊同量級）；執行順序固定 |
| r4 論文 | 2026-10-08 CST | 論文 §1.5、§4.11、§6 表 R4、§7.1、§7.3、參考文獻 [20][21]；F2 表 A-r4 | 完成與遺失分列；CI 另列；broker 佇列標為未實作；封存為 r4 generation |
| Phase 3（450 runs） | **未做** | — | r4 之後仍未執行；先處理 F6 反例與 broker 佇列（論文 §7.3） |


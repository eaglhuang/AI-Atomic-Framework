# Evidence generation r2-2026-10-08

狀態：**DRAFT 證據**。論文仍為 DRAFT，**不主張任何勝出**。未跑 Phase 3（450-run）矩陣。
ATM pin：`5692474f7db70ab52a7a71c8af4867609e7e4b43`（唯讀，只以 SHA 參照，不打包原始碼樹）。
產生時間：2026-10-08（Asia/Taipei）。r1 generation 未被修改（r1 `SHA256SUMS` 仍可驗證通過，274 檔）。
針對：`review/EXTERNAL_REVIEW_2026-10-07.md`（sha256 `64288fe5…`，在 r1 內）的 P0 項目。

## 1. 如何驗證／重建

| 指令 | 行為 | 是否寫入 |
|---|---|---|
| `sh verify.sh`（本目錄） | `sha256sum -c --strict` 對照本目錄 `SHA256SUMS` | 否，嚴格唯讀 |
| `harness/reproduce.sh verify <gen>` | 同上 | 否 |
| `harness/reproduce.sh analyze <新空目錄>` | 只讀 raw：contract test → oracle v2 重評分 → E4 鑑識 → E1–E5 表重建 → cell index → logical_id 稽核 → r1 extractor 沙盒重跑比對；前後各算一次 raw 指紋 | 只寫入 OUT（拒絕非空 OUT） |
| `harness/reproduce.sh rerun cell|e4-forensics|matrix …` | 重新執行，新 run 用新前綴（`rr<TAG>-`），拒絕覆蓋 | 只寫入新 run 目錄 |
| `harness/reproduce.sh seal <gen>` | 寫 `MANIFEST.json`，最後寫 `SHA256SUMS`，複製 `verify.sh`，立即驗證；已 seal 則拒絕 | 只寫入新 generation |

r1 raw 不重複打包，見 `R1_REFERENCES.md`（sha256 清單）。r2 新 raw：`raw/r2-e4-forensics.tgz`（151 個 replay run 完整目錄）、`raw/r2-smoke.tgz`（runtime oracle v2 smoke）。

## 2. 與 r1 的差異

**程式（harness/src；完整 diff 在 `harness/R2_CHANGES.patch`，相對 r1 harness 快照）**
- `steward-writer.mjs`：batch id 加入 process 標籤（`cb-<file>-w<k>-NNNN`），修正 r1 跨 process 的 evidence 檔互相覆蓋（r1 15 個 MP cell 中 14 個有 batch id 碰撞）；compose+apply 可經 `applyLock` 包住；新增 `steward_apply` telemetry（pre_apply_hash、receipt before/after、post_apply_hash、epoch、pid、lock_wait，以及 `interleave_suspect`、`post_write_drift` 兩種特徵）。
- `runner.mjs`、`mp-worker.mjs`、`mp-runner.mjs`、`cli.mjs`：新增 `--steward-apply-lock on|off`（預設 off＝重現 r1 行為）；arm `steward_mp_steward_lock` 標為 `mitigation_candidate`（**不是**比較對象）；`mp_ablation` 記錄 `apply_lock_covers_steward`；runtime oracle v2 hook（寫 `oracle_v2_summary.json`／`oracle_v2_results.jsonl`）。
- 新增 `src/oracle_v2.mjs`、`test/oracle_v2_contract.mjs`、`analysis/{rescore_oracle_v2.mjs,e4_forensics.py,rebuild_tables.py,cell_index.py,logical_id_audit.py}`、`tools/{verify,analyze,rerun,seal}.sh`；`reproduce.sh` 改為子命令分派；`REPRODUCE.md` 改寫。

**文件（相對 r1 同路徑，sha 不同者）**
- `paper/ATM_PAPER_V2_DRAFT_zh.md`：版本錨點更正（PR #198 已 merge 為 5692474f）；Table R3 改為 E4 反例文字與表；新增 oracle r2 段落。
- `tables/F2_CORRECTNESS_TABLES.md`：E4 列（p2/p4/p8/SP＝63/106、60/106、56/106、94/106，p2 lost=1）、replay 列、stop rule 註記、steward receipt 列、E5 logical ops 註記、「mean±σ 不是 CI」註記。
- `tables/F1_FIGURES.md`、`docs/METRIC_DEFINITIONS.md`（§1.5 r2 oracle）、`docs/VERSION_ANCHORS.md`（r2 節）、`docs/EXPERIMENT_CHECKLIST.md`（r2 P0-1/2/3 列）。
- **不再攜帶** r1 的舊 `docs/checksums.sha256`、`docs/artifact_manifest.json`（路徑錯置、flattened seed 碰撞；以本目錄 `SHA256SUMS`＋`MANIFEST.json` 取代，使用原始路徑）。

**新摘要**：`summaries/runs/r2-e4-forensics/`（`E4_FORENSICS.md` 完整報告、`forensics_summary.json`、`forensics_table.md`、`forensics.log`）、`summaries/runs/r2-analysis/r2-2026-10-08/`（analyze 的標準輸出）。r1 各 stage 摘要原封不動。

**來源註記**：r2f replay run 於 2026-10-08 09:42–09:45（台北）執行，當時 runtime oracle v2 hook 尚未加入，故這些 run 的 oracle v2 分數全部來自 analyze（artifact-only 重評分）。

## 3. 主要結果（事實，不含詮釋）

**P0-1 E4 遺失結果鑑識**
- r1 cell `e4-hot_conflict-steward-p2-s17`：遺失 `s17-t000-i0`（logical `log:s17-t000:i0`，`src/store.ts`，region `reducers`，worker0／pid 611058，batch `cb-src_store.ts-0001`，verdict applied，最終 occurrence 0）。4 ms 後被 worker1（pid 611059）提交的 `s17-t000-i6` 覆蓋；兩者 compose base 都是 `3c1ad38d`；worker1 receipt before=`a6574603`（base+i0）、after=`56c43e5a`（base+i6），重算確認。
- 結論：**真實的多 process 正確性失敗**（lost update），不是 oracle 或計數假象。主因：harness 接線（steward 分支從未呼叫 `broker.withApplyLock`，`--apply-lock on` 對 steward 無效，r1 的 `fault_nolock` ablation 對 steward 與主臂相同）；促成因素：ATM pin 的 `applyTransactionalStewardPlan` 是 check-then-write、無跨 process 鎖、非原子寫入（L83／L312–314／L352–359）。
- Replay（各 75 run）：r1cfg 4 個失敗 run、6 個遺失效果、1 次 torn write（frame violation）；4/4 失敗都有 telemetry 特徵。slock 0/0/0，lock spins > 0。exact cell 同配置 35 run 中 2 次失敗（含 grid p2-s17 r4：再次遺失 s17-t000-i0，並出現 torn `store.ts`：699 bytes 的 base+i6 寫在 700 bytes 的 base+i0 上，留下多餘尾端位元組）。
- slock 成本（平均 wall clock）：p2 572→609 ms、p4 621→700 ms、p8 687→907 ms。
- 依論文 §5.7 stop rule：記為**反例**，草稿 E4 節與 F2 表已改寫，無粉飾。slock 只是 mitigation candidate，**不是**宣稱修好。

**P0-2 Oracle v2（`c4-fullbytes-frame-v2`）**
- 由 reference applier 產生完整預期 bytes；structure check（region tag 不變）＋ frame check（去除授權 payload 後骨架逐位元組相同）；superseded ≠ lost。
- Contract：C0 對照、C1 鄰近區域被破壞、C2 放錯區域、C3 region tag 遺失、C4 重複、C5a 合法刪除、C5b 合法取代原文、C6 合法 supersede、N5 非法消失、N6 被未提交者取代 —— 全數通過。
- 重評分（analysis-only）：r1 全部 stage（c4、d1–d5、e1–e5、gaps、steward、support）**0 個判定改變**（e1 611、e2 1943、e3 1520、e4 398、e5 67 correct，v1＝v2）。r2 replay：1 個 cell（`r2f-e4-p2-s17-g-r1cfg-r4`）10 個判定由 correct 變 frame_violation（torn write 多出的尾端換行）；合計 v1 3164 → v2 3154。
- 覆蓋限制：E5 只有 6 個 cell、steward 只有 2 個 cell 有 oracle_results 可評；probe/inject 類 cell 無法評分。

**P0-3 / Phase 1 E 分析重建**
- 從 raw 重建：E1 45/45、E2 150/150、E3 120/120、E4 18/18 cell 全欄位一致、0 mismatch；r1 E3/E4 extractor 沙盒重跑輸出 IDENTICAL；analyze 前後 raw 指紋不變。
- E5 logical ops：occ_exhaust 41 offered／26 correct／15 blocked／0 lost；clean_steward 41／41／0／0。
- Cell index：547 個 cell，其中 532 個 pin＝5692474f。
- logical_id 稽核（E1/E2，200 cell）：200/200 符合「1 submit、1 terminal、≤1 correct effect、offered 固定」；29 個 cell 共 129 個 op 有多次 attempt（OCC/git CAS retry，共 132 次額外 attempt），仍各只有 1 個 terminal。**不證明 exactly-once**；steward re-propose 仍為 stub。

## 4. 審查項目對照

| 審查項目 | 狀態 | 修正／證據 | 尚缺 |
|---|---|---|---|
| P0-1 E4 lost result 鑑識 | **已完成（結論：反例）** | `summaries/runs/r2-e4-forensics/E4_FORENSICS.md`、`raw/r2-e4-forensics.tgz`、草稿 E4 節、F2 | 系統面修正未完成：需 ATM 端 guard 或部署契約（跨 process 鎖＋原子寫入＋寫前 hash 驗證）；需以 barrier 控制的 2-process 最小交錯契約測試（目前只有統計 replay） |
| P0-2 Oracle 改為完整 bytes＋frame/structure＋6 個正負例 | **已修正** | `src/oracle_v2.mjs`、`test/oracle_v2_contract.mjs`、`oracle-rescore/` | `full_bytes_exact` 以 scenario 順序而非真實 commit 順序計（僅資訊用）；region 內 insert 排列允許；runtime v1 仍並存；workload 只有 insert，replace/delete 僅在 contract 測試覆蓋 |
| P0-3 reproduce 拆分、checksum 路徑／不符／flattened seed 碰撞 | **已修正** | `harness/tools/*.sh`、`reproduce.sh`、本目錄 `SHA256SUMS`＋`MANIFEST.json`（原始路徑，無 seed 碰撞） | harness 內 r1 舊 checksum 檔仍存在於工作樹（非權威、未打包） |
| Phase 1 A：失敗 cell 完整 artifacts | **已完成** | r1 `raw/e4.tgz`＋`raw/r2-e4-forensics.tgz`（含每 worker compose_batches／steward_applies） | — |
| Phase 1 B：所有 cell artifacts＋manifest | **部分** | r1 raw（以 sha 參照）＋ `cell-index/` | r1 未記錄每 run 的 harness 原始碼 hash |
| Phase 1 C：不可變的 harness/oracle/ATM 原始碼、lockfile | **部分** | harness 原始碼＋patch 在本目錄；ATM 以 commit SHA 參照 | 無正式 lockfile；ATM 樹不打包（依指示） |
| Phase 1 D：raw events、預期效果、base/patch/output、stdout/stderr | **部分** | 在 raw tgz 內 | 每 cell 的 stdout/stderr/exit code 未個別擷取（只有 matrix log） |
| Phase 1 E：analysis-only 重建 | **已完成** | `tables/`、`r1-extractors/`、`RAW_READONLY_CHECK.txt` | extract_e2.py 在 r1 為 0 bytes，E2 改用新腳本重建 |
| E1/E2 logical_id stub | **部分（稽核通過）** | `logical-id-audit/` | 非真 logical_id 實作；steward re-propose stub 未實作 |
| MP window 為 process-local | **未解決**（已記錄，與反例相關） | 草稿 E4 節 | — |
| fault arm 非競爭者 | 維持 | `arm_role` 欄位；另揭露 r1 `fault_nolock` 對 steward 無效 | — |
| E5 cell class 與 logical ops | **已修正** | F2 E5 註記＋重建數字 | — |
| mean±σ 不是 CI／統計 | **未解決**（已標註） | F2 註記 | 未計 CI、未做檢定 |
| 論文其他過期文字 | **部分** | 版本錨點、§2 表、參考文獻已更新 | 全文逐節同步未完成 |
| Phase 2（lifecycle、policy matrix、write-monitor 正對照、recovery） | **未開始**（A：oracle 案例已完成；D：只有統計 replay） | — | — |
| Phase 3（450-run 矩陣） | **未執行**（依指示） | — | — |

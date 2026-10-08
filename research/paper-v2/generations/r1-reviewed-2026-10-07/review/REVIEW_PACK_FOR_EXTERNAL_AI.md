# 給外部 AI 的審核證據包說明

| 欄位 | 內容 |
|------|------|
| 產出 | 2026-10-07 23:31 CST（Asia/Taipei） |
| 根目錄 | `/workspace/reports/atm-v2-harness/` |
| 壓縮包 | `review-pack.tgz`（若存在） |
| 精簡目錄 | `review-pack/` |

---

## 1. 目的

請另一個 AI（或人審）**核對**：ATM 論文 v2 實驗梯隊 A–F（DRAFT）是否證據齊、口徑一致、有無過度宣稱。  
本包**不是**投稿终稿，也**不是**勝出證明。

---

## 2. 硬約束（審核時必須遵守）

1. **Paper stays DRAFT — 不宣稱勝出 / not a win claim。**
2. **ATM pin（READ-ONLY）**：`5692474f7db70ab52a7a71c8af4867609e7e4b43`  
   路徑：`/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43`
3. **CI 綠／PR 合 ≠ 主實驗完成**（見 `VERSION_ANCHORS.md` §3）。
4. **Candidate final pin**＝上述 SHA；**升 final** 須本審核＋稿凍結；**禁止** npm publish／git tag／merge ATM（除非作者明示）。
5. RQ2 主臂僅 `--arm steward`（D5 freeze）；fault／diagnostic 臂**非**正確性競爭者。

---

## 3. Checklist 狀態總表（截至本包）

| 階 | 狀態 | 摘要路徑 |
|----|------|----------|
| A1–A5 | done（A3 措辭 optional） | `VERSION_ANCHORS`／`METRIC_DEFINITIONS`／`ARTIFACT_PACK_SPEC`／A4 audit |
| B1–B8 | done | `runs/composer-probe/`；`runs/b5-b8/` |
| C1–C4 | done | `runs/steward-writer/STEWARD_WRITER_C*.md` |
| D1–D5 | done | `runs/baselines/`；D5 RQ2 freeze |
| E1 | done DRAFT | `runs/e1-pilot/E1_SUMMARY.md` |
| E2 | done DRAFT | `runs/e2-matrix/E2_SUMMARY.md` |
| E3 | done DRAFT | `runs/e3-sweep/E3_SUMMARY.md` |
| E4 | done DRAFT | `runs/e4-multiprocess/E4_SUMMARY.md` |
| E5 | done DRAFT | `runs/e5-fault/E5_SUMMARY.md` |
| F1／F2 | draft done | `tables/F1_FIGURES.md`；`tables/F2_CORRECTNESS_TABLES.md` |
| F3 | done | `reproduce.sh`／`artifact_manifest.json`／`checksums.sha256` |

完整表：`EXPERIMENT_CHECKLIST.md`。

---

## 4. 建議閱讀順序

1. 本檔 → `EXPERIMENT_CHECKLIST.md` → `VERSION_ANCHORS.md`  
2. `METRIC_DEFINITIONS.md`（分母）→ `ARTIFACT_PACK_SPEC.md`  
3. `runs/baselines/D5_SUMMARY.md`（主方法凍結）  
4. E2 → E3 → E4 → E5 SUMMARY（主數字）  
5. `tables/F1_FIGURES.md`＋`F2_CORRECTNESS_TABLES.md`  
6. Caveats（下節）→ 建議問題清單  

可選：`ATM_PAPER_V2_DRAFT_zh.md`（正文草稿）。

---

## 5. 已知 caveats（必須讀）

| ID | Caveat |
|----|--------|
| C-LID | E1／E2 歷史 cells：`logical_id === intent_id`（stub）。Gaps 後新跑已解耦（`log:…`）。**未**重跑 E2 150 cells。 |
| C-MPWIN | E4：MP steward compose window **不跨 OS process** → MP correct rate 低於 SP；屬設計缺口，非「單進程勝出」宣稱。 |
| C-FAULT | E5／E4 fault 臂（naive registry、apply-lock off、injects）＝**消融／非競爭者**。 |
| C-KILL | E5 kill／receipt_loss 為 harness 模型（SIGKILL／丟收據），非完整 OS crash 模擬。 |
| C-RB | `rolled-back`＝`failAfterWrites` **例外補償**，≠ crash atomicity（B8／E5）。 |
| C-E2DRAFT | E2 150 cells 為 DRAFT evidence；勿當最終 RQ2 勝出表。 |
| C-FALSE-REJ | F2 false-rejection 獨立政策矩陣標 **partial**（未單獨重跑）。 |
| C-ZERO | `proposer_direct_writesΣ=0` 須連同監測覆蓋率解讀（METRIC §1.12）。 |

---

## 6. 建議審核問題清單

1. 主表是否同時報 offered／eligible／correct／blocked／lost（防 reject-all 假安全）？  
2. E2／E3 數字是否與 `e*_compare_raw.json` 可對帳？  
3. Candidate pin `5692474f…` 是否處處一致（manifest／anchors／runs meta）？  
4. Fault 臂是否被誤寫進「主方法勝出」敘事？  
5. E4 MP caveat 是否在論文中充分披露？  
6. logical_id stub（E1／E2）是否會誤導 logical-op 分母？是否需重跑聲明？  
7. F1／F2 是否過度外推 DRAFT 數字？  
8. `reproduce.sh` verify-only 是否足以重現封包指紋（非重跑 150 cells）？  
9. 升 final 前還缺什麼（統計 CI、圖精修、A3 措辭）？  
10. 有無 ATM 樹被改寫／publish／tag 跡象（應為無）？  

---

## 7. review-pack/ 內容清單

見目錄內檔案；為摘要級副本／連結，**不含**全部 raw cell 目錄（E2 150 等請回主樹 `runs/`）。

---

## 8. Banner（再強調）

**DRAFT evidence pack for external review — 不宣稱勝出。**  
Candidate final ATM pin `5692474f7db70ab52a7a71c8af4867609e7e4b43` pending review／paper freeze.

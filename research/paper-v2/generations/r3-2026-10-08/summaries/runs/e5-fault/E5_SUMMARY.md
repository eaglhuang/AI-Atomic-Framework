# E5 — 故障注入 summary

> **DRAFT evidence — not a win claim / 不宣稱勝出**

| 欄位 | 內容 |
|------|------|
| Status | **done**（2026-10-07 23:29 CST） |
| ATM pin | `5692474f…` 唯讀 |
| Cells | **18** = 12 probe（6 注入 × 2 reps）+ 3 OCC exhaust + 3 clean steward |
| Main control | `--arm steward`（clean only） |
| Fault 臂 | 全部 `arm_role=fault_ablation`（非正確性競爭者） |
| Probe | `runs/e5-fault/inject.mts` |
| Raw | `runs/e5-fault/e5_compare_raw.json` |
| Runner | `runs/e5-fault/run_matrix.sh`（harness）＋inject reps |

## 終態分類（METRIC_DEFINITIONS）

| 終態 | 本 sweep 對應注入 |
|------|------------------|
| **blocked** | context_mismatch、stale_cas（compose 後改 disk）、occ_exhaust（`occ_max_retries=0`） |
| **rolled-back** | rollback_ok（`failAfterWrites:1` 補償成功；**非** crash atomicity） |
| **recovery-required** | kill_mid_apply、rollback_failure（補償無法完成）、receipt_loss |
| **commit**（control） | clean_steward |

## Outcome 表（DRAFT）

| injection | reps/seeds | expected | observed | pass |
|-----------|------------|----------|----------|------|
| context_mismatch | r1–r2 | blocked | blocked | ✅ |
| stale_cas | r1–r2 | blocked | blocked | ✅ |
| kill_mid_apply | r1–r2 | recovery-required | recovery-required | ✅ |
| rollback_ok | r1–r2 | rolled-back | rolled-back | ✅ |
| rollback_failure | r1–r2 | recovery-required | recovery-required | ✅ |
| receipt_loss | r1–r2 | recovery-required | recovery-required | ✅ |
| occ_exhaust | s11/17/23 | blocked | blocked | ✅ |
| clean_steward | s11/17/23 | commit | commit（lost=0） | ✅ |

## 註

- kill／receipt_loss 為 harness 模型（SIGKILL 子進程；丟棄收據），標 **recovery-required**。
- rollback_ok 標「例外補償」，與 B8 一致。
- **不宣稱勝出**；下一階預設 **F1**（不自動開工於 checklist；本輪 steering 另要求續做 F1/F2）。

## Banner

**DRAFT — 不宣稱勝出。**

# E5 — Seeds 預登記（跑前）

> **DRAFT evidence — 不宣稱勝出**。本檔寫於任何 E5 cell／probe 之前。

| 欄位 | 內容 |
|------|------|
| 登記時間 | 2026-10-07 23:28:03 CST |
| ATM pin | `5692474f…` READ-ONLY |
| 注入族 | context_mismatch／stale_cas／kill_mid_apply／rollback_ok／rollback_failure／receipt_loss |
| 終態類 | `blocked`／`rolled-back`／`recovery-required`（另 clean control＝commit） |
| Probe reps | `{1,2}` → 6 注入 × 2 = **12** probe cells |
| Harness | OCC exhaust（max=0）×3 seeds + clean steward ×3 seeds = **6** |
| **預期總格** | **18** |
| Scheduler | harness：`wl+1000`；probe：deterministic ATM API（rep 作重複） |

## Banner

Fault 臂非正確性競爭者。Paper stays DRAFT.

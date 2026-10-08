# STEWARD_WRITER_E5 — Fault injection chronicle

> **DRAFT evidence — not a win claim / 不宣稱勝出**

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 23:29 CST |
| Checklist | **E5** |
| ATM | pin `5692474f…` 唯讀 |
| 產出 | `runs/e5-fault/`（18 cells；inject.mts；E5_SUMMARY；e5_compare_raw） |

## 做了什麼

1. 跑前登記 seeds（18 cells）。
2. `inject.mts`：context_mismatch／stale_cas／kill／rollback_ok／rollback_failure／receipt_loss × 2 reps。
3. Harness：OCC exhaust（max=0）×3 + clean steward ×3。
4. 終態映射 blocked／rolled-back／recovery-required；全 probe pass。
5. Checklist E5→done。

## 通過判準

- 五類注入可覆蓋 → **是**
- 終態分類表 → **是**
- Fault 非競爭者＋DRAFT → **E5 done**

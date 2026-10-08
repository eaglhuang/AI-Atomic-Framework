# F1 — 主文圖素材（責任流程／反例／goodput–latency／outcome 堆疊）

> **DRAFT — 不宣稱勝出 / not a win claim.** CI ≠ 主實驗。Candidate pin `5692474f…`（待審核升 final）。

| 欄位 | 內容 |
|------|------|
| 產出日 | 2026-10-07 23:30 CST |
| 資料源 | E1–E5 SUMMARY＋baselines D5＋composer-probe＋b5-b8 |
| 狀態 | **draft figures pack** — 非最終排版圖檔 |

## 圖 1 — 責任流程（概念）

```
Proposer(s) --PatchProposal--> ComposeWindow(harness) --plan--> Neutral Steward apply
                     ^                                         |
                     |                                         v
              ATM broker admit                          Canonical worktree
              (CAS registry)                            + structured receipt
```

- RQ2 主臂：`--arm steward`（D5 freeze）。
- Proposer 不得直接寫 canonical（E4 `proposer_direct_writesΣ=0`）。r2：但 E4 多 process 中兩個 steward 互相覆寫造成 lost update（反例，見 F2 表 A）。
- 詳：`COMPOSER_STEWARD_IMPL_PLAN.md`／`runs/baselines/D5_SUMMARY.md`。

## 圖 2 — 反例／故障終態（E5）

| 反例 | 終態 | 證據 |
|------|------|------|
| Context mismatch | blocked | `e5-context_mismatch-r*` |
| Stale CAS（compose 後改 disk） | blocked | `e5-stale_cas-r*`；B5 |
| OCC retries=0 | blocked | `e5-occ_exhaust-s*` |
| failAfterWrites 補償成功 | rolled-back | `e5-rollback_ok-r*`；B8 |
| 補償失敗／kill／收據遺失 | recovery-required | `e5-rollback_failure`／`kill_mid_apply`／`receipt_loss` |

## 圖 3 — goodput–latency（E3 window sweep；steward×hot_conflict）

| window_ms | goodput (correct/s) | wall_ms | rate_elig | batch_mean |
|-----------|---------------------|---------|-----------|------------|
| 0 | 37.97 | 370 | 1.0 | 1.0 |
| 25 | 33.65 | 418 | 1.0 | 1.12 |
| 50 | 31.12 | 452 | 1.0 | 1.14 |
| 100 | 27.43 | 515 | 1.0 | 1.16 |
| 200 | 19.96 | 720 | 1.0 | 1.14 |
| 400 | 11.47 | 1253 | 1.0 | 1.14 |

來源：`runs/e3-sweep/E3_SUMMARY.md`。描述性 tradeoff；**非勝出**。

## 圖 4 — Outcome 堆疊口徑

每個 matrix cell 建議堆疊整數（A2）：

```
offered
 └─ eligible
     ├─ correct (commit ∧ oracle pass)
     ├─ blocked
     ├─ rolled-back          (E5／B8)
     ├─ recovery-required    (E5)
     ├─ lost-among-committed
     └─ unresolved / retry_exhausted
```

- 禁止只用 marker；須 C3 oracle。
- Reject-all → 0 lost **不可**當安全主結果。
- 詳：`METRIC_DEFINITIONS.md`。

## 路徑索引

| 圖 | 主要數字／敘事路徑 |
|----|-------------------|
| 1 | D5_SUMMARY；COMPOSER_STEWARD_IMPL_PLAN |
| 2 | E5_SUMMARY；b5-b8 |
| 3 | E3_SUMMARY |
| 4 | METRIC_DEFINITIONS；E2_SUMMARY 主表 |


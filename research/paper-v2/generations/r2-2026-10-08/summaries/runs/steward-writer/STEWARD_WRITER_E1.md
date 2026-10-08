# STEWARD_WRITER_E1 — Pilot matrix chronicle

> **PILOT ONLY — no win claims / no RQ2 main result**

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 22:50 CST（Asia/Taipei） |
| Checklist | **E1** |
| ATM | pin `5692474f…` 唯讀；未改 ATM 源碼、未 publish、未打 tag |
| Main | `--arm steward`（D5 `MAIN_METHOD_INVOCATION`） |
| 產出 | `runs/e1-pilot/`（WORKLOADS／run_matrix／e1_compare_raw／E1_SUMMARY）；45 cell dirs；2 diag |

## 做了什麼

1. 凍結 3 workloads（cold／hot_disjoint／hot_conflict）與共同參數（3×5、window=100、hold 8–25、seeds 11/17/23）。
2. 跑 5 主臂 × 3 × 3 = **45** cells；另 admission_only／raw_overwrite 各 1-seed smoke。
3. 從 `meta.json`＋decision events 抽 correct／lost／blocked／admit／wait／wall；寫 `E1_SUMMARY.md`。
4. 更新 checklist／VERSION_ANCHORS／ARTIFACT_PACK_SPEC；**不**自動開 E2。

## 通過判準

- 矩陣完成、摘要有表、無 ATM 改動 → **E1 done**。
- 觀察到 bare blocked 僅 hot_conflict、steward wall 受 compose-window 拉高、lost=0 on competitors — 供 E2 規模／seed 登記參考。

## 指令範例（重跑單格）

```bash
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
node src/cli.mjs start --run-id e1-hot_conflict-steward-s11 --arm steward --atm-backend real \
  --compose-window-ms 100 --seed 11 --agents 3 --trials 5 --hot-ratio 1 --overlap high \
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force
```


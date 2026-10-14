trial-only — 不得作為論文結果

# HIST-v2 smoke runbook

日期：2026-10-14。這是程序目錄，不是 `benchmark-trials/` 裡的 smoke generation。沒有執行 smoke、pilot、主跑或留出集。沒有勝出主張。

## 釘選

| 項目 | 值 |
|---|---|
| 預先登記 | `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`（不修改） |
| 預先登記 `SHA256SUMS` sha256 | `353caac64fe66cd19afebb3cf16ab2ba010d5810e4250b9156d76bd77144abec` |
| 分類器 v8 `RULES.md` sha256 | `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541` |
| harness v2 `SHA256SUMS` sha256 | `393ea1deec292674d6fe60b2a11ccf6fb47a0c7602af82f2ea2fcf402009e74c` |
| ATM core merge | `cb25242433882d34b514b79338d1a00def53a875` |

## 這次沒有做的事

沒有建立 `research/paper-v2/benchmark-trials/<date>-hist-v2-smoke/`。分類後的 dev 題還沒有接到 harness v2 的歷史重播。`run_smoke.sh --execute` 在作者批准之前，以及在重播綁定出現之前，都不會建立 run 目錄。單元測試只在暫存目錄封存 fixture 觀察，用來確認 `verify.sh`。

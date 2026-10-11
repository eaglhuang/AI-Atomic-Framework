# HIST-v2 設計稿 r7（DRAFT）

日期：2026-10-11。這是外部再審 v6／r6 之後的修訂，仍然是草稿。不是預先登記 v2.0，沒有凍結，沒有 `SHA256SUMS`，沒有 `verify.sh`，沒有 run。

正文：`HIST_BENCH_V2_PREREG_r7_zh.md`。已決定事項：`DECISIONS.md`。R2-D1～R6-D2 原樣帶過來。R7-D1 要求計數欄位是 Python `int`，整數浮點與 `bool` 都拒絕。

不修改 r6 與更早的草稿，也不修改分類器 v1–v6。

分類器契約以分類器 v7 的 `RULES.md` 為準（PR #286，雜湊 `4b139cb5da39383b69dde8ffe3abf325f59aa1e06724bd5f19e39eeb533ac2e0`）。jsonschema 釘在 `4.18.0`。

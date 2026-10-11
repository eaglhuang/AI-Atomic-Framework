# HIST-v2 設計稿 r6（DRAFT）

日期：2026-10-11。這是外部再審 v5／r5 之後的修訂，仍然是草稿。不是預先登記 v2.0，沒有凍結，沒有 `SHA256SUMS`，沒有 `verify.sh`，沒有 run。

正文：`HIST_BENCH_V2_PREREG_r6_zh.md`。已決定事項：`DECISIONS.md`。R2-D1～R5-D3 原樣帶過來。R6-D1～R6-D2 是這次再審之後採用的契約。R6-D1 把接受與語意評估拆成各自的入口。R6-D2 讓安全上正確的全部拒絕不計入吞吐，並把矛盾的 ack 紀錄標成 `inconsistent`。

不修改這些目錄：

- `benchmark-design/2026-10-10-hist-bench-v2/`
- `benchmark-design/2026-10-10-hist-bench-v2-r2/`
- `benchmark-design/2026-10-11-hist-bench-v2-r3/`
- `benchmark-design/2026-10-11-hist-bench-v2-r4/`
- `benchmark-design/2026-10-11-hist-bench-v2-r5/`
- `benchmark-design/hist-v2-classifier/`
- `benchmark-design/hist-v2-classifier-v2/`
- `benchmark-design/hist-v2-classifier-v3/`
- `benchmark-design/hist-v2-classifier-v4/`
- `benchmark-design/hist-v2-classifier-v5/`

分類器契約以分類器 v6 的 `RULES.md` 為準（PR #284，雜湊 `c6889ecb0597646b613397561f428a3de3d8b73f8d48af7faad34fb8e51ef596`）。

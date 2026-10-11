# HIST-v2 設計稿 r5（DRAFT）

日期：2026-10-11。這是外部再審 r4 之後的修訂，仍然是草稿。不是預先登記 v2.0，沒有凍結，沒有 `SHA256SUMS`，沒有 `verify.sh`，沒有 run。

正文：`HIST_BENCH_V2_PREREG_r5_zh.md`。已決定事項：`DECISIONS.md`。R2-D1～R2-D4、R3-D1～R3-D5、R4-D1～R4-D5 原樣帶過來。R5-D1～R5-D3 是這次再審之後採用的契約。R5-D1 修正 R4-D4 裡「重抽分母為 0 就連點估計也未定義」那一句。

不修改這些目錄：

- `benchmark-design/2026-10-10-hist-bench-v2/`
- `benchmark-design/2026-10-10-hist-bench-v2-r2/`
- `benchmark-design/2026-10-11-hist-bench-v2-r3/`
- `benchmark-design/2026-10-11-hist-bench-v2-r4/`
- `benchmark-design/hist-v2-classifier/`
- `benchmark-design/hist-v2-classifier-v2/`
- `benchmark-design/hist-v2-classifier-v3/`
- `benchmark-design/hist-v2-classifier-v4/`

分類器契約以分類器 v5 的 `RULES.md` 為準（PR #282，雜湊 `08594ccba398a17bc9357b59cdfd19dda24671619857e7bf7119851cbb4c8f22`）。

重抽樣最終輸出的政策識別字是 `point-reported-interval-undefined`：原始點估計照報，有零分母的重抽讓區間未定義，並報告未定義重抽的次數與比例。

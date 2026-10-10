# Generation: benchmark-prereg/2026-10-10-hist-v2.0 — HIST-v2 預先登記 v2.0（已凍結）

ATM 論文 2.0。本目錄是 **HIST-v2 正式預先登記**，不是設計稿，也 **沒有任何 run、沒有勝出宣告**。

作者執行的凍結紀錄。CI 只核對檔案與 SHA256SUMS。不打 tag，不發 npm。

- 正文：`HIST_BENCH_V2_PREREG_zh.md`。D1–D9 已填入，見該檔 §11。
- 來源設計稿（不修改）：`research/paper-v2/benchmark-design/2026-10-10-hist-bench-v2/HIST_BENCH_V2_PREREG_zh.md`，正文 sha256 `ddb24018597ca8e485a4f42c0bc0972d2795e06e799efb4dabf63cb29839ad65`。`working-docs/2026-10-10-hist-v2-prereg/` 是該正文的位元組相同副本，本 generation 不讀、不改、不刪。
- 分類規則（不在本目錄重寫）：`research/paper-v2/benchmark-design/hist-v2-classifier/RULES.md` sha256 `cae1a7fa9f0a90f46d4abaf9eac0a694b9172918cd190cc244b27e0ecd19e487`。
- 已決定且寫進正文的操作要點：
  - D1：held-out 加上 flask（`pallets/flask`）與 requests（`psf/requests`），曆日 2024-01-01～2026-09-30；六專案另加 2026-01-01～2026-09-30。與 dev 共用 PR 的配對不進 held-out。
  - D2／D8：每份 proposal 30 秒、最多 8 次重試、不依大小縮放、所有臂。
  - D3：每個 PR 只用一次只做敏感性子集。
  - D4：主跑 2 seeds，全部題目 × 間隔 0／50／100／500／2,000 ms × 兩種到達順序，外加凍結抖動。
  - D5：共用收件匣與批次協調器在 ATM core（另一個 PR，不在本目錄實作）。
  - D6：compose 窗 0／100／500／1,000 ms 只在 A／B／C 各 20 題的固定子集。
  - D7：commit 層級送出只當次要。
  - D9：論文寫明 HIST-v2 取代 450-run 主矩陣。
- 既有 generation 與設計稿目錄都沒有被本提交修改。
- 驗證（嚴格唯讀）：在本目錄執行 `sh verify.sh .`。

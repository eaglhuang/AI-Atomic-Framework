# pilot-r2 旁註

> **superseded／invalid。** 封存位元組不要改。原因見 [`2026-10-15-hist-v2-pilot-r2-stop/DIAGNOSIS_zh.md`](2026-10-15-hist-v2-pilot-r2-stop/DIAGNOSIS_zh.md) 與 [`2026-10-15-hist-v2-pilot-r2.SUPERSEDED.md`](2026-10-15-hist-v2-pilot-r2.SUPERSEDED.md)。

這份旁註在封存目錄外面。`2026-10-15-hist-v2-pilot-r2/` 的位元組不要改。

這是 pilot，不是論文結果。沒有勝出主張。主跑與留出集沒有執行。

計畫 1740 格。跑到第 747 格出現一筆 `inconsistent`，執行器停止並封存。沒有覆蓋。

格子：`django:dev:17554_18450:django/db/models/fields/related_descriptors.py`，臂 `textual_merge_file`，順序 reverse，間隔 500 ms，seed 0。

兩份 proposal 17554 與 18450 的臂終態都是 `committed`。觀測本體的 sha256 是 `4eebe97c7539c93d75aad6070c09be042329218f85e55260ffc1005d58424274`，等於 `R({17554,18450})`，也等於同題同順序同間隔同 seed 的 steward 本體。

18450 的 `first_submit` 比 17554 晚 110.327 秒。該 job 的 `arrival_delay_ms` 是 506.531。30 秒的項目期限從較早的那次送出起算，所以 18450 的重新命名落在期限之後，調和終態是 `late-commit-after-timeout`／`rename-after-stop`。整次 acceptance 因為 17554 在期限內 ack 而標成 acked，與 18450 的終態不一致，評分 mismatch 是 `inconsistent:ack`。17554 本身是 `success`。

已執行的 proposal 沒有終態 `error`。類別 A 的 10 題都跑完：steward 與 textual_merge_file 是 400／400，file_lock 是 251／400。五題在舊 pilot 裡被記成 `error` 的提案，這次 file_lock 仍是每格只收下 1 份，另外兩條臂每格收下 2 份。A′ 與 C 沒有執行。B 只執行到這一題的第 9 格，不能當成完整類別計數。

已完成的 steward／textual_merge_file 配對有 249 組，其中 248 組的 accepted_ids、sha256 與 combined_success 相同。不相同的就是上面這一組：位元組相同，成功計數是 2 與 1。

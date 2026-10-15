# pilot-r2 superseded／invalid

`2026-10-15-hist-v2-pilot-r2/` 的位元組沒有改。paper 不引用這份封存。

第 747 格的 `inconsistent` 是 harness v3 的時鐘量測，不是遺失效果、損壞，也不是兩條臂寫出不同位元組。診斷：[`2026-10-15-hist-v2-pilot-r2-stop/DIAGNOSIS_zh.md`](2026-10-15-hist-v2-pilot-r2-stop/DIAGNOSIS_zh.md)。建議的修正沒有套用，也沒有重跑：[`2026-10-15-hist-v2-pilot-r2-stop/PROPOSED_FIX.md`](2026-10-15-hist-v2-pilot-r2-stop/PROPOSED_FIX.md)。

受影響、不能當成觀察：

- `textual_merge_file`，`django:dev:17554_18450`，reverse，500 ms，seed 0 的 `combined_success` 1，以及 `forensics/0746-inconsistent.json`。
- steward 與 textual 的 248／249。不相同的那一組就是上面這一格。
- 因此停在 747／1740。A′、C 與其後的 B 沒有執行。

類別 A 的 steward／textual 400／400 與 file_lock 251／400 不是這次 110 秒牆鐘差算出來的。它們仍在這份被提前停止的封存裡，不要單獨抽進 paper。

# Working-docs snapshot 2026-10-10b — paper 2.0 draft: review fixes

**Status: DRAFT working-docs snapshot. NOT a sealed evidence generation; NO claims (no win claims).**
狀態：工作稿快照，DRAFT；不是 generation。`working-docs/2026-10-10/`（PR #259）不修改，本快照是其後的新目錄。

## What changed（依 2026-10-10 外部審閱；文一同意修正）
修改前備份 `paper/checkpoints/ATM_PAPER_V2_DRAFT_zh.pre-review-fixes-2026-10-10b.md` 與 `working-docs/2026-10-10/paper/ATM_PAPER_V2_DRAFT_zh.md`（PR #259 head `2f4295c3`）逐位元相同（sha256 `3cdcef80…93e5`）。diff：`paper/ATM_PAPER_V2_DRAFT_zh.review-fixes-2026-10-10b.diff`。

1. §2.2「狀態一句話」與 §8 結論：舊句「main 尚未含修正」加上歷史版本限定——只適用於審閱核對時的 main 快照 `3b0f7660`（2026-10-07）。
2. 參考文獻 [24]：STALE 作者全名 Haocheng Xia、Eugene Wu、Yongjoo Park，已對照 arXiv:2609.25396v1 原文核對，移除「待核對」註記。
3. 摘要、§5.8 表 E4、表 R8 欄名、§7.1：「尚未呼叫 ATM」更正為「已呼叫 ATM 准入，但尚未進入 ATM composer／steward apply」（依 harness `worker.mjs`：admission 在重新定位之前；bare_composer 不經准入）。
4. §7.1 HIST 強度上限新增四項揭露：沒有量到跨寫入者批次合成（每程序 `expectedCount`＝1）；語意評分器觀測狀態缺口（外部審閱靜態閱讀，未證明 R12 有誤）與 168 runs 沿用 gold 結果；配對不獨立（483 個不同 PR、117 個出現兩次、183 個群，已由 `sample_main.json` 重算）且修正與驗證同一樣本；9,750 的口徑。
5. §7.3：HIST 後續指向重新設計的 HIST-v2 設計稿（`benchmark-design/2026-10-10-hist-bench-v2/`）。

沒有新增或修改任何實驗數字。Phase 3 450-run 主矩陣仍標未執行。

## Verify
`sh verify.sh .`（嚴格唯讀）。本快照建立後不再修改。

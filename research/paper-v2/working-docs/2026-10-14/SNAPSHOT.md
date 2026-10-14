# Working-docs snapshot 2026-10-14 — paper 2.0 draft before HIST-v2 results

**Status: DRAFT working-docs snapshot. NOT a sealed evidence generation. NO win claims. No benchmark was run.**

狀態：工作稿快照，DRAFT；不是 generation。`working-docs/2026-10-10b/` 不修改。本目錄建立後不再改。

前一稿：`working-docs/2026-10-10b/paper/ATM_PAPER_V2_DRAFT_zh.md`，sha256 `c3db664e7474654b251a37f6115c4f9e40fd3de1a0d67562cce9c30bc789d4bf`。

## 這次寫了什麼

HIST-v2 的主跑、pilot、留出集與 smoke generation 都還沒有。本快照只寫那些結果出現之前可以寫的章節。

1. §1 寫明 HIST v1.1 的三項方法缺陷：`expectedCount` 固定為 1，跨寫入者合成沒有被執行；occ 與 git 三方的比對和寫入不在同一把鎖裡；評分器把 skip 與 xfail 記成通過。
2. §1.4 把 C1′–C3′ 標成評估假設，與草稿 C1–C3 分開。沒有結果。
3. §3、§4 對齊凍結預先登記與 PR #297 的共用 compose inbox 契約，含封批、late joiner，以及 `durable-unacked`、`late-commit-after-timeout`、`reconciliation-incomplete`。證明義務仍是 M1。
4. §5 改寫為 HIST-v2 預先登記，並引用 PR #293、#294、#297、#298、#299。§5.8 保留 v1.1 為方法錯誤的歷史紀錄。
5. Phase 3 450-run 矩陣作廢（§5.9）。不補跑。
6. §6 的表 R-HIST-v2、R-C1′、R-C2′、R-C3′ 是占位，格子是〔待結果〕。沒有新的實驗數字。

## 沒有做的事

沒有跑分類、冒煙、pilot、主跑或留出集。沒有打 git tag，沒有 npm publish。不宣稱勝出。

## Verify

`sh verify.sh .`（嚴格唯讀）。

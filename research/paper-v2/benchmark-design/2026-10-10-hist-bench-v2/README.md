# HIST-v2 benchmark redesign — pre-registration DESIGN DRAFT (2026-10-10)

**Status: DRAFT design document. NOT a frozen pre-registration, NOT an evidence generation. No runs, no results, no claims (no win claims).**
狀態：設計稿。標〔待決 D1–D9〕的項目由文一決定後，另行凍結為預先登記 v2.0（新的 generation）；之後才可跑冒煙測試。本目錄建立後不可變，修訂版另開新目錄。

- `HIST_BENCH_V2_PREREG_zh.md`：主張 C1–C3 與終點、分類工具（**全部候選都測**；只依 PR 本身特徵分成 A 不相交／B 同區可合併／C 真衝突，另標 N 無可跑測試，事先寫好測試目的與正確答案；只排除技術上跑不起來的並記理由碼；held-out 不共用 PR；cluster_id；結果依類別分開報）、多程序 agent 模擬（共用收件匣與批次協調器、依 commit 順序送出、間隔掃描 0／50／100／500／2,000 ms＋抖動、兩種到達順序）、逐層記錄、公平基線（原子提交、統一重試契約、file_lock 成本）、語意評分器七種狀態與五種負控制、混淆矩陣、統計（專案分層、共用 PR 群 bootstrap、配對差值、敏感性）、先小後大、封存與停止規則、待決事項。
- 起因：2026-10-10 外部審閱 HIST v1.x（PR #255 `139cc745`、論文 PR #259）。HIST v1.x 的 generation 不受影響。
- 驗證：`sh verify.sh .`（嚴格唯讀，`sha256sum -c --strict SHA256SUMS`）。

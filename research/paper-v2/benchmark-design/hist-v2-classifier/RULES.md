# HIST-v2 配對分類規則（工具內凍結稿）

狀態：設計草稿的**操作性規則**，供分類器重現。這不是凍結預先登記，也不是 evidence generation。本檔的 SHA-256 見同目錄 `RULES.sha256`。分類器啟動時會核對；不一致即失敗關閉。

權威設計（不可在此 PR 改寫）：`research/paper-v2/benchmark-design/2026-10-10-hist-bench-v2/HIST_BENCH_V2_PREREG_zh.md` §2。`research/paper-v2/working-docs/2026-10-10-hist-v2-prereg/` 是位元組相同副本，分類器不讀、不刪該副本。

本工具**不執行**任何 ATM／基線臂，**不讀** run 結果、`result.json`、`oracle_rows`。語意旗標 S 只在呼叫端另行證明 STALE base validity 時成立；本工具不跑專案測試套件。

## 參數

- 相鄰上界 `ADJACENT_MAX_DISTANCE = 3`。
- hunk 距離沿用 HIST v1.x `build_pairs.py` 的 `dist`：半開區間 `[start, end)`，0-based，對齊 base。相交、端點相接，或兩段插入起點相同，距離為 0。否則距離是兩段之間嚴格隔開的 base 行數。
- 分層：`O1` 距離 0；`O2` 距離 1–3；`O3` 距離 > 3。沒有可比較的 hunk 配對時視為不同區域，分層 `O3`，`min_dist` 為 null。
- hunk 邊界使用 `git diff --diff-algorithm=histogram -U0`。
- 內容合併使用 `git merge-file -p`（預設 diff3）。禁止 `--union`、`--ours`、`--theirs`。衝突標記不是正確答案。
- 送出順序：各 PR **被選中的 head** 的 committer 時間升冪，同時間以 PR 編號升冪。
- 一道題是同一個專案、同一個共同 base、同一個目標檔上的 2–4 份 patch。共同 base 預設是各 PR `mb` 的 `git merge-base`。
- 直接套用失敗時依序嘗試：(a) `pre_rebase_head`（語意旗標因此為 N）；(b) `git merge-file` 把該 PR 的 `mb → head` 三方合併回共同 base。三方合併有衝突則保留為類別 C 的輸入，不把衝突位元組寫進 `expected/`。兩者都不能產生文字結果才記 `unapplicable-to-common-base`。
- 大小（行數、hunk 數、diff 大小）只寫進共變數，**不是**排除理由。

## 寫入類別（互斥，恰好一類）

判定順序固定：

1. **D**：任一份被選中的 patch 對目標檔是新建、刪除或改名（含 copy 成新路徑）。測試目的是寫入安全；被拒絕時必須 fail-closed。不寫期望混合位元組。
2. **C**：任一份 patch 三方合併回 base 時衝突，或完整集合在任一折疊順序上 `git merge-file` 衝突。測試目的是拒絕。正確答案是所有**乾淨且順序無關**的非空相容子集（含單邊）的檔案位元組；不得包含衝突標記或混合結果。完整集合若衝突，不在允許集合內。
3. **B'**：完整集合每個順序都合併乾淨，但位元組不完全相同。順序相依附加層，不併入 A／B／C。各順序的 SHA-256 分開記錄。
4. **A'**：每一邊落到 base 上的檔案位元組完全相同。相同改法附加層，不併入 A／B／C。期望位元組是該唯一結果。
5. **A**：`min_dist` 為 null 或 `min_dist > 3`，且合併乾淨、順序無關、改法不相同。一般寫入。兩邊（全部）效果都保留；期望位元組是送出順序的 `git merge-file` 結果。
6. **B**：`min_dist ≤ 3`，且合併乾淨、順序無關、改法不相同。合成測試。期望位元組同樣是該 git 合併結果。

n-way 折疊：從送出順序的第一份結果開始，其後每一份都以**原始共同 base** 為 ancestor 做 `git merge-file`。2 份時即 `merge-file(side1, base, side2)`。

## 語意旗標（與寫入類別正交）

- **S**：每一邊都有 gold 測試（呼叫端提供的 id，或該邊 diff 裡的測試路徑），且每一邊 `base_validity` 為 `pass`，且沒有任何一邊的 patch 來源是 `rebase-before-head`，且沒有 `base-env-unbuildable`。
- **N**：其餘。理由可並存：`rebase-before-head`、`base-env-unbuildable`、`no-gold`、`base-validity-failed`、`base-validity-not-provided`。`base-env-unbuildable` **只改旗標，不排除**。

`base_validity` 必須由呼叫端以 PR 本身的 STALE 證明提供（base 上 gold 失敗、加上自己的 code patch 後通過）。本工具不執行測試、不讀臂的 run。

## 技術排除（只有這些 reason code）

`head-unavailable`、`checkout-failed`、`binary-or-non-utf8`、`unapplicable-to-common-base`。

- 選中流程需要的 head 物件不在本地物件庫：`head-unavailable`。
- 共同 base commit 無法讀取：`checkout-failed`。
- base 或選中 blob 含 NUL 或不是 UTF-8：`binary-or-non-utf8`。
- 文字 patch 無法放到共同 base，或自動展開時沒有共同的原始碼目標檔：`unapplicable-to-common-base`（診斷訊息會說明是 `no-common-source-file` 或其他原因）。
- `base-env-unbuildable` 不是排除。
- `shared-pr-with-dev` 不是排除。時間窗跨到 held-out／cross-window 的題，若其中一個 PR 已出現在同專案的 dev 題，改記 `set=dev-cross-window` 與 `grouping_codes=["shared-pr-with-dev"]`，仍寫入 `items.jsonl`。
- 時間窗：dev 為 `2024-01-01`～`2025-12-31`（含端點，UTC 日期）；時間 held-out 為 `2026-01-01`～`2026-09-30`。`set=held-out-project` 保留給尚未決定的專案 held-out，不依時間窗改寫，除非觸發 `shared-pr-with-dev`。

## 其他封存欄位

- `cluster_id`：同一專案內，共用任一 PR 的題連成連通群；值為該群字典序最小的 item id（id 已含專案）。這是分析用群，不是刪題。
- 自動展開目標檔時，沿用 v1.x 路徑分類的測試／文件／vendor／產生檔副檔名規則，只跳過這些路徑。呼叫端明示 `target_file` 時不套用此過濾。
- 期望檔案只在正確答案是具體位元組時寫入 `expected/`。D 與「沒有任何乾淨子集」的 C 不寫混合位元組。

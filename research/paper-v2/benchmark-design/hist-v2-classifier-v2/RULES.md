# HIST-v2 分類器 v2 規則

這份檔案凍結**分類器 v2 的工具行為**。它不是預先登記，不是 evidence generation，也不宣告任何基準勝出。`RULES.sha256` 必須與本檔 SHA-256 一致，否則分類器拒絕啟動。

v1 工具 `hist-v2-classifier/` 與其 `RULES.md`（雜湊 `cae1a7fa9f0a90f46d4abaf9eac0a694b9172918cd190cc244b27e0ecd19e487`）保持不變。v2 不覆寫 v1。

## 共同 base

- 輸入是每一個 proposal 的 `mb`（2–4 個）。共同 base 是**全部輸入的極大共同祖先**。
- 演算法是 `git merge-base --octopus --all`，再丟掉被另一個候選祖先所包含的提交，並用 `git merge-base --is-ancestor` 檢查每個結果都是每一個輸入的祖先。
- 禁止使用一般的多參數 `git merge-base A B C`。那是折疊，可能回傳一個並非全部輸入祖先的提交。
- 極大共同祖先剛好一個：採用它，並把完整 40 字元 SHA 封進 `commit_identities`（每個 proposal 的 `mb`／`head`／選用的 mb／head、呼叫端若有提供的 base、候選祖先清單、演算法名稱）。
- 極大共同祖先多於一個：技術排除，理由 `multiple-best-common-bases`。不挑選其中一個。排除列仍封存全部候選 SHA 與輸入身份。
- 呼叫端提供的 `base` 若存在但不是這個唯一極大共同祖先，改用計算結果，並在 `notes` 記下 `supplied-base-replaced-by-true-common-ancestor`。呼叫端提供的 base 不是提交物件時，理由仍是 `checkout-failed`。

## 結果要分開

每一次 `git merge-file -p`（不用 `--union`／`--ours`／`--theirs`）：

- 結束碼 0：`mergeable`。
- 結束碼 1–127：`true-conflict`（衝突次數）。只有這種非零才可以進入類別 C。
- 其餘非零（含負值與 ≥128）：`tool-execution-error`。技術排除，理由 `tool-execution-error`。不得標成 C。

## 移植衝突

單一邊補丁若無法單獨落到共同 base（直接套用失敗，三方合併對它自己的 `mb` 也產生衝突），標 `transplant-conflict` 與 `placement=transplant-conflict`。

這不是兩個都可落地的提案之間的並發衝突，不得因此標成 C。可落地的 proposal 仍可進入原本的 A／B／C／A′／B′ 判斷；可落地的不足兩邊時，`write_class` 為 null，`concurrency_outcome=transplant-conflict`。

直接套用失敗時仍依序嘗試 rebase 前 head（語意旗標 N），再嘗試三方合併。三方合併乾淨則 `placement=mergeable`，`patch_source=3way`。

## 類別 C 的答案

允許結果是**完整 proposal 的合法子集**，3–4 個 proposal 只列出**極大相容子集**（不能再加入另一個完整 proposal 而仍乾淨合併、且各順序位元組相同）。

- 全部拒絕且 base 不變，只有在不存在任何合法子集時才允許（`full_reject_allowed=true`）。
- 安全與進度分開記在 `correct_answer.scoring`：安全＝結果是允許的完整 proposal 子集，沒有假確認，沒有未授權的混合位元組；進度＝仍相容的 proposal 被拒絕。不必要的拒絕是進度成本，不是安全失敗。
- ATM 若拒絕一個類別 B 的題目，那是進度成本，分類器不得把該題改標成 C。
- 與 `git merge-file` 逐位元組相同，只表示符合該文字合併標準，不表示語意上較優。答案裡的 `textual_merge_standard_note_zh` 固定寫明這句。

其餘寫入類別沿用 v1，而且互斥：

- A：可落地提案的 hunk 距離 > 3（或沒有 hunk 對），合併乾淨且順序無關。
- B：`min_dist ≤ 3`，合併乾淨且順序無關。
- A′：可落地提案的結果位元組相同。不併入 A／B／C。
- B′：合併乾淨但順序不同結果不同。不併入 A／B／C。
- D：新建、刪除或改名。寫入安全，fail-closed。不比較混合位元組。

距離沿用 HIST v1.x 的 `dist`：histogram、`-U0`、0-based 半開區間。相鄰上界是 3。語意旗標 S／N 與寫入類別正交。沒有 gold 或沒有 `base_validity=pass` 只把旗標設成 N，不排除。`base-env-unbuildable` 只設 N。大小不是排除理由。

## 留出集洩漏

2026-01-01～2026-09-30（含端點，UTC 日期）的時間切分叫 `later-period-historical-holdout`（後期歷史留出集）。不叫 future data，輸出裡也不使用 `held-out` 這個集合名。輸入若寫 `held-out`，讀入後改成這個名稱。`held-out-project` 仍保留給另一個專案的留出集，不依這個時間窗改寫。

dev 時間窗仍是 2024-01-01～2025-12-31。

分群是跨 dev、cross-window、後期歷史留出集、專案留出集的**完整連通分量**，而且是傳遞的。共享 PR 編號會連起來，所以 (1,2)／(2,3)／(3,4) 是同一個分量。(8,9) 若沒有邊相連，則是另一個分量。

另外用補丁等價加邊，兩者都要傳遞：

- `identical-patch`：非空 diff 的 SHA-256 相同。
- `cherry-pick`：`git patch-id --stable` 相同，但 diff 位元組不同，且主旨沒有 backport。
- `backport`：patch-id 相同、diff 位元組不同，且任一方主旨含 `backport`（不分大小寫）。

分量碰到任一 dev 題時，其他題改 `set=dev-cross-window`，並記下對應的 `grouping_codes`：`shared-pr-component-leak`、`identical-patch-leak`、`cherry-pick-leak`、`backport-leak`。這些題仍在 `items.jsonl`，不是技術排除。一旦因此被標成洩漏，該題就不再是未看過的留出集。

`cluster_id` 使用同一套連通分量（共享 PR 加上補丁等價）。

## 技術排除

只有這些理由：`head-unavailable`、`checkout-failed`、`binary-or-non-utf8`、`unapplicable-to-common-base`、`multiple-best-common-bases`、`tool-execution-error`。

## 不做的事

不執行 ATM 或任何基線臂，不讀 `runs/`、`result.json`、`oracle_rows`。不 checkout、不 commit、不 reset、不 stash。允許的 git 子命令只有 `cat-file`、`diff`、`merge-base`、`merge-file`、`log`、`rev-parse`、`apply`、`patch-id`。`git apply` 只在暫存目錄。

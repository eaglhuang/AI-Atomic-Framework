# HIST-v2 分類器 v5 規則

這份檔案凍結**分類器 v5 的工具行為**。它不是預先登記，不是 evidence generation，也不宣告任何基準勝出。`RULES.sha256` 必須與本檔 SHA-256 一致，否則分類器拒絕啟動。

v1（雜湊 `cae1a7fa9f0a90f46d4abaf9eac0a694b9172918cd190cc244b27e0ecd19e487`）、v2（雜湊 `51cf1fa839e8ade8f07313c170c532eee084d695701be6a38702750a84161e4c`）、v3（雜湊 `72437b355071436d786d22f3d5394b31e68ee24f9d7289d70697b7d2e5ff1982`）、v4（雜湊 `4931ece29c9b39fb5f3b2a5ab32a70920a334a84c8daabfe6d745ca7a2c03544`）保持不變。v5 不覆寫它們。

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

## 合法子集與參考位元組

一個非空子集合法，當且僅當：子集裡每個 proposal 都可落地，而且對共同 base 做 `git merge-file` 時，每一種順序都乾淨、且得到同一份位元組。這條規則可判定，不靠人工挑選。

答案鍵列出**每一個**合法子集，不是只列極大子集。每個子集都有自己的參考位元組 R(S)（`sha256`，以及 `expected/` 裡的檔）。`maximal=true` 表示沒有更大的合法子集包含它。可乾淨合併的 A／B／A′ 同樣列出全部合法子集；整組是唯一的極大子集。順序相依的 B′ 不把整組當成合法子集，只列出那些順序無關的子集。

合法子集的鍵是排序後的 proposal id 集合（`set_key`，與 `prs` 相同），與提交時間、送出順序都無關。`[3, 1]` 與 `[1, 3]` 是同一個鍵。產生器與 `score_run` 都用這把鍵。位元組若依順序而變，那個排列另記在 `order`，不拿來當合法子集的鍵。

類別 C 因此會同時列出極大子集與被它們包含的較小合法子集。例如 {A,C} 與 {B,C} 極大、{A,B} 衝突時，答案仍包含 {A}、{B}、{C}，並把它們標成 `maximal=false`。

- 全部拒絕且 base 不變，只有在不存在任何合法子集時才是唯一合法結果（`full_reject_allowed=true`）。`unchanged_base_sha256` 一律寫上，供評分器核對拒絕有沒有改到檔案。
- 安全與進度分開記在 `correct_answer.scoring`，並且由 `score_run` 對**臂的結果**計算，不在評分時重跑分類。輸入是 `accepted_prs`（實際接受的集合 S）、`observed_sha256`（檔案裡的位元組）、`acked`（是否有期限內的成功確認）。
- 安全通過：S 是某個合法子集，觀察位元組等於 R(S)，而且 `acked` 為真。接受合法但非極大的子集（例如只接受 {A}，而 {A,B} 也合法）是安全通過、進度不足（`progress=shortfall`），不是安全失敗。
- 沒有假確認、檔案仍是 base 的全部拒絕：安全通過。若當時仍有合法子集，進度是不足（不必要拒絕）。只有 `full_reject_allowed` 時，全部拒絕的進度才是極大。
- 假確認、S 不在合法清單、或位元組不等於 R(S)：安全失敗。有合法位元組但沒有期限內 ack，記 `reconcile`，不計成期限內成功。
- ATM 若拒絕一個類別 B 的題目，那是進度成本，分類器不得把該題改標成 C。
- 與 `git merge-file` 逐位元組相同，只表示符合該文字合併標準，不表示語意上較優。答案裡的 `textual_merge_standard_note_zh` 固定寫明這句。

`delivery_rows` 把功能交付率與已接受變更的語意保留分成不同列。功能交付率的分母是有單獨參考測試的全部送出 proposal；合法拒絕仍留在這個分母裡，算進度成本，不放進語意保留的分母。語意保留只對實際接受的集合 S，對照 R(S) 上通過的測試。R(S) 沒有通過的測試（`passing_test_ids` 為空、`reference_pass_count` 為 0）是 `not-evaluable`，理由 `no-passing-tests-on-R(S)`，不是保留率 0。沒有測試、以及分母為 0，各占一列，不把比率寫成 0 或 1。

評分輸入以 `schema/score-input.schema.json` 為準。根上有 `$ref` 指向 `scoreInput`，進入點是 `validate_score_instance`：實際的物件要通過 Draft 2020-12 驗證，不是只檢查欄位在不在。`retained_pass_count` 不得大於 `reference_pass_count`，`retained_test_ids` 必須是 `passing_test_ids` 的子集，兩邊的測試 ID 在各自清單裡都不得重複，兩個計數都不得為負，而且計數必須等於對應清單的長度。`passing_test_ids=["t1"]`、`reference_pass_count=1`、`retained_pass_count=2` 會被拒絕，不得算出 200%。

`textual_merge_file_on_lock`：鎖外算出的候選，只有在鎖內讀到的 base 與鎖外相同時才可以提交。base 變了就丟棄該候選並重算；這一次重算計入 D8 的 8 次重試，時鐘不歸零。重試已經用滿 8 次時不得再重算，也不得提交過期候選。

`reconcile_terminal`：對帳在所有寫入進入點都停止之前不是終態（`reconciliation-incomplete`）。rename 在有效停止時刻以前完成、但 ack 晚了或沒有，終態是 `durable-unacked`，不是 success，也不是 `late-commit-after-timeout`。rename 晚於有效停止時刻才是 `late-commit-after-timeout`。題目停止時，晚送出的 proposal 不另得 30 秒；可執行時間是送到停止時刻的剩餘時間，該 proposal 仍算一份送出，不從分母拿掉。這個函式只給時間終態。準時的 rename 與 ack 把 `time_window_success` 設成真，但 `in_throughput` 仍是假；吞吐不由它單獨決定。

`combined_success` 是最終報告唯一的成功／吞吐組合子，`proposal_final_report` 使用它。一份 proposal 同時滿足三件事才計入吞吐：`reconcile_terminal` 的終態是準時 success、接受的集合合法、最終位元組等於該集合的 R(S)。準時但位元組錯誤、位元組正確但 `durable-unacked`、位元組正確但 `late-commit-after-timeout`、集合不合法、對帳尚未完成，都不計吞吐。真實 harness 接到這個組合子可以等到冒煙之前；這條規則現在就固定。

`equal_weight_pool` 與 `bootstrap_interval` 與 `resample_final_report` 用同一條事先登記的政策，識別字是 `point-reported-interval-undefined`。計畫內的專案等權，權重固定為 1/K。原始樣本裡任一專案分母為 0 時，點估計與區間都是未定義。原始點估計有定義、但某次 bootstrap 重抽的分母為 0 時：點估計仍照原始樣本報告，區間改為未定義，並報告未定義重抽的次數與比例。不刪掉該次重抽，不用其餘重抽的百分位，也不把權重改成 1/(K−1)。

`zero_event_component_bound` 在全部分量事件數都是 0 時給單側 Clopper–Pearson 95% 上界（α＝0.05）：`1 - 0.05^(1/n)`。n 是共享 PR 連通分量數，不是 seed、順序或間隔。這時 bootstrap 百分位區間退化。rule of three（3/n）只是近似，不是主上界。這個上界不是 proposal 失敗率。n＝0 時拒絕計算，那是零分母，不是比率 0。

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

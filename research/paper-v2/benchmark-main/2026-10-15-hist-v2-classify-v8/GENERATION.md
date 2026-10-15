# HIST-v2 分類器 v8 全候選集（2026-10-15）

日期：2026-10-15。這是不可變目錄。這是分類封存，不是臂的 run，不宣稱勝出，不是 C1′–C3′ 的證據。pilot、主跑、留出集實驗都還沒有跑。

分類器 v8 與預先登記目錄都沒有改。規則雜湊 `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541`。`jsonschema==4.18.0`。日期窗是分類器預設：dev `2024-01-01..2025-12-31`，後期歷史留出集 `2026-01-01..2026-09-30`。

## 候選從哪裡來

六個既有專案在 dev 窗的配對，沿用 2026-10-09 已封存的「考慮過的配對」（含當時標成 drift、以及 common-file-not-in-base）。v2 不再把 drift 在分類前丟掉，交給分類器 v8 依規則嘗試最終 head、rebase 前 head 與三方合併。

2026-01-01..2026-09-30 的新 PR，以及 flask、requests，用公開資料補上，沒有使用 GitHub token：

- 未驗證的 Search API，依月切窗列出已合併 PR。
- 公開 PR 頁面內嵌的 `mergeCommitSha`、`headSha`、`baseBranch`、`commitsCount`、`createdTime`、`mergedTime`。
- 公開 git 協定的 bare clone 與 `refs/pull/N/head`。

資格與配對規則與 2026-10-09 的 `build_pairs_merge.py` 相同：預設分支、1..12 個原始碼檔、變更行數不超過 400、開啟區間重疊、至少一個共同原始碼檔。跨窗配對留在同一專案的同一次分類裡，讓 `apply_holdout_leakage` 一次算完。flask 與 requests 的每一列都明示 `set=held-out-project`。

Sphinx 在 2026-01..09 的公開搜尋只回傳 15 個已合併 PR。這個數目照搜尋結果封存，沒有補數。

## 計數

| 項目 | 值 |
|---|---|
| 題目 | 4095 |
| 技術排除 | 3 |
| dev | 3061 |
| dev-cross-window | 813 |
| cross-window | 8 |
| later-period-historical-holdout | 194 |
| held-out-project | 19（flask 4、requests 15） |
| 寫入類別 | A 2873、A′ 10、B 168、C 1、null 1043 |
| dev 綁定 | 3061 個 `hist-v2-dev-replay/1`，`code_patch_sha256` 與 R(S) 雜湊全部吻合，問題 0 |
| dev 沒有的類別 | B′ 與 D。全集合也沒有這兩類 |

dev 題的類別是 A 2153、A′ 8、B 126、C 1、null 773。唯一的 C 是 `sympy:dev:27369_27414:sympy/algebras/quaternion.py`。

留出集題目在 `items.jsonl`，沒有做 dev replay 綁定，也不能拿來跑 smoke。

## 還沒有做的事

沒有跑臂。沒有 smoke、pilot、主跑或留出集實驗。沒有 tag，沒有 npm。分類計數不得用來改預先登記、分類器規則或答案鍵。

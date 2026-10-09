# HIST-PAIRS 六專案重新挖掘（用合併 commit 取 base）— 2026-10-09

| 欄位 | 內容 |
|---|---|
| 性質 | **只做挖掘與可行性評估（prep only）**。沒有跑任何 arm run，沒有抽主樣本，主跑（約 9,750 runs）尚未開始，要作者同意 |
| 時間 | 2026-10-09 23:20–23:34（台北時間） |
| 依據 | `HISTORICAL_BENCH_PREREG_zh.md` v0.1；凍結的試跑選取規則 `SELECTION_RULES.md`（sha256 `3a63dc16…`，原檔與雜湊在 `scripts/frozen-trial/`，`sha256sum -c` 通過） |
| 修正的偏離 | pilot 沒有 token，只能用 `merge-base(head, main tip)` 當 PR base，並排除 162 個 fast-forward PR。本次用 GitHub token 取得 `merge_commit_sha`，改照 prereg §3.1(4)：`mb_X = merge-base(head_X, landing_X^1)` |
| token | 只從環境變數 `GITHUB_MINING_TOKEN` 讀取，沒有印出、記錄或寫入任何檔案（已對整個資料夾和 tgz 掃描，確認不含 token） |
| 標籤 | 作者執行，尚未獨立重現。不宣稱勝出 |

## 1. 每個專案的結果（凍結規則，只換 base 取法）

| 專案 | 時間窗內合併 PR | 合格 PR | PR 排除（理由：數量） | 考慮的配對 | drift 排除 | 其他配對排除 | 候選配對 | O1 同 hunk（相同修改／不同修改） | O2 鄰近 | O3 不同區域 | O0 可用 | 50 對可達（dry-run） | 每 PR 上限 2 時的貪婪容量 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Django | 1,547 | 761 | 非預設分支 40、刪除原始碼檔 3、原始碼檔數不在 1–12（0 個 731、>12 個 9）740、>400 行 3 | 492 | 253 | 0 | 239 | **0**（0／0） | 8 | 231 | 20,113 | 可（50） | 124 |
| SymPy | 867 | 641 | ff 非線性 3、非預設分支 38、刪除原始碼檔 1、檔數（0：139，>12：20）159、>400 行 25 | 140 | 41 | 0 | 99 | **6**（5／1） | 2 | 91 | 8,063 | 可（50） | 69 |
| xarray | 1,094 | 587 | ff 非線性 1、模式變更 1、非預設分支 3、刪除原始碼檔 21、檔數（0：445，>12：17）462、>400 行 19 | 971 | 401 | 共同檔不在 base 2 | 568 | **0**（0／0） | 9 | 559 | 6,152 | 可（50） | 211 |
| pytest | 1,126 | 312 | 模式變更 1、非預設分支（backport）269、刪除原始碼檔 5、檔數（0：524，>12：13）537、>400 行 2 | 167 | 59 | 0 | 108 | **0**（0／0） | 8 | 100 | 1,490 | 可（50） | 65 |
| Sphinx | 1,127 | 555 | 刪除原始碼檔 8、檔數（0：503，>12：38）541、>400 行 23 | 535 | 311 | 共同檔不在 base 1 | 223 | **1**（1／0） | 4 | 218 | 8,525 | 可（50） | 112 |
| FastAPI | 1,515 | 195 | 非預設分支 3、刪除原始碼檔 12、檔數（0：1,296，>12：4）1,300、>400 行 5 | 336 | 140 | 0 | 196 | **0**（0／0） | 2 | 194 | 3,101 | 可（50） | 56 |
| **合計** | 7,276 | 3,051 | | 2,641 | 1,205 | 3 | 1,433 | **7（6／1）** | 33 | 1,393 | 47,444 | 6／6 | |

- 沒有任何 PR 因 `head-unavailable` 或 `landing-unavailable` 被排除；所有 head 和合併 commit 都 fetch 得到。
- Django：用合併 commit 取 base 後，pilot 因 `head-in-main-ff` 排除的 162 個 PR 不再被排除（head 等於合併 commit 的 PR 改用 `head~N` 規則取 base，其中 120 個合格），候選從 186 對增加到 239 對。smoke 和 pilot 的 33 對全部仍是候選，主樣本會排除它們；Django 的 8 個 O2 剛好全部已用在試跑，**主樣本裡 Django 沒有 O2 可抽**。
- 「50 對可達」是**可行性 dry-run**（同 prereg 種子 PCG64(20261008)、每 PR 最多 2 對、分層 17/17/16、不足由 O1→O2→O3 補），**不是正式主樣本**。六個專案都抽得到 50 對，但 O1、O2 幾乎都不夠，絕大多數會由 O3 補位（例如 Django 50 對全是 O3）。FastAPI 容量最緊（貪婪容量 56）。
- O0 對照組（開啟期間重疊、沒有共同原始碼檔）數量充足，只計數，沒有建 payload。

## 2. O1（同一 hunk）結論
- 凍結規則下，六個專案合計只有 **7 個 O1**：SymPy 6、Sphinx 1，其他四個專案都是 0。
- 其中 **6 個是「兩邊做了一模一樣的修改」**（同樣的行、同樣的新內容，例如重複提交或疊在一起的 PR），不是真正的衝突。**真正改法不同的 O1 只有 1 個**（`sympy:27369_27414`，`git merge-file` 也判為衝突）。
- 原因：1,205 個 drift 排除裡，**1,164 個（96.6%）是「後合併的 PR 在合併前已經 rebase 到對方之上」**，也就是兩個 PR 真正改到同一段時，作者早就在合併前解掉衝突了，最終的 head 在共同 base 上本來就套不上。所以只看最終 head，結構上幾乎不可能出現 O1。
- 試過的替代做法（只當診斷，不改選取）：
  - **三方 rebase（X3）**：把 drift 的 patch 用 `git merge-file` 重新套到共同 base。結果 1,064 個衝突、O2 45、O3 85、**O1 0**，沒有幫助。
  - **改用 rebase 前的 head（選項 P）**：對「已經 rebase 到對方之上」的 PR，改用它在對方合併之前最後一個 head（取自 force-push 事件的 beforeCommit、PR 的 commit 和 merge-from-main 的第一個 parent），其他規則不變。結果多出 **70 個改法不同的 O1**（Django 6、SymPy 9、xarray 21、pytest 6、Sphinx 20、FastAPI 8），每 PR 上限 2 時約 65 個，另外多 O2 39、O3 287。人工抽查 `django:19745_19756`：兩邊都改了 `aget_user` 的同一行，內容不同，是真正的同段衝突。
- 因此擬了 prereg v1.1 草稿（**未套用**）：`PREREG_v1.1_PROPOSAL_zh.md`。

## 3. 檔案
- `scripts/`：`mine_graphql.py`（GraphQL 快照）、`build_pairs_merge.py`（凍結規則＋合併 commit base）、`feasibility.py`（dry-run）、`v11_prerebase_estimate.py`（選項 P 估計）、`make_tables.py`；`frozen-trial/` 是凍結的試跑規則與腳本原檔（雜湊驗證通過）。
- `data/`：六個專案的 PR 快照（`*_pr_snapshot_raw.jsonl`）和抓取紀錄。
- `out/<專案>/`：`pr_snapshot.jsonl`、`pr_eligibility.jsonl`（每個 PR 的理由碼）、`candidates.jsonl`（每個配對的理由碼與診斷）、`build_meta.json`、`v11_*`；`out/summary_tables.{md,json}`、`out/feasibility_dryrun.json`。
- `pairs_eligible.jsonl`（含上游程式碼的 hunk payload，合計約 510 MB）**不放進封存**，只記 SHA-256（`MANIFEST.json` 的 `regenerable_not_included`），可用 `build_pairs_merge.py` 從快照和公開 git 歷史決定性重建。
- 偏離與釐清：`DEVIATIONS_mining.md`。

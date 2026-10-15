# HIST-v3 預先登記草稿（2026-10-15）

狀態：**DRAFT。NOT FROZEN。exploratory（探索性）。** 尚未經作者批准，不是凍結的方法，不是實驗證據，沒有 run，不宣稱勝出，不是 C1′–C3′ 的證據。

HIST-v2 預先登記 v2.0（`research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`）維持凍結。本目錄不修改它，也不取代它。

`prereg-v3-draft.md` 封入本目錄。那份草稿自己寫明：草稿、尚未凍結、還沒經作者批准，而且 HIST-v2 維持凍結。目錄一旦寫入 `SHA256SUMS` 就不可改位元組；這只是把草稿封存下來，不是把方法凍結。

草稿把範圍寫成一條刻意的邊界：ATM 只處理同一台機器、同一個 repo 裡代理之間的衝突，因為 CAS、鎖和佇列在本機 `.atm/runtime/`。別台機器的 push、其他 clone 與遠端 PR 仍走一般的 git merge 或 rebase。不主張超出這條邊界。§11 只記錄 push 前的 broker 檢查，不把這條邊界往外推。

要跑 smoke 或 pilot，必須另經作者批准，並把批准後的文本凍結成新的預先登記目錄。在那之前，pilot、main、held-out 都不從這份草稿啟動。

沒有 tag，沒有 npm。

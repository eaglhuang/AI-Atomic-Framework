# HIST-v2 dev replay 綁定 v2

日期：2026-10-15。這是 pilot 輸入，不是論文結果。沒有臂、沒有 run、不宣稱勝出。

schema：`hist-v2-dev-replay/2`。

只含已封存 pilot（`2026-10-15-hist-v2-pilot`）用過的 29 題 `set=dev`。題序與該封存 `observations.jsonl` 第一次出現的順序相同。沒有留出集，沒有主跑題。

每一份 proposal 在 v1 的 `unified_diff`、`allowed_bodies`、`base_text` 之外，加上 `parent_text`（`selected_mb` 上的目標檔）與 `head_text`（`selected_head` 上的目標檔）。原文來自公開 GitHub raw。v1 目錄 `dev-replay-bindings/` 沒有寫入。

`parent_text`／`head_text` 是三方 mine 的輸入，不是答案。合法本體仍以分類器 v8 的 `allowed_bodies` 為 `R(S)`。測試要求 `git merge-file(base, parent, head)` 乾淨且等於該 proposal 的 `R({pr})`。

trial-only — 不得作為論文結果

# HIST-v2 smoke runbook

日期：2026-10-14。這是程序目錄，不是 `benchmark-trials/` 裡的 smoke generation。沒有執行 smoke、pilot、主跑或留出集。沒有勝出主張。

## 釘選

| 項目 | 值 |
|---|---|
| 預先登記 | `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`（不修改） |
| 預先登記 `SHA256SUMS` sha256 | `353caac64fe66cd19afebb3cf16ab2ba010d5810e4250b9156d76bd77144abec` |
| 分類器 v8 `RULES.md` sha256 | `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541` |
| harness v2 `SHA256SUMS` sha256 | `393ea1deec292674d6fe60b2a11ccf6fb47a0c7602af82f2ea2fcf402009e74c` |
| ATM core merge | `cb25242433882d34b514b79338d1a00def53a875` |

## 這次沒有做的事

沒有建立 `research/paper-v2/benchmark-trials/<date>-hist-v2-smoke/`。分類後的 dev 題還沒有接到可核對雜湊的歷史 patch。`run_smoke.sh --execute` 在作者批准且重播綁定齊全之前不會建立 run 目錄。單元測試只在暫存目錄封存觀察，用來確認 `verify.sh`。

## 2026-10-15 執行閘

作者於 2026-10-15 06:56（Asia/Taipei）批准只跑 smoke。`--execute` 在批准值吻合，而且抽中的每一題都有 `hist-v2-dev-replay/1` 歷史 patch 綁定時，才會重播該題並封存。catalog fixture 不能代替 dev 題。寫下這一段時，pilot、main、held-out 仍是退出碼 2。pilot 閘門見下一節，不改寫這一段當時的事實。

寫下執行閘時，倉庫還沒有封存的分類器 v8 `items.jsonl`。因此當時沒有 smoke generation，沒有勝出主張，也不是 C1′–C3′ 的證據。上一份程序封印（PR #299）的 `SHA256SUMS` sha256 是 `0b9c83569cae021f0cfd63e1e7a7d25e9cb29927d8841e672b7a00ccf378cf87`。預先登記目錄沒有修改。

## 2026-10-15 巢狀路徑

歷史題的 `target_file` 可以含目錄。重播在呼叫封存 harness 的 `prepare_workspace` 之前建立父目錄，不改 harness 位元組。分類器 v8 題目已封存在 `benchmark-main/2026-10-15-hist-v2-classify-v8/`（`SHA256SUMS` sha256 `7895681e9833e1cecfc0a0c46cf89ab0204ecabd4f0ef72b385fdbe38d04dd77`）。本目錄仍是程序，不是 smoke generation。緊接在前的程序封印 `SHA256SUMS` sha256 是 `50d3a7c0b23103f91ff9f9a76f2708e9be75e863b5fc909c78fddd5170b94233`。再上一份是 `ea1da1ab3fb1343b3be5ec21578468a2e30ae6f4edf01d92c32cfc451231ceb5`。未綁定的 dev 題仍退出碼 4；已存在的 smoke generation 只核對路徑與 `SHA256SUMS` 沒有被該次拒絕改寫。預先登記目錄與 harness v2 沒有修改。

## 2026-10-15 pilot 閘

作者於 2026-10-15 15:19（Asia/Taipei）批准只跑 pilot。`--stage pilot` 在 `HIST_V2_PILOT_AUTHOR_APPROVAL=issue-292-author-approved-pilot-only` 時才可執行。`main` 與 `held-out` 仍是退出碼 2。smoke 批准值不能打開 pilot。pilot 只用 dev、兩份 proposal 的題，三條主比較臂（steward、file_lock、textual_merge_file），間隔 0／50／100／500／2000 ms，seed 0 與 1，兩種順序。harness 的 `atm` 臂不跑。本目錄仍是程序，不是 pilot generation。預先登記目錄沒有修改。

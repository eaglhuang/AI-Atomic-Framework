# HIST-v2 pilot 診斷（2026-10-15）

這是診斷，不是論文結果，也不是勝出比較。沒有跑主跑，沒有跑留出集。封存的 pilot、smoke、harness v2、預先登記與分類器 v8 位元組都沒有改。

判定：`file_lock` 和另外兩條臂的 A′ 差距，以及 A 裡那 50 格的差距，符合預先登記對 `file_lock` 的臂行為。`steward` 與 `textual_merge_file` 的 600 筆 `error`，以及這兩條臂在類別 B（和類別 A 裡五題）少記的成功，是 harness v2 的實作 bug。缺 §9 抖動是另一項已登記的偏差，解釋不了上述計數差。

## 1. file_lock 為什麼和另外兩條臂不同

預先登記 §3.1：`file_lock` 在鎖內把該 proposal 的 hunk 套進當時讀到的檔案，不用 `git merge-file`。`textual_merge_file` 與 `steward` 的候選來自 `git merge-file`。

### A′：pilot 160／320，smoke 4／8

八題 A′、每一格，`file_lock` 的 `combined_success` 都恰好比另外兩條臂少 1。另外兩條臂接受兩份 proposal（320／320）。`file_lock` 只接受先套上的那一份（160／320）。

代表格 `sphinx:dev:13802_13803:sphinx/ext/autodoc/importer.py`，`file_lock`、forward、間隔 0、seed 0：

- 13803：`committed`
- 13802：`rejected-conflict`，detail 是 `patch context mismatch at line 815`（檔案已經被 13803 改過，同一段 hunk 套不上去）

同一格的 `textual_merge_file` 兩份都是 `committed`。兩份 diff 都能套上共同 base（`selected_mb` 等於共同 base）。這是鎖內 hunk 對 `git merge-file` 的對照，不是 harness 崩潰。

smoke 的 A′ 就是這一題、4 格（1 seed × 2 順序 × 2 間隔）。`file_lock` 每格 1，合計 4／8。`atm`、`steward`、`textual_merge_file` 每格 2，合計 8／8。

### A：250 對 300

200 格裡有 150 格三條臂的成功數相同，50 格 `file_lock` 少 1。這 50 格的 diff 都能套上共同 base，不是下面第 2 節的 bug。少掉的那一份是鎖內第二個 hunk 的 context mismatch。

| 題 | 少 1 的格數 | file_lock 留下 | 另外兩條臂 |
|---|---|---|---|
| `django:dev:16703_17887:django/db/models/query.py` | 11 | 16703 | 16703 與 17887 |
| `django:dev:16703_17893:django/db/models/query.py` | 11 | 16703 | 16703 與 17893 |
| `django:dev:16703_17893:django/db/models/sql/compiler.py` | 11 | 16703 | 16703 與 17893 |
| `django:dev:16703_17973:django/db/models/sql/compiler.py` | 8 | 16703 | 16703 與 17973 |
| `django:dev:16703_18055:django/db/models/sql/compiler.py` | 9 | 16703 | 16703 與 18055 |

例：`16703_17887` 的 `query.py`，reverse、間隔 0、seed 0。17887 的 detail 是 `patch context mismatch at line 2186`。16703 已提交。同一題的 diff 對共同 base 的二方套用是成功的，所以這 50 格不是第 2 節的 mine bug。11+11+11+8+9＝50。

### B：221 對 200，smoke 7／8 對 4／8

21 格 `file_lock` 多 1。它接受的是分類器列為合法的那一對，位元組等於 R(S)。

| 題 | 多 1 的格數 | file_lock 接受 | steward／textual 接受 |
|---|---|---|---|
| `django:dev:16421_17832:django/utils/text.py` | 12 | 16421 與 17832 | 只有 17832 |
| `django:dev:17696_17745:django/contrib/gis/utils/layermapping.py` | 9 | 17696 與 17745 | 只有 17745 |

`text.py`、forward、間隔 0、seed 0：`file_lock` 的 `observed_sha256` 前綴 `dd44d87900d24aff`，等於答案鍵 `16421,17832`。`steward` 的前綴 `8cf250ce5b9c2729`，等於只有 17832。16421 的歷史 diff 套不上共同 base（context mismatch，第 2 節），但 17832 先落地之後，16421 的 hunk 套得上當時的檔案。這是 `file_lock` 的鎖內讀改寫。另外兩條臂少記 16421，是第 2 節的 bug，不是 `file_lock` 多算了一個非法集合。

smoke 的 B 就是 `text.py` 這 4 格。`file_lock` 在 forward 0、forward 500、reverse 0 接受兩份，reverse 500 只接受 17832，合計 7／8。`atm`、`steward`、`textual_merge_file` 每格只接受 17832，合計 4／8。

## 2. 600 筆 error

1740 格 × 2 proposal＝3480。終態 `error` 正好 600。`file_lock` 是 0。`steward` 300，`textual_merge_file` 300。A′ 與 C 是 0。間隔 0／50／100／500／2000 的筆數相同，所以不是逾時，也不是抖動。

| 臂 | 類別 | 每個間隔 | 五個間隔合計 |
|---|---|---|---|
| steward | A | 20 | 100 |
| steward | B | 40 | 200 |
| textual_merge_file | A | 20 | 100 |
| textual_merge_file | B | 40 | 200 |

每一筆都是同一份 proposal、在該題全部 20 格（2 seed × 2 順序 × 5 間隔）各出現一次。`textual_merge_file` 的 detail 全部是 `patch context mismatch`。`steward` 的 detail 是空的，因為 v2 的 `mine_or_none` 把 `PatchApplyError` 吃掉，再記成 `error`。

根因在程式，不在題目逾時：

- `textual.py`：`apply_unified_patch(共同 base, 歷史 diff)` 失敗就回終態 `error`。
- `steward.py`：`mine_or_none` 失敗的 id 在 `_write_all` 記成 `error`。
- `file_lock_arm.py`：同一個 `PatchApplyError` 記成 `rejected-conflict`。
- 分類器 v8 的可落地判定是 `git merge-file(共同 base, parent blob, head blob)`（`pipeline.py` 的 `_three_way`）。綁定裡的 unified diff 是 `diff_path(selected_mb, selected_head)`。`selected_mb` 不等於共同 base 時，這份 diff 可以套不上共同 base，而分類器仍標 `transplant_conflict: false`、`placement: mergeable`。

這 15 份 proposal 都是這種情形。分類器沒有把它們標成 transplant。v2 仍把它們當成工具錯誤丟掉，所以進不了合法子集。

類別 A，proposal 都是 16703：

- `django:dev:15705_16703:django/db/models/query.py`，line 200，`query = queryset.query`
- `django:dev:16703_17730:django/db/models/sql/query.py`，line 26，`Exists`
- `django:dev:16703_17771:django/db/models/sql/query.py`，line 259，`select_for_update_of`
- `django:dev:16703_17829:django/db/models/sql/query.py`，line 584，`else:`
- `django:dev:16703_18055:django/db/models/sql/query.py`，line 584，`else:`

類別 B：

- `django:dev:16421_17832:django/utils/text.py`，16421，line 108
- `django:dev:17554_17811:django/db/models/fields/related_descriptors.py`，17554，line 78
- `django:dev:17554_18450:django/db/models/fields/related_descriptors.py`，17554，line 78
- `django:dev:17554_18450:django/db/models/query_utils.py`，17554，line 264
- `django:dev:17554_19012:django/db/models/query.py`，17554，line 8
- `django:dev:17554_19072:django/db/models/fields/related_descriptors.py`，17554，line 78
- `django:dev:17554_19362:django/db/models/fields/related_descriptors.py`，17554，line 166
- `django:dev:17554_19445:django/db/models/query_utils.py`，17554，line 264
- `django:dev:17554_19614:django/db/models/query.py`，17554，line 8
- `django:dev:17696_17745:django/contrib/gis/utils/layermapping.py`，17696，line 492

預先登記 §3.2 的 `error` 是工具或程序錯誤。context mismatch 是套用器正常拒絕，不是當掉。§2 把單邊落不到共同 base 和 `tool-execution-error` 分開。v2 把前者記成後者。

smoke 的 `atm` 臂同一題也是這個 detail：`django:dev:15705_16703` 的 16703 receipt，`terminal: error`，`patch context mismatch at line 200`。pilot 沒有跑 `atm`。

反例測試在 harness v3 的 `tests/test_three_way_mine.py`。parent→head 的 diff 套不上共同 base；`git merge-file(base, parent, head)` 是乾淨的 `alpha / beta / middle / GAMMA / tail`。沒有 parent／head 時，v3 的 `textual_merge_file` 終態是 `rejected-conflict`，不是 `error`。有 parent／head 時，`textual_merge_file` 與 `steward` 提交那份 mine；`file_lock` 仍拒絕歷史 hunk。

封存 pilot 的 `counterexample` 欄位沒有遺失效果、損壞或 `inconsistent`。那個欄位不是這個 bug。這個 bug 是另一件反例：那 600 筆與受影響的成功計數不能進論文。

## 3. steward 與 textual_merge_file 的位元組

580 個題目 × seed × 順序 × 間隔裡，`observed_sha256` 有 578 個相同，2 個不同。類別計數則每一類都相同。

相同的原因：兩邊都用同一份 mine（v2 是「歷史 diff 套上共同 base」），再對同一把 base 做 `git merge-file`。接受集合相同時，R(S) 的位元組相同。預先登記把 occ 與 git 三方收成 `textual_merge_file`，`steward` 的合法子集證明也是每一種順序的 `git merge-file` 都乾淨且位元組相同。所以在可合併題上，兩條臂位元組相同是預期的，不是多寫了一條臂。

兩個例外都在類別 C，`sympy:dev:27369_27414:sympy/algebras/quaternion.py`。合法子集只有兩個 singleton，沒有那一對。

| seed | 順序 | 間隔 | steward 接受 | textual 接受 |
|---|---|---|---|---|
| 0 | reverse | 0 | 27369，`65b0f39aeaa221c0` | 27414，`8b6164be38f5e2f0` |
| 1 | forward | 0 | 27414，`8b6164be38f5e2f0` | 27369，`65b0f39aeaa221c0` |

兩格的 `combined_success` 都是 1。`file_lock` 各跟上其中一個。這是順序決定哪一個 singleton 先提交。預先登記不要求真衝突題的兩條臂選同一個 singleton。不能寫成「每一格位元組都相同」。

第 2 節的 bug 會讓兩條臂在那 15 題上一起少接同一份 proposal，所以錯誤也是成對的。修了 mine 之後，可合併題仍預期位元組相同；真衝突題仍可以不同。

## 4. 哪些數字受這個 bug 影響

整份 smoke 與整份 pilot 標成 superseded／invalid。下面分「這個 bug 改得動的數」和「這個 bug 解釋不了、但仍在失效封存裡的對照」。論文不要引用其中任何一張表。

受影響，不能當結果：

| 封存 | 數字 | 臂 |
|---|---|---|
| pilot | 終態 `error` 600 | steward 300、textual_merge_file 300；file_lock 是 0，因為同一批失敗被記成 `rejected-conflict` |
| pilot | 類別 A 的 300／400 | steward、textual_merge_file。其中 100 是五題 error proposal 被丟掉之後，只剩下另一份。若三方 mine 接得上，這 100 會變 |
| pilot | 類別 B 的 200／400 | steward、textual_merge_file。十題、每格恰好 1，另一份全部是上面的 `error`。這整個 200 都是少記 |
| smoke | 類別 B 的 4／8 | atm、steward、textual_merge_file。`text.py` 的 16421 被記成 error |
| smoke | 類別 A 的 4／8 裡 16703 的終態 | atm、steward、textual_merge_file 是 `error`。file_lock 是 `rejected-conflict`。成功數目前四條臂都是 4／8，因為 16703 的 hunk 也沒套上 file_lock 讀到的檔；終態標籤已經錯了 |

這個 bug 解釋不了、但所在封存仍然失效，不能抽出去當論文表：

- pilot A′ 160／320 對 320／320，smoke A′ 4／8 對 8／8。鎖內 hunk 對 `git merge-file`。
- pilot A 的那 50 格（250 與 300 的差）。diff 套得上共同 base。
- pilot B 的 file_lock 221／400，以及 smoke file_lock 的 7／8。多出來的接受集合位元組等於 R(S)。對照用的 200／400 與 4／8 是被 bug 少記的那一邊。
- pilot C 的 20／40。三條臂的計數相同。兩格位元組不同，見第 3 節。
- 五個負控制植入。它們不是臂的觀察。

§9 抖動：v2 沒有做。間隔 0 的抖動上限是 0。50 ms 以上的上限不超過 10 ms，兩位 writer 的名義間隔不會因此對調。上面的計數差在五個間隔上的形狀一致，不是缺抖動造成的。抖動仍然要補，v3 已補。它不是把 smoke／pilot 標成失效的那一個原因；失效是第 2 節的 mine／終態 bug。

## 5. 論文草稿裡引用這些數字的位置

要拿掉或等重跑再寫的，是下面這些已寫出的數。封存目錄裡的 `STOP_REPORT.md` 不能改，只能不要抄進論文。

| 位置 | 引用了什麼 |
|---|---|
| `research/paper-v2/EVIDENCE_INDEX.md` §35 末段 | smoke：file_lock B 7／8；A′ 在另外三條臂 8／8、file_lock 4／8 |
| `research/paper-v2/EVIDENCE_INDEX.md` §36 末段 | pilot：file_lock A 250／400，另外兩條臂 300／400；A′ 160／320 對 320／320；B 221／400 對 200／400；C 20／40 |
| `research/paper-v2/benchmark-trials/2026-10-15-hist-v2-pilot/STOP_REPORT.md` | 同上的表、終態 `error` 600、以及 file_lock 對照那幾行。封存，未改位元組 |
| `research/paper-v2/benchmark-trials/2026-10-15-hist-v2-smoke/STOP_REPORT.md` | smoke 的 combined_success 表，含 file_lock A′ 4／8、B 7／8。封存，未改位元組 |

`research/paper-v2/README.md` 的 smoke／pilot 列沒有寫這些分數。`working-docs/` 裡的論文草稿沒有 250／400、160／320、221／400 或 smoke 的 7／8。`related-work/2026-10-15/` 沒有這些試跑計數。

## 6. harness v3 與沒有 pilot-r2

新目錄是 `research/paper-v2/benchmark-harness/hist-v2-harness-v3/`。v2 的 `verify.sh` 仍然通過。v3 做了兩件事，記在它的 `GENERATION.md`：

- §9 抖動，由 seed、題目、順序、間隔與 writer 序決定。
- proposal 若帶 `parent_text` 與 `head_text`，`textual_merge_file`、`steward`、`atm` 使用三方 mine。context mismatch 改記 `rejected-conflict`。`file_lock` 仍用歷史 hunk。

沒有產生 pilot-r2。封存的 `hist-v2-dev-replay/1` 只有共同 base、歷史 diff 與 R(S)，沒有 parent／head 原文。用同一批綁定重跑不會走到三方 mine，不能拿來取代上面的數。重跑要另做一份含 parent／head 的綁定，而且仍是 pilot，不是論文結果。主跑與留出集維持退出碼 2，這次沒有跑。

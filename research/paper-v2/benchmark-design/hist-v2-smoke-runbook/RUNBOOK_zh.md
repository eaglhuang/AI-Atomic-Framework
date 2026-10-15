trial-only — 不得作為論文結果

# HIST-v2 冒煙 runbook

這份文件說明怎麼做一次**只用來確認管線可運作**的小型 smoke。產出若經作者批准而封存，只能放在新的 `benchmark-trials/<date>-hist-v2-smoke/`，而且是 trial-only，不得作為論文結果。本次交付沒有執行 smoke、pilot、主跑或留出集。

## 依賴

四個釘選寫在 `pins.json`。開跑前全部檢查，任一不符就以非 0 結束，並且不建立 run 目錄。

| 檢查 | 釘選 |
|---|---|
| 預先登記 v2.0 `verify.sh` | `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/`，其 `SHA256SUMS` 的 sha256 是 `353caac64fe66cd19afebb3cf16ab2ba010d5810e4250b9156d76bd77144abec` |
| 分類器 v8 `RULES.md` | sha256 `329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541`，並與 `RULES.sha256` 一致 |
| harness v2 `SHA256SUMS` | 目錄 `research/paper-v2/benchmark-harness/hist-v2-harness-v2/`，`verify.sh` 通過，且 `SHA256SUMS` 的 sha256 是 `393ea1deec292674d6fe60b2a11ccf6fb47a0c7602af82f2ea2fcf402009e74c` |
| core merge | `cb25242433882d34b514b79338d1a00def53a875` 必須是 commit、是 HEAD 的祖先，而且 `packages/core/src/broker` 與 `scripts/validate-shared-compose-inbox.ts` 相對該 commit 沒有差異、工作區也沒有未提交變更 |

預先登記目錄、分類器 v1–v8、設計稿 r2–r7、既有 generation 都只讀。本程序不修改它們。

## 抽題

輸入是分類器 v8 的 `items.jsonl`（`schema_version` 為 `hist-v2-items/8`，而且該列的 `rules_sha256` 等於上面的規則雜湊）。

- 只從 `set=dev` 抽。
- 類別沿用分類器的 `write_class`：`A`、`B`、`C`、`A'`、`B'`、`D`。議題裡的 A′、B′ 就是這兩個 ASCII 撇號標籤。
- 每個有題的類別只抽 1 題。同一類別裡依 `project`、`id` 排序後取第一題。沒有的類別記入 `missing_classes`，不另造題。
- `flask`、`requests`（含 `pallets/flask` 這類路徑的最後一節）、`later-period-historical-holdout`、`held-out-project`、`held-out` 一律拒絕，不進入抽題。
- `dev-cross-window` 與 `write_class` 為 null 的列跳過，不當作 dev 題。

## 矩陣

對每一題：

- 臂：`atm`、`textual_merge_file`、`steward`、`file_lock`
- 到達間隔：只保留 0 ms 與 500 ms
- 順序：`forward`、`reverse`
- seed：只有 0

臂的先後用與 harness 計畫相同的 `Random(f"{seed}:{item_id}")` 洗牌，所以這一格是完整矩陣的子集，不是另一套順序。每一題 16 格。計畫物件的 `executed` 與 `runs_started` 維持 0，直到真的有作者批准的重播結果。這個腳本自身不呼叫 harness 的 `run_fixture`。

## 負控制

封存函式會呼叫 harness v2 的五個植入，名稱是：

- `lost-accepted-proposal`
- `partial-apply`
- `bytes-do-not-match-R(S)`
- `illegal-subset`
- `late-write-after-timeout`

它們是植入，不是臂的觀察。`STOP_REPORT.md` 列出每一個的 `caught_as`、`combined_success`，以及是否全部被抓到。植入列的 `combined_success` 應為 false。

## 封存

作者批准並完成重播之後，結果才寫到：

`research/paper-v2/benchmark-trials/<date>-hist-v2-smoke/`

該目錄的 `GENERATION.md` 第一行是 `trial-only — 不得作為論文結果`。同目錄還有 `MANIFEST.json`、`SHA256SUMS`、唯讀 `verify.sh`、`STOP_REPORT.md`。目錄已存在任何檔案時拒絕覆寫。

`STOP_REPORT.md` 只列：每臂每類別的格子數、`combined_success` 計數、proposal 計數、batch size 分布、終態分布、負控制是否全被抓到、counterexample、偏離、建議。不寫臂的優劣，不估計比較區間。

## counterexample

觀察若帶有 lost effect、損壞（`corruption`）或 `inconsistent`，封存函式把鑑識寫進 `FORENSIC.json` 與 `forensics/`，回傳非 0，並且下一次封存同一目錄會失敗而不改檔。不要刪除、不要改寫、不要重跑覆蓋。

## 明確不做

- 不執行 pilot、主跑、留出集。`--stage pilot`、`main`、`held-out` 直接非 0，不建立目錄。
- 不把 catalog fixture 拿來代替 dev 題。harness v2 的 `run_fixture` 只跑合成 fixture。
- 不用 smoke 結果修改預先登記、分類器規則或答案鍵。設計問題寫在建議節，由作者決定。
- 不打 git tag，不 npm publish。

## 命令

在儲存庫根目錄：

```bash
sh research/paper-v2/benchmark-design/hist-v2-smoke-runbook/run_smoke.sh
```

這只做釘選檢查。加上 `--items path/to/items.jsonl` 會把抽題與計畫印到標準輸出，仍然不建立 run 目錄。

```bash
sh research/paper-v2/benchmark-design/hist-v2-smoke-runbook/run_smoke.sh --stage pilot
```

預期非 0，且沒有 run 目錄。

`--execute` 需要環境變數 `HIST_V2_SMOKE_AUTHOR_APPROVAL=issue-292-author-approved-smoke-only`，再加上 `--items`（分類器 v8 的 `items.jsonl`）與 `--binding`（每一題的歷史 patch 綁定）。批准值不符時退出碼 3。沒有綁定、diff 或 R(S) 的 SHA-256 對不上分類器欄位，或題目是 harness catalog fixture 時，退出碼 4，不建立目錄。歷史題的 `target_file` 可以含目錄；重播在呼叫封存的 harness 之前建立那些父目錄，不改 harness 位元組。環境變數本身不是批准紀錄；批准是作者另一次明示。

綁定檔 schema 是 `hist-v2-dev-replay/1`。每一題要有 base 原文、每份 proposal 的 unified diff，以及每個合法子集的 R(S) 原文。diff 的 SHA-256 必須等於該題 `patches[].code_patch_sha256`。base 與 R(S) 的 SHA-256 必須等於答案鍵。catalog fixture 的 id，或與 catalog 相同的檔名加 base，都拒絕。pilot、main、held-out 仍直接退出碼 2。

## 已知缺口

倉庫裡還沒有封存的分類器 v8 `items.jsonl`，也沒有對得上那些雜湊的歷史 git patch。作者於 2026-10-15 06:56（Asia/Taipei）批准只跑 smoke 之後，`--execute` 仍然因缺少重播綁定而退出碼 4，不建立 `benchmark-trials/`。六個 catalog fixture 不能充當 dev 抽題。這是程序缺口，不是某一次 run 的 counterexample。

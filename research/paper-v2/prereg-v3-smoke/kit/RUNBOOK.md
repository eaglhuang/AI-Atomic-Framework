# prereg-v3 smoke 執行手冊

這是探索性冒煙測試的一鍵套件，不是論文數據，也不宣稱 ATM 勝出。執行者只跑下面的指令。預設代理是使用者機器上的 Codex CLI 0.159.2。

## 先決條件

- 這個儲存庫的工作目錄（包裝程式用 Node 直接載入目前 main 的 TypeScript 路徑）。
- Node.js 22 或更新。24 以上用 `--strip-types`，否則用 `--experimental-strip-types`。
- `git`、`jq`、`python3`。
- Django 臂：CPython 3.8、3.9 或 3.10（Django 3.2 的支援範圍）。沒有時可先裝 `uv`，`setup.sh` 會叫 `uv python install 3.10`。SWE-bench 舊的 conda 環境寫的是 Python 3.6，這份套件不使用 3.6。
- Codex CLI 0.159.2，已用免費 ChatGPT 登入，而且 `codex exec` 在非互動環境跑得起來。
- 不要設付費 API 金鑰來繞過免費額度。

## 題目

正式題是 `tasks.json` 的 `primary`：`django__django-13820` 與 `django__django-11141`。共同 base 是較新的 `98ad327864aed8df245fd19ea9d2743279e11643`。兩份官方 gold patch 都能在乾淨的這個 commit 上 `git apply --check`。11141 會偏移 4 行。Steward 的 unified diff 套用是逐字對上下文，不接受偏移，所以 `gold/django__django-11141.common-base.patch` 是官方 patch 套上共同 base 之後的 `git diff`，檔案位元組與官方 `git apply` 相同。Stub 與評估用的 intended diff 用這份重新定位過的 patch。兩份接連 `git apply` 會失敗，因為它們改到 `django/db/migrations/loader.py` 的重疊區。其餘重疊配對沒有同時通過這個檢查；兩個備案寫在 `tasks.json` 的 `backups`，而且 `runnable` 是 false，不要換成它們，除非你重新做過 `git apply` 並把結果寫進封存。

## 指令（依序、各一次）

在儲存庫根目錄：

```bash
bash research/paper-v2/prereg-v3-smoke/kit/setup.sh
bash research/paper-v2/prereg-v3-smoke/kit/run_arm_a.sh
bash research/paper-v2/prereg-v3-smoke/kit/run_arm_b.sh
bash research/paper-v2/prereg-v3-smoke/kit/evaluate.sh
bash research/paper-v2/prereg-v3-smoke/kit/seal.sh --publish-index
```

`--publish-index` 只在 `research/paper-v2/EVIDENCE_INDEX.md` 追加一列，標成 smoke / exploratory、沒有勝出宣稱。索引檔不存在時會停，不會另建一份。

模型用環境變數 `CODEX_MODEL`。留空時不加 `--model`，讓已登入的免費 ChatGPT 帳戶使用它自己的預設模型。腳本會把實際模型名稱寫進各臂的 `model.txt`。兩臂用同一組旗標。

## 免費額度停止規則

任一工作階段的 stdout 或 stderr 出現 usage limit、rate limit、quota、HTTP 429 這類字樣時，該臂寫下 `QUOTA_STOP` 並以退出碼 75 結束。不要重試、不要換付費模型、不要再跑另一臂。把已有的 log 照樣 `evaluate.sh` 與 `seal.sh`，並在 issue #311 寫明停在哪一臂。

## Arm B：什麼是強制的，什麼只是指示

| 層 | 行為 |
|---|---|
| 指示 | 提示詞要求只能用 `atm-write <file> <patch>`。退出碼 3 是 steward 拒絕，不准改自己寫檔。 |
| 強制 | Arm B 的 `PATH` 把 `git` 換成拒絕 `commit`、`add`、`apply`、`checkout`、`reset`、`merge`、`rebase`、`stash` 的 shim。直接 `git commit` 退出碼 86。 |
| 強制 | `atm-write` 內部改回真正的 `/usr/bin/git`，並呼叫目前 main 的 `submitSharedComposeProposal`（提案、合成、base hash 比對、原子改名）以及 `runSharedDeliveryCommitTransaction`（准入、seal、`commit-tree`、`update-ref` CAS）。 |
| 偵測 | `evaluate.sh` 比對每個工作階段的 intended diff 與最終樹。沒有 steward 拒絕紀錄、但新增行不在最終樹，記為遺失寫入。steward JSONL 記拒絕、重試、`hashDriftCount`、HEAD 移動次數，以及寫入完成到 commit 發布的毫秒數。 |
| 沒有強制 | 沒有把整個工作樹設成唯讀。模型仍可能用 shell 重新導向寫檔。那種寫入不會有 steward 收據，評估會把它標成繞過後的遺失或未登記變更。 |

0.1.20 的公開 CLI 有 `broker proposal`、`broker compose`、`broker steward plan|apply`，都要事先準備好的 merge plan，沒有「兩個即時 unified diff」的入口，也沒有 `shared-compose` 子指令。所以這份套件不用 0.1.20 的那條指令當寫入路徑。

## 在 #311 要回報的內容

- PR 連結。
- 兩個 instance id 與共同 base。
- 各臂遺失寫入數、衝突或 index.lock 數、steward 拒絕數、FAIL_TO_PASS / PASS_TO_PASS 通過數。
- 模型名稱、Codex 版本、是否觸發免費額度停止。
- 任何反例（包含 Arm B 仍遺失寫入）照實寫，不要寫成勝出。

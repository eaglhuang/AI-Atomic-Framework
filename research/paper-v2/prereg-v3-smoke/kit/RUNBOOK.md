# prereg-v3 smoke 執行手冊

這是探索性冒煙測試的一鍵套件，不是論文數據，也不宣稱 ATM 勝出。執行者先跑 preflight，再跑下面的指令。預設代理是使用者機器上的 Codex CLI 0.159.2。stub 乾跑與 CI 綠燈不是真實 A/B 結果。

## 先決條件

- 這個儲存庫的工作目錄。Arm B 寫入只走公開 npm CLI `@ai-atomic-framework/cli@0.1.20` 的 `broker steward apply`。套件裝在 git workspace 外面，Linux 預設是 `/var/cache/prereg-v3-atm-cli-0.1.20`（steward 使用者讀得到；不要裝進家目錄，家目錄通常不可穿越）。不會使用倉庫裡版本較舊的 frozen runner。沒有這支 CLI 就中止 Arm B，沒有 claim 退路，也不改走 TypeScript 直接載入。
- Linux：免密碼 `sudo`（`sudo -n true` 要成功）。套件會自行建立系統使用者 `prereg-steward`（擁有工作樹與 steward 行程）與 `prereg-session`（跑模型，不在 `sudo` 群組，shell 是 `nologin`）。不需要手動 `useradd`。若 `sudo -n` 失敗，Arm B 直接中止，不會退回 `chmod a-w`。
- Windows 或 macOS：這兩個系統使用者通常建不起來。此時邊界改成 Codex `--sandbox read-only`，steward 行程留在沙盒外面。那是另一道控制，不是下面這道 Linux 擁有者邊界。這份套件的擁有者邊界是在 Ubuntu 24.04.5 LTS、Linux 6.12.94+ x86_64 上驗證的；GitHub Actions 的 `ubuntu-latest` 會再跑同一份 preflight。
- Node.js 22 或更新。24 以上用 `--strip-types`，否則用 `--experimental-strip-types`。
- `git`、`jq`、`python3`。
- Django 臂：CPython 3.8、3.9 或 3.10（Django 3.2 的支援範圍）。沒有時可先裝 `uv`，`setup.sh` 會叫 `uv python install 3.10`。SWE-bench 舊的 conda 環境寫的是 Python 3.6，這份套件不使用 3.6。
- Codex CLI 0.159.2，已用免費 ChatGPT 登入，而且 `codex exec` 在非互動環境跑得起來。
- 不要設付費 API 金鑰來繞過免費額度。

## 題目

正式題是 `tasks.json` 的 `primary`：`django__django-13820` 與 `django__django-11141`。共同 base 是較新的 `98ad327864aed8df245fd19ea9d2743279e11643`。2026-10-15 在乾淨的這個 commit 上獨立重跑 `git apply --check`：13820 乾淨套上、沒有偏移；11141 也套得上，但兩個 hunk 都偏移 4 行（`Hunk #1 succeeded at 88`、`Hunk #2 succeeded at 95`）。Steward 的 unified diff 套用是逐字對上下文，不接受偏移，所以 `gold/django__django-11141.common-base.patch` 是官方 patch 套上共同 base 之後的 `git diff`。金標檔只留在評估端，工作階段看不到路徑。兩份接連 `git apply` 會失敗，因為它們改到 `django/db/migrations/loader.py` 的重疊區。其餘重疊配對沒有同時通過這個檢查；兩個備案寫在 `tasks.json` 的 `backups`，而且 `runnable` 是 false，不要換成它們，除非你重新做過 `git apply` 並把結果寫進封存。

## 指令（依序、各一次）

在儲存庫根目錄。先跑 preflight；六項任一失敗就停，不要啟動真實 Codex：

```bash
bash research/paper-v2/prereg-v3-smoke/kit/preflight.sh
bash research/paper-v2/prereg-v3-smoke/kit/setup.sh
bash research/paper-v2/prereg-v3-smoke/kit/run_arm_a.sh
bash research/paper-v2/prereg-v3-smoke/kit/run_arm_b.sh
bash research/paper-v2/prereg-v3-smoke/kit/evaluate.sh
bash research/paper-v2/prereg-v3-smoke/kit/seal.sh --publish-index
```

`setup.sh` 每次使用新的 run-id，state 放在 `kit/state/runs/<run-id>/`。目錄已存在就中止，不會 `rm` 既有 state。要自己指定路徑時設定 `PREREG_SMOKE_STATE` 或 `PREREG_RUN_ID`，而且那個目錄必須還不存在。

`--publish-index` 只在 `research/paper-v2/EVIDENCE_INDEX.md` 追加一列，標成 smoke / exploratory、沒有勝出宣稱。索引檔不存在時會停，不會另建一份。

模型用環境變數 `CODEX_MODEL`。留空時不加 `--model`，讓已登入的免費 ChatGPT 帳戶使用它自己的預設模型。腳本會把實際模型名稱寫進各臂的 `model.txt`。兩臂用同一組旗標。

## 免費額度停止規則

任一工作階段的 stdout 或 stderr 出現 usage limit、rate limit、quota、HTTP 429 這類字樣時，該臂寫下 `QUOTA_STOP` 並以退出碼 75 結束。不要重試、不要換付費模型、不要再跑另一臂。把已有的 log 照樣 `evaluate.sh` 與 `seal.sh`，並在 issue #311 寫明停在哪一臂。

## Arm B：什麼是強制的，什麼只是指示

| 層 | 行為 |
|---|---|
| 指示 | 提示詞要求只能用 PATH 上的 `atm-write <file> <patch>`。退出碼 3 是 steward 拒絕，不准自己寫檔。 |
| 強制（Linux） | 工作樹屬於 `prereg-steward`，模式是擁有者可寫、其他人唯讀。模型行程以 `prereg-session` 執行，不是擁有者，所以 `chmod` 改不回來，`mv` / 直接寫入也會失敗。session 沒有 sudo。寫入只走一支由 steward 身份聽的 Unix socket；`atm-write` 把 patch 送過去，steward 再呼叫公開 CLI。socket 目錄不是 session 可寫的，不能被換掉。 |
| 強制（Windows / macOS 退路） | 建不起系統使用者時，Codex Arm B 加上 `--sandbox read-only`。steward 在沙盒外。Arm A 仍是 `workspace-write`。 |
| 強制 | `atm-write` 用 `readlink -f` 找到套件內的 `atm-write.mjs`。session 環境有 `PREREG_STEWARD_SOCK` 時它只當 socket 客戶端；steward 行程才呼叫公開 CLI 0.1.20 的 `broker compose` 與 `broker steward apply`。CLI 缺失或版本不是 0.1.20 時，Arm B 在工作階段開始前中止，沒有 claim 退路。 |
| 強制 | Arm B 的 `PATH` 把 `git` 換成拒絕 `commit`、`add`、`apply`、`checkout`、`reset`、`merge`、`rebase`、`stash` 的 shim。直接 `git commit` 退出碼 86。 |
| 隔離 | 工作階段以 `env -i` 與允許清單啟動。`PREREG_GOLD_PATCH`、`GOLD_ROOT` 與金標檔路徑不會進入環境或 workspace。金標只在工作階段結束後由 `evaluate.py` 使用。 |
| 偵測 | launcher 把工作階段的 unified diff 收成 `session/intended.patch`。缺少這份證據時 `evaluate.py` 以狀態 `evidence_missing` 非 0 退出，遺失修改數是 null，不會記成 0。Django 測試用 `--verbosity 2`，依每一列 `... ok` / `FAIL` / `ERROR` 計數。 |

## 在 #311 要回報的內容

- PR 連結。
- 兩個 instance id 與共同 base。
- 各臂遺失寫入數、衝突或 index.lock 數、steward 拒絕數、FAIL_TO_PASS / PASS_TO_PASS 通過數。
- 模型名稱、Codex 版本、是否觸發免費額度停止。
- 任何反例（包含 Arm B 仍遺失寫入）照實寫，不要寫成勝出。

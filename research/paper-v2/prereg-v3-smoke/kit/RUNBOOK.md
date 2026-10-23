# prereg-v3 smoke 執行手冊

這是探索性冒煙測試的一鍵套件，不是論文數據，也不宣稱 ATM 勝出。執行者先跑 preflight，再跑下面的指令。預設代理是使用者機器上的 Codex CLI。支援的版本是 0.159.2 與 0.163.0。stub 乾跑與 CI 綠燈不是真實 A/B 結果。

## 先決條件

### Python, session PATH, and bounded probe attempts (#345)

Preflight runs **before setup**. With `PREFLIGHT_REAL_MODEL=1`, explicitly set
`PREREG_PYTHON=/absolute/path/to/a/CPython-3.8-3.10-venv/bin/python` before
running preflight. The venv must have executable `bin/python` and `bin/python3`.
An unset, relative, non-executable or incompatible interpreter fails at the
start of preflight, before Codex login checks or model calls. Preflight does
not create or download Python. Offline preflight does not require this setting.

Setup independently uses `pick_python`: an executable `PREREG_PYTHON`, then
`python3.10`, `python3.9`, `python3.8`, then the existing `uv` installation path.
It creates the evaluation venv in the new run state and saves that venv's Python
in `env.sh`. A preflight setting does not replace setup's evaluation venv.

Both probe and formal sessions use this exact PATH order:
`PREREG_ARM_BIN:kit/bin:evaluation-venv/bin:node-bin:/usr/bin:/bin`.
The Codex executable is resolved to an absolute path outside the session;
its directory and the operator's PATH prefixes are not inserted into session
PATH. `.prereg-path.sh` and `launch-env.txt` use the same path builder.
The login-shell check verifies `git`, `python`, `python3`, and `atm-write`.

Each arm's probe permits at most **two total attempts**. Only a missing
`BEGIN_INTENDED_PATCH`, after successful model exit and verified arm-specific
write/commit evidence, permits the second attempt. Each attempt starts with a
fresh repository and session. `probe-result` lines in preflight stdout record
arm, attempt, reason, file changes, HEAD advancement and steward acceptance;
retain the complete stdout/stderr in the preflight log. PATH resolution failure,
Arm A without a valid commit, Arm B without an accepted committed steward write,
quota exhaustion, nonzero model exit and malformed patches never retry. Missing
the marker twice fails; there is no third attempt and no paid fallback.


- 這個儲存庫的工作目錄。Arm B 寫入只走公開 npm CLI `@ai-atomic-framework/cli@0.1.22` 的 `broker steward apply-live`。套件裝在 git workspace 外面，Linux 預設是 `/var/cache/prereg-v3-atm-cli-0.1.22`（steward 使用者讀得到；不要裝進家目錄，家目錄通常不可穿越）。不會使用倉庫裡版本較舊的 frozen runner。沒有這支 CLI 就中止 Arm B，沒有 claim 退路，也不改走 TypeScript 直接載入。preflight 先找已經裝好、版本正好是 0.1.22 的 CLI（環境變數、安裝前綴、全域 npm，或本機 cache 的 `npm install --prefer-offline`）。連不上 registry（例如 `getaddrinfo EAI_AGAIN`）會退避重試；仍然失敗就報網路錯誤並中止，不會改用其他版本。本機 npm cache 如果還留著舊索引，安裝 0.1.22 可能出現 `ETARGET`。這時執行 `npm cache clean`，或刪掉 npm 的 cache 目錄，再重跑 preflight。不要改用其他版本。預先算好的 `broker steward apply --merge-plan-file` 仍留在 CLI，這條即時路徑不使用它。
- Linux，而且 `sudo -n true` 成功：套件會自行建立系統使用者 `prereg-steward`（擁有工作樹與 steward 行程）與 `prereg-session`（跑模型，不在 `sudo` 群組，shell 是 `nologin`）。不需要手動 `useradd`。工作樹若放在其他人不能進入的家目錄下（GitHub Actions 的 `/home/runner` 常是 `750`），套件會對沿途目錄補上其他人的進入權（`chmod o+x`），不開放寫入，否則這兩個使用者連路徑都走不進去。
- Linux，而且沒有 `sudo`（`sudo -n true` 結束碼 127，或任何免密碼 sudo 失敗）：Arm B 自動改用下面的無 sudo 沙盒。preflight 會用同一個機制跑一個真實的沙盒行程，確認對儲存庫的直接寫入、`chmod`、`mv`、`rm` 都失敗，而 steward 寫入成功。Codex sandbox 與 bubblewrap 都起不來時，preflight 直接中止。不退回 `chmod a-w`，也不退回沒有強制的模式。工作樹不能放在 `/tmp`（Codex `:workspace` 把 `/tmp` 當可寫根），也不能放在 scratch 裡面。
- Windows 或 macOS：這兩個系統使用者通常建不起來。此時邊界改成 Codex `--sandbox read-only`，steward 行程留在沙盒外面。那是另一道控制，不是下面這道 Linux 擁有者邊界，也不是 Linux 無 sudo 沙盒。這份套件的擁有者邊界是在 Ubuntu 24.04.5 LTS、Linux 6.12.94+ x86_64 上驗證的；GitHub Actions 的 `ubuntu-latest` 會再跑同一份 preflight，並用系統的 bubblewrap 再驗一次無 sudo 沙盒。
- `node` 必須在 `PATH` 上，而且是 Node.js 22 或更新。24 以上用 `--strip-types`，否則用 `--experimental-strip-types`。
- `git`、`jq`、`python3`。
- Django 臂：CPython 3.8、3.9 或 3.10（Django 3.2 的支援範圍）。沒有時可先裝 `uv`，`setup.sh` 會叫 `uv python install 3.10`。SWE-bench 舊的 conda 環境寫的是 Python 3.6，這份套件不使用 3.6。
- Codex CLI 0.159.2 或 0.163.0，已用免費 ChatGPT 登入，而且 `codex exec` 在非互動環境跑得起來。這兩個版本在 `workspace-write` 下都會保護工作目錄裡的 `.git`、`.agents`、`.codex`、`.aws`。Arm A 代表一般共用儲存庫，launcher 把該工作樹的 `.git` 放進 `sandbox_workspace_write.writable_roots`，`git add` 與 `git commit` 才寫得了 `index.lock`；不開 `network_access`。Arm B 不加這個根。`PREFLIGHT_REAL_MODEL=1` 時，Arm A 探測必須真的 `git add` 並 `git commit`，HEAD 沒有前進就失敗。
- 不要設付費 API 金鑰來繞過免費額度。

## 題目

正式題是 `tasks.json` 的 `primary`：`django__django-13820` 與 `django__django-11141`。共同 base 是較新的 `98ad327864aed8df245fd19ea9d2743279e11643`。2026-10-15 在乾淨的這個 commit 上獨立重跑 `git apply --check`：13820 乾淨套上、沒有偏移；11141 也套得上，但兩個 hunk 都偏移 4 行（`Hunk #1 succeeded at 88`、`Hunk #2 succeeded at 95`）。Steward 的 unified diff 套用是逐字對上下文，不接受偏移，所以 `gold/django__django-11141.common-base.patch` 是官方 patch 套上共同 base 之後的 `git diff`。金標檔只留在評估端，工作階段看不到路徑。兩份接連 `git apply` 會失敗，因為它們改到 `django/db/migrations/loader.py` 的重疊區。其餘重疊配對沒有同時通過這個檢查；兩個備案寫在 `tasks.json` 的 `backups`，而且 `runnable` 是 false，不要換成它們，除非你重新做過 `git apply` 並把結果寫進封存。

## 指令（依序、各一次）

在儲存庫根目錄。先跑 preflight；任何一項失敗就立刻停止，不繼續後面的檢查，也不要啟動真實 Codex。`PREFLIGHT_REAL_MODEL` 沒設成 `1` 時，preflight 會寫明跳過真實模型探測，不呼叫 Codex。設成 `1` 才會用已經登入的 ChatGPT，對這一輪實際選到的邊界模式跑一次很小的、與 Django 題目無關的 `codex exec`（Arm A 一次，Arm B 用同一個模式一次）。不會把每種可用模式都跑過。`PREREG_BOUNDARY` 可以覆寫自動選擇，只能是 `unix-user`、`codex-landlock`、`bwrap-ro` 或 `codex-sandbox`。沒設時與正式的 `run_arm_b.sh` 相同：有免密碼 sudo 的 Linux 用 `unix-user`，否則用 Codex sandbox，再不行用 bubblewrap。Arm B 的探測倉庫在確認公開 CLI 0.1.22 之後，呼叫與正式 Arm B 相同的 `write_session_write_config` 寫入 `.prereg-smoke/session-write.json`。沒有 claim 退路。`unix-user` 要等這份檔案寫完才把工作樹交給 steward，session 讀得到設定，但不能寫已追蹤檔。Arm B 必須經 steward 把 `atm-write` 叫成功，而且 capture 要從那次真實 stdout 抽出 patch：

```bash
bash research/paper-v2/prereg-v3-smoke/kit/preflight.sh
bash research/paper-v2/prereg-v3-smoke/kit/setup.sh
bash research/paper-v2/prereg-v3-smoke/kit/run_arm_a.sh
bash research/paper-v2/prereg-v3-smoke/kit/run_arm_b.sh
bash research/paper-v2/prereg-v3-smoke/kit/evaluate.sh
bash research/paper-v2/prereg-v3-smoke/kit/seal.sh --publish-index
```

`setup.sh` 每次使用新的 run-id，state 放在 `kit/state/runs/<run-id>/`。目錄已存在就中止，不會 `rm` 既有 state。要自己指定路徑時設定 `PREREG_SMOKE_STATE` 或 `PREREG_RUN_ID`，而且那個目錄必須還不存在。Django 模式會把 template 以 `pip install -e` 裝進 venv，先確認能 `import django` 並跑過一個最小測試。解譯器與測試相同：`PREREG_PYTHON`（可執行檔路徑），否則 CPython 3.8、3.9 或 3.10；都沒有就以 kit-error 結束，不改用系統 `python3`。離線 `pip install -e --no-build-isolation` 之前只確認 venv 裡有 setuptools（Django 3.2 不需要 wheel 套件），只用現成 wheel 或 pip 快取，且不安裝相依套件；拿不到就以 kit-error 結束。未套測試 patch 的 base 只跑各題可執行的 PASS_TO_PASS（`name (module.Class)` 會對成 `module.Class.name`；docstring id 用 `tasks.json` 的 `testIdNormalization` 對成同一個 Django label），並加上 `--parallel 1`。這組必須全過：退出碼 0、報告是 `OK`、沒有 `ERROR` 或 `errors=`。任何未預期的失敗、錯誤，或 runner 沒有印出 `Ran N test` 的完成報告，setup 都以非零退出。FAIL_TO_PASS 要等金標測試 patch 套上之後才預期失敗，setup 不跑那一組。

`evaluate.py` 對每個任務各做一份最終工作樹的複本，只套該任務自己的金標測試 patch。套用前會把 patch 碰到的每個路徑先處理：修改的檔案 checkout 回 base；patch 要新增的檔案（含目錄裡的新檔）直接刪掉，即使 base 上已經有那個檔，避免 `already exists`。結果分開記下 `resetTestPatchPaths`（被重置的路徑）與 `discardedModelTestFiles`（其中內容和 base 不同、被丟掉的模型修改）。接著只用 `git apply`，必須完全對上；對不上就是 kit-error，不用 fuzz。**DEVIATION D-11141-test-patch。** `gold/django__django-11141.test.patch` 是上游 SWE-bench 原檔，沒有改過，SHA256 `2368754a38055f10014bbcf18e23e95bbe26b0785de064f4fc561f6c3a03749f`。評估套的是另外的 `gold/django__django-11141.common-base.test.patch`，SHA256 `c87a6bde8ecd0c27257bee336f858434490becbe969c4ba104c269b212b8190d`。原因：共同 base `98ad327864aed8df245fd19ea9d2743279e11643` 已經有 `test_loading_namespace_package` 和 `tests/migrations/test_migrations_namespace_package/0001_initial.py`（11141 是這個 commit 的祖先），上游 hunk 假設該測試還不存在、而且 `0001_initial.py` 是新檔，所以 `git apply` 對不上。`tasks.json` 的 `testPatch` 指向 rebase 檔；`FAIL_TO_PASS` 與 `PASS_TO_PASS` 的測試 id 沒有改。套用後，被碰到的測試 `LoaderTests.test_loading_namespace_package` 與上游原檔套在該題自己的 base `5d9cf79baf07fc4aed7ad1b06990532a65378155` 之後的方法本文逐位元組相同，SHA256 `d4f185d9b25bf60db2ab78522a76cd016dc9f50baed8ae46dfeb03278177adda`。`0001_initial.py` 也逐位元組相同，SHA256 `a2e4d044ee2145198980a4f5fc7c3ac93522d3c71a6dbfd506656736705b49f9`，rebase 檔不改它。整個 `tests/migrations/test_loader.py` 不是逐位元組相同；差異只有官方 patch 沒碰到、共同 base 套用前就已經存在的三處：`test_load` 裡 `[x for x, y in author_state.fields]` 換成 `list(author_state.fields)`，以及同測試的 `["id", "author"]` 與 `test_load_unmigrated_dependency` 的 `["id", "user"]` 兩段多行斷言改成單行 `list(book_state.fields)`。離線測試會重做兩次 `git apply` 並鎖定這些位元組。Django 3.2 `--verbosity 2` 會把測試 id、docstring 與 `... ok` 拆行，失敗另印 `FAIL:` / `ERROR:`；解析器認這些格式，也把 docstring 那一行記成同一筆結果。`tasks.json` 的 `testIdNormalization` 把 docstring 形式的 SWE-bench id 對成 Django label，`deviation` 是 false，`FAIL_TO_PASS` 與 `PASS_TO_PASS` 字串不改。對不到 label、或任何一筆 id 沒被觀察到（含整組分母是 0），分數是 null，kit-error 讓該臂與整輪 status 成為 `invalid`。空的 FAIL_TO_PASS 與 PASS_TO_PASS 不是未觀察。`invalid` 優先於 `blocked`。`seal.sh` 看到 status `invalid` 才把索引列印成 INVALID。status 是 `blocked` 時，索引列寫出被擋住的臂，例如 `blocked (arm B)`，這是結果，不是 kit-error。`results.json` 會寫入 `tasks.json` 的 `testIdNormalization`，以及 `overlapCondition`（預先登記的冒煙記成 `none`）。Django 測試使用 `--parallel 1`。session 的 `stewardRejected` 依 steward 紀錄與命令紀錄決定。命令裡的失敗 `atm-write` 帶有標準 hunk 時，只在行範圍和該 session 的意圖 patch 重疊才算這支 session；對不上 hunk 就退回檔名，並把 `rejectionAttribution` 標成 `low`。紀錄沒有 session id，不能只看 taskId。

評估在計分、跑測試、寫 `final.diff` 之前，先把每個臂的工作樹凍成同一份快照 commit（`prereg evaluator snapshot`），包含未提交與未追蹤的任務檔，排除 `venv`、`.prereg-smoke`、`.atm`、`.agents`、`.codex`、`.aws`。遺失修改讀這份 commit 的 blob，測試複本 `checkout` 這份 HEAD，封存 diff 是 `base..` 這份快照。任務樹已經乾淨（v7 Arm B 就是這樣：變更已在 steward commit 裡，只剩 `.atm/` 與 `.prereg-smoke/`）也要做一個空的快照 commit，不能把 `snapshotCreated` 留成 false 再把該臂記成 `blocked`。`git status` 失敗，或快照 commit 寫不進去（例如 `.git` 不能寫），該臂是 `invalid`，kit-error 是 `evaluator-snapshot-failed`，整輪也是 `invalid`，不會留在 `blocked`，也不寫空的 `base..HEAD` diff。preflight 的離線測試讓 Arm A 留下未提交修改，並確認測試輸出與 `final.diff` 都看得到；收不進去就失敗。本來會被記成 blocked 的臂，只要快照寫不進去，結果也是 invalid。

`indexLockCount` 只計命令紀錄裡真正失敗、而且輸出含 `index.lock` 的 `git add` 或 `git commit`（Codex 0.163.0 的 `item.completed` / `command_execution`，以及 `exec_command_end`）。有命令紀錄但沒有這種失敗時是 0。完全沒有命令紀錄時才是 null。模型訊息裡的 index.lock 不算。

Codex 0.163.0 的命令是 `bash -lc`。login shell 會先讀 `/etc/profile`，那裡可以整段換掉 `env -i` 放進去的 PATH。v8 因此變成 `python: command not found`、`atm-write: command not found`，Arm B 的 git shim 也跟著消失，剩下的 `python3` 是系統 3.13 而不是評估 venv 的 3.10。launcher 把同一條 PATH 寫進 session `HOME` 的 `.bash_profile`（以及 `.profile` / `.bashrc`）和 `BASH_ENV`。`/etc/profile` 跑完之後，login shell 會把 PATH 設回來；非 login 的 bash 則讀 `BASH_ENV`。兩臂的 PATH 都有 `kit/bin`（`atm-write`）和評估 venv 的 `bin`。Arm B 的 `PREREG_ARM_BIN` 仍排最前，裡面的 `git` 是擋下 `commit` / `add` 的 shim。Arm A 的 `git` 是 `git-forward`，轉給真實 git，所以 Arm A 仍能自己提交。`PREFLIGHT_REAL_MODEL=1` 時，探測在呼叫模型之前用 `bash -lc` 檢查兩臂的 `command -v python`、`command -v atm-write` 與 `command -v git` 都解析到 kit；對不上就失敗。

先前公開 CLI 0.1.21 的 `broker steward apply-live` 在 patch 套完等於原檔時仍回 `accepted` / `ATM_BROKER_LIVE_WRITE_APPLIED`，不寫檔、不建 commit、也不寫 live-write journal（v8 Arm B `prop-prereg-session-a1-42f989d6ea50`，hunk 是裸 `@@`，新增行沒有 `+`）。`atm-write` 在 CLI 回 accepted 之後核對檔案雜湊變了、而且新 commit 的訊息含有該 proposalId。少一樣就改記 `kit-error` / `write-not-applied`，不再回 `ATM_BROKER_LIVE_WRITE_APPLIED`。這是 CLI 的缺陷，另外記在 issue，不在這次發布 npm。評估把 session stdout 裡的 proposalId 對上 steward log。accepted 但雜湊沒變不是 steward 拒絕，缺的行是沉默遺失。別的 session 對同一檔的拒絕不算到這支 session。`steward.rejected` 是拒絕筆數。`steward.resubmissions` 與 `recomposeOrRetry` 是同一個重送次數：同一支 session、同一個檔案，先前已有 steward 拒絕之後的 `atm-write` 才算；命令找不到與 kit-error 不是拒絕，第一筆拒絕本身也不算。沒有命令紀錄時是 null，不用拒絕筆數或全部寫入筆數代替。遺失修改在意圖 hunk 能 `git apply --reverse --check` 到最終快照時，`lostEditConfidence` 是 `hunk`。沒有標準 hunk、或行文字看得到但原 hunk 已經對不上（兩臂改到同一區時常這樣），標成 `low`，不把還在檔裡的行記成遺失。

`--publish-index` 只在 `research/paper-v2/EVIDENCE_INDEX.md` 追加一列。那一列的路徑是這次實際寫入的封存目錄（`--dest` 或預設目錄），不會改用別的日期路徑。`results.json` 的 status 是 `invalid` 時，那一列標成 INVALID。status 是 ok 時標成 smoke / exploratory、沒有勝出宣稱。索引檔不存在時會停，不會另建一份。

模型用環境變數 `CODEX_MODEL`。留空時不加 `--model`，讓已登入的免費 ChatGPT 帳戶使用它自己的預設模型。推理力度用 `CODEX_REASONING_EFFORT`，只能是 `minimal`、`low`、`medium` 或 `high`。未設定（或空字串）時兩臂都不加 `-c model_reasoning_effort="<值>"`；設了其他值就中止，不啟動工作階段。設了合法值時，兩臂的 `codex exec` 都加上同一條 `-c model_reasoning_effort="<值>"`。腳本把模型名稱寫進各臂 `model.txt` 的第一行，第二行是 `reasoning_effort=`。`evaluate.py` 把這兩欄寫進 `results.json` 各臂的 `model` 與 `reasoningEffort`。兩臂用同一組旗標。

## 免費額度停止規則

任一工作階段的 stdout 或 stderr 出現 usage limit、rate limit、quota、HTTP 429 這類字樣時，該臂寫下 `QUOTA_STOP` 並以退出碼 75 結束。不要重試、不要換付費模型、不要再跑另一臂。把已有的 log 照樣 `evaluate.sh` 與 `seal.sh`，並在 issue #311 寫明停在哪一臂。

## Arm B：什麼是強制的，什麼只是指示

| 層 | 行為 |
|---|---|
| 指示 | 提示詞要求只能用 PATH 上的 `atm-write <file> <patch>`。退出碼 3 是 steward 拒絕：stdout 的 JSON 帶 `currentFileText` 與 `reasonCode`。代理要依那個檔案狀態重寫 diff，最多再送 3 次，每次都留下紀錄。重試後仍沒做完必須標成 BLOCKED，不能當成成功。 |
| 強制（Linux，有 sudo） | 工作樹屬於 `prereg-steward`，模式是擁有者可寫、其他人唯讀。模型行程以 `prereg-session` 執行，不是擁有者，所以 `chmod` 改不回來，`mv` / 直接寫入也會失敗。session 沒有 sudo。寫入只走一支由 steward 身份聽的 Unix socket；`atm-write` 把 patch 送過去，steward 再呼叫公開 CLI。socket 目錄不是 session 可寫的，不能被換掉。內層 `codex exec` 使用 `--sandbox workspace-write` 與 `sandbox_workspace_write.network_access=true`，否則 Unix socket `connect` 得到 EPERM。儲存庫唯讀仍由擁有者邊界強制，不靠 `--sandbox read-only`。session PATH 兩臂都包含 `kit/bin` 與評估 venv 的 `bin`，`PREREG_ARM_BIN` 排在最前（Arm B 是 git shim，Arm A 是 git-forward）。login shell 會讀 `HOME/.bash_profile` 與 `BASH_ENV`，所以 `bash -lc` 清掉 PATH 之後仍找得到。兩臂都把評估 venv 的 `bin`（`PREREG_PYTHON` 所在目錄，不解析 symlink）放上 PATH，session 與評估用同一支 Python。venv 只補其他人的讀與執行，不開放寫入。提示詞寫的是 `kit/bin/atm-write` 的絕對路徑。Codex 0.163.0 的命令執行器在啟動時會於工作目錄建立 `.agents`；目錄屬於 steward 時這個 mkdir 得到 Permission denied，命令還沒跑就失敗。套件預先建立 `.agents`、`.codex`、`.aws`，擁有者是 `prereg-session`（mode 700），並寫進 `.git/info/exclude`。`.git` 與已追蹤檔案仍屬於 steward，所以直接寫入、`chmod`、`mv`、`rm` 仍然失敗。評估略過這三個目錄。 | |
| 強制（Linux，沒有 sudo） | 邊界模式是 `codex-landlock` 或 `bwrap-ro`，寫進 `arm-b/boundary.txt`、`arm-b/meta.txt`、`session-write.json` 與 `results.json`。steward 在沙盒外，以一般使用者執行。Arm A 不套這層沙盒，只保留 `env -i` 的金標隔離。優先機制是 Codex CLI 自己的 sandbox，不呼叫模型：`CODEX_HOME` 指向一份暫時設定，內容是 `[permissions.prereg-session] extends = ":workspace"` 加上 `[permissions.prereg-session.network] enabled = true`，然後執行 `codex sandbox -P prereg-session -C <scratch> -- <cmd>`。`<scratch>` 是短目錄 `/tmp/prereg-sbx.*`（`arm-b/scratch` 只是指過去的符號連結）。工作樹 `arm-b/work` 不在 `/tmp`，也不在 scratch 裡面。Unix socket 路徑含結尾 NUL 不能超過 108，所以 socket 放在這個短 scratch，不放在 state 目錄裡。工作階段目錄另列成 filesystem write。profile 打開 network 之後，沙盒裡的行程才連得到那支 socket。真實的 `codex exec`（會呼叫模型的那一層）就是這個外層沙盒的子行程，和 preflight 探測用的是同一條 `codex sandbox -P prereg-session` 或同一條 bwrap。launcher 把旗標釘成 `--ignore-user-config --ignore-rules -c approval_policy="never"`，不讀使用者的 `config.toml`，也不加 `--full-auto` 或 `--dangerously-bypass-approvals-and-sandbox`。兩臂的 `codex exec` 都另外拿到一份可寫的 `CODEX_HOME`：只從 `~/.codex/auth.json` 複製 ChatGPT 登入檔（不複製 `config.toml`，內容不印出）。這個目錄在 `/tmp/prereg-sbx.*/codex-home.*`，Arm B 沙盒則放在 scratch 裡的 `codex-home.*`，mode 700。它不在 session 或 state 樹裡。`XDG_RUNTIME_DIR` 指向其中的 `runtime`，`tmp` 也在同一目錄。工作階段結束就刪掉。`--ignore-user-config` 不略過這個登入。外層沙盒用的 profile 目錄是另一個暫時的 `CODEX_HOME`，裡面沒有登入檔。preflight 在同一個沙盒裡確認登入檔讀得到、工作階段狀態寫得進去，而且不呼叫模型。`seal.sh` 只複製允許清單裡的日誌與 diff，不複製整個 session；封存前掃描登入檔名、token 欄位、JWT 形狀與金鑰前綴，對上就刪掉未完成的封存並中止。`--publish-index` 只在 `EVIDENCE_INDEX.md` 追加剛好一列，不為每一次執行另開小節。`capture_intended_patch` 先把 stdout.jsonl 的事件解析成文字，再找 `BEGIN_INTENDED_PATCH`；JSONL 裡的換行是跳脫字，不能在原始檔上直接搜尋。 |內層另釘 `--sandbox workspace-write` 與 `sandbox_workspace_write.network_access=true`，只為了讓模型的 shell 連得到 socket；儲存庫唯讀是外層沙盒在強制。模型若自己再加上 bypass、把 sandbox 改成 `danger-full-access`、或寫一份要求審批升級的設定，外層沙盒仍會讓寫入得到 `EROFS`。preflight 會把 launcher 實際組出來的整條命令和當下選到的模式對上。若 `codex sandbox` 起不來（例如沒有 bubblewrap），改用這個確實的指令：`bwrap --unshare-user --unshare-pid --die-with-parent --ro-bind / / --bind <scratch> <scratch> --bind <scratch>/daemon-bind /tmp/codex-daemon-<uid> --bind <session> <session> --ro-bind <repo> <repo> --dev /dev --proc /proc --cap-drop ALL -- <cmd>`。Codex 0.159.2 的 app-server socket 固定在 `/tmp/codex-daemon-<uid>`，必須是目前使用者擁有且 mode 0700；它不看 `XDG_RUNTIME_DIR` 或 `CODEX_HOME`。`--ro-bind / /` 會讓宿主上的那個目錄變成唯讀，既有目錄若不是 0700，內層 sandbox helper 會失敗。所以 bwrap 另外把 scratch 裡 mode 0700 的 `daemon-bind` 掛上去，沙盒裡看得到可寫的 0700 目錄。後面的 `--ro-bind <repo>` 蓋過前面的可寫掛載。不用單獨的 `unshare`：使用者命名空間裡的 root 可以把唯讀掛載 remount 成可寫。Codex 的 `:workspace` 仍把整個 `/tmp` 當成可寫根；bubblewrap 只放開 scratch、那個 socket 目錄與工作階段目錄。兩種機制都不讓 session 寫工作樹。 |
| 強制（Windows / macOS 退路） | 建不起系統使用者時，Codex Arm B 加上 `--sandbox read-only`。steward 在沙盒外。Arm A 仍是 `workspace-write`，並把該工作樹的 `.git` 放進 `writable_roots`，`network_access` 維持 false。 |
| 強制 | `atm-write` 用 `readlink -f` 找到套件內的 `atm-write.mjs`。session 環境有 `PREREG_STEWARD_SOCK` 時它只當 socket 客戶端；steward 行程才呼叫公開 CLI 0.1.22 的 `broker steward apply-live`，一次一筆，不先算合併計畫。CLI 缺失或版本不是 0.1.22 時，Arm B 在工作階段開始前中止，沒有 claim 退路。 |
| 強制 | Arm B 的 `PATH` 把 `git` 換成拒絕 `commit`、`add`、`apply`、`checkout`、`reset`、`merge`、`rebase`、`stash` 的 shim。直接 `git commit` 退出碼 86。Arm A 的 `git` 是 `git-forward`，轉給真實 git。 |
| 隔離 | 工作階段以 `env -i` 與允許清單啟動。`PREREG_GOLD_PATCH`、`GOLD_ROOT` 與金標檔路徑不會進入環境或 workspace。金標只在工作階段結束後由 `evaluate.py` 使用。 |
| 偵測 | launcher 把工作階段的 unified diff 收成 `session/intended.patch`。缺少這份證據時 `evaluate.py` 以狀態 `evidence_missing` 非 0 退出，遺失修改數是 null，不會記成 0。Django 測試用 `--verbosity 2`，依每一列 `... ok` / `FAIL` / `ERROR` 計數。 |
| 重疊 | 第一筆 base 相符的寫入立刻提交。宣告的 base 依序取 `--base-file`、同一 actor（含 slot）對同一檔案上次收到的 `atm-write` 回覆雜湊、工作階段啟動 commit 的檔案雜湊，不再用 patch 猜版本。接受與拒絕的回覆都記進 `session-seen.jsonl`；都沒有就回 `base-unknown`、目前內容與退出碼 3，不呼叫 CLI。過期 base 交由公開 CLI 判定；只有 `overlapping-write-queued` 保留 `ATM_BROKER_LIVE_WRITE_QUEUED` 訊息碼，其他拒絕的 `messageCode` 是 null。工作階段依回傳內容重寫後再送。不相交的寫入仍會套上，語意合併不保證。套件或 CLI 崩潰是 `kit-error`，整輪狀態是 `invalid`；拒絕後任務仍沒做完則是 `blocked`。 |

## 另外的條件：強制同一區域（不是預先登記的冒煙）

預先登記的冒煙不設定 `PREREG_OVERLAP_CONDITION`，`results.json` 的 `overlapCondition` 記成 `none`。session 1 仍是 13820，session 2 仍是 11141，提示詞不追加任務。要在未來一輪強迫兩支 session 改同一個 `django/db/migrations/loader.py` 區域時，才設 `PREREG_OVERLAP_CONDITION=same-loader-region`。兩支提示詞都會加上 lines 88-102 的同一份指定，`results.json` 的 `overlapCondition` 會是 `same-loader-region`。那一輪要單獨封存、單獨解讀，不能併進預先登記的冒煙，也不能當成勝出證據。

## 在 #311 要回報的內容

- PR 連結。
- 兩個 instance id 與共同 base。
- 各臂遺失寫入數、衝突或 index.lock 數、steward 拒絕數、FAIL_TO_PASS / PASS_TO_PASS 通過數。
- 模型名稱、`CODEX_REASONING_EFFORT`（未設定就寫未設定）、Codex 版本、是否觸發免費額度停止。
- 任何反例（包含 Arm B 仍遺失寫入）照實寫，不要寫成勝出。


### Evidence completeness and preflight archives

Token fields are measurements: absent `total_tokens` stays JSON `null`, even when
input and output counts exist. Explicit zero remains zero. Cached input and
reasoning output counts are retained when reported. Aggregates with a missing
contribution remain `null`; the kit does not estimate totals.

Steward rejection is reported separately in `steward.rejected` and
`steward.reasonCodes`. `conflictCount` counts journal-observed cross-session overlap rejections,
acknowledged overrides, accepted overwrites, and failed Git index-lock commands.
Declared/live hash equality does not exclude contention. Absent observations stay
`null`. Accepted lines missing at the final snapshot are losses even after a prior
rejection; journal provenance names the accepting and removing proposals. A loss
is silent only when the losing session received no rejection/conflict report.
Attempts are derived per session/file from overlapping rejected submissions;
`steward.retryCount` equals `steward.resubmissions` (one per retried submission).
Unmeasured hash drift, index-lock wait and head moves stay `null`. Malformed and
no-op patches are model rejections. A valid patch falsely accepted without a
commit, missing CLI, crash or infrastructure failure remains a kit error and
makes the run INVALID.

Generation `cli-0.1.22-v12d-367` is recorded under `generations/` with content hashes.
It is a new immutable generation; existing sealed v10c evidence/results stand.
To materialize it later, check out the commit introducing its manifest and verify
its file hashes before running. Never overwrite an existing generation or sealed
results. A historical re-score must have a fresh destination and provenance that
identifies both the sealed input and scorer generation. This change does not
re-score v10c and makes no win claim.

The overlap suite runs `PREREG_STUB_WRITE_MODE=explicit` and `real`. Real mode
uses process substitution, without `--base-file` or `--attempt`.

Each session supplies `PREREG_SESSION_SLOT`. The writer includes the slot in its
actor/proposal identity and `sessionSlot` record, including socket requests.
Probe slots include arm and attempt. An absent slot on a standalone legacy
invocation remains explicitly unrecorded, rather than borrowing a daemon slot.

For a new run, set `PREREG_PREFLIGHT_LOG_ROOT` to a dedicated directory and keep
that setting for preflight and seal. The default is `kit/state/preflight`; all
retained `run-*` directories in that root are included, so a dedicated root
keeps unrelated preflights separate. Preflight creates a fresh directory with
`retry-policy.json`, its log, and per-arm/per-attempt evidence. Temporary probe
worktrees can be cleaned after those allowlisted logs are retained. Seal copies
only explicit evidence names, applies the existing credential rejection, and hashes
the archived files. Homes, login files and sockets are excluded. Old archives,
including v9, are never updated by this workflow.

Offline checks: `test_metrics_evidence.py`, `test-session-slot.sh`, and
`test-preflight-archive.sh`. The archive test retains diagnostics on failure;
`KEEP_TMP=1 bash -x test/test-preflight-archive.sh` also retains successful runs.
No real model or formal A/B run is needed for these checks.

## 2026-10-23 approved condition (#367)

CLI 0.1.22; generation `cli-0.1.22-v12d-367`. Synthetic scorer conflicts must equal exactly 1 (PR #392 follow-up). Prior manifests and sealed v10c remain unchanged.
Set TMPDIR and PREREG_TEMP_ROOT to dedicated directories inside the clone; scratch cleanup is limited to newly created directories there. Keep these settings for preflight, both arms and evaluation. The default paths remain compatible with previous hosts.
See `research/paper-v2/prereg-v3-conditions/2026-10-23-cli0122-smoke.md` for the preregistered exploratory comparison; no win claim.

Version checks prefer a verified npm-package runtimeBuildIdentity.version. A present unverified identity fails closed; legacy fixtures/releases without that field retain the legacy handshake. The initial v12 manifest is preserved but was stopped in offline preflight by the legacy host-version field; v12b is the runnable successor. Neither has real-run evidence yet.

Successor v12c explicitly marks PREREG_SANDBOX_REPO read-only in the no-sudo profile, even when scratch is inside an ancestor Git checkout. Both Unix-user and codex-landlock probes must still pass. v12 and v12b manifests are retained as stopped offline preparations; only v12c is selected for this real smoke. Use a short clone-local TMPDIR (for example clone/t) to stay within Unix socket limits.

Runnable successor v12d initializes an isolated Git root for each temporary scorer patch check, preventing ancestor-repository path filtering from silently skipping the patch. The disposition and exact-conflict scorer regressions pass with clone-local TMPDIR. v12c remains an unchanged stopped offline preparation.

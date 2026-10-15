# prereg-v3 可行性檢查：同一台 VM 上的並行無頭程式代理

> **可行性，不是結果。** 這份紀錄只回答「這台 cloud VM 現在能不能啟動兩個以上的無頭程式代理行程，讓它們同時改同一個本地 git 儲存庫」。它不是預先登記、不是實驗 run、不是論文結果，也不宣稱勝出。沒有建立對照臂，沒有量遺失更新。

檢查封存時間：2026-10-15T11:41:28Z（Asia/Taipei 19:41:28）。平台：Linux x86_64。`node` 為 v22.14.0；nvm 另有 v22.23.3。

## 問題

計畫中的 ATM 論文 2.0 真實代理研究（prereg-v3 草稿）想在同一台機器、同一個儲存庫上，平行跑「沒有 ATM」與「有 ATM」的程式代理工作階段。這次只檢查那件事在這台 VM 上是否做得到。

## CLI

開始時 `PATH` 裡沒有 `cursor-agent`、`agent`、`cursor`、`claude`、`codex`、`atm`。網路可連到各官方安裝位址。三個安裝程序同時啟動，牆鐘約 11.6 秒，都成功。安裝只寫入 VM 使用者目錄，沒有進這個 git 儲存庫。

| CLI | 安裝後版本 | 無頭入口 | 非互動認證 |
|---|---|---|---|
| `cursor-agent`（同捆 `agent`） | `2026.10.14-941492e` | `cursor-agent -p` | 失敗。狀態 `unauthenticated`。單次探測要求先 `agent login`，或設定 `CURSOR_API_KEY` |
| `claude`（Claude Code） | `2.1.292` | `claude -p` | 失敗。`claude auth status` 為 `loggedIn: false`。單次探測：`Not logged in · Please run /login` |
| `codex` | `codex-cli 0.162.1` | `codex exec` | 失敗。`codex login status` 為 `Not logged in`。單次探測對 OpenAI API 得到 HTTP 401，訊息是缺少 bearer 或 basic 認證 |

下列環境變數名稱當時都沒有值：`CURSOR_API_KEY`、`CURSOR_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`CLAUDE_API_KEY`、`OPENAI_API_KEY`、`CODEX_API_KEY`。沒有讀取、列印或帶走任何密文。`cursor-agent status`、`claude auth status`、`codex login status` 都由各 CLI 自己回報未登入。

## 並行工作階段與示範

沒有執行並行編輯示範。三個 CLI 都在認證步驟停下，沒有進入會改檔的模型回合，所以沒有建立暫存 git 儲存庫，沒有兩份不同的函式修改指令，沒有開始與結束之外的編輯時間戳，沒有最終檔案，也沒有「哪一次編輯遺失」可以記錄。

可以分開記錄的只有行程層：作業系統能同時跑多個程序（三個安裝程序同時完成）。這不表示兩個已登入的程式代理能同時改同一個檔案。

失敗的單次探測是平行啟動的，牆鐘約 15.3 秒。Cursor 與 Claude 立刻以認證錯誤退出。Codex 在 2026-10-15T11:38:47Z 開始對 API 重試，約佔滿這段牆鐘，最後仍是 401。三個探測的退出碼都是 1。沒有任何完成的模型回合，所以沒有可見的 token 用量。這 15.3 秒是失敗探測的時間，不是一次編輯的成本。

Codex 另外警告系統上沒有 `bwrap`（`command -v bwrap` 為找不到），並說會改用內建 bubblewrap。這次沒有進到寫檔，所以沒有檢查那個沙箱能不能改同一個儲存庫。

## ATM CLI

兩種入口都在這台 VM 上執行過版本指令。沒有任何程式代理工作階段去呼叫它們，因為那些工作階段沒有啟動。

| 入口 | 觀察 |
|---|---|
| 本儲存庫 `node atm.mjs --version` | 退出碼 0。`frameworkVersion` 0.1.2。凍結 onefile runner |
| 本儲存庫根目錄 `node atm.mjs welcome --json` | 退出碼 0。`frameworkVersion` 0.1.2 |
| 本儲存庫根目錄 `node atm.mjs doctor --json` | 退出碼 0，`ok: true`。警告：`ATM_RUNNER_SOURCE_DRIFT`（凍結 runner 的 source seal 與套件來源不一致）、`ATM_PACKAGE_DIST_MISSING`（27 個 workspace 套件沒有 `dist`）。建議動作是 `node atm.mjs next --json`。這次沒有 build、沒有 tag、沒有發布 npm |
| 在 `/tmp` 執行 `node /workspace/atm.mjs welcome --json` | 退出碼 2。`ATM_CHART_MISSING`。尚未 bootstrap、沒有 ATMChart 的目錄不能直接 welcome |
| 公開套件 `@ai-atomic-framework/cli@0.1.20` | `npm view` 看得到，bin 名稱是 `atm`。裝到暫存 prefix 後，`atm --version` 退出碼 0，`frameworkVersion` 0.1.20，`runnerMode` 為 `npm-package`。沒有改這個儲存庫的版本，也沒有發布 |

本儲存庫 `package.json` 的 `engines.node` 是 `>=24`。上面的版本指令是在 Node v22.14.0 上退出碼 0。這只代表版本指令跑得起來，不代表整套測試在 Node 22 上通過。預設 `PATH` 沒有 `atm`；公開套件的 bin 要裝進 prefix 之後才出現。

## 阻斷

1. 這台 VM 沒有上述 CLI 會接受的非互動憑證。三個 CLI 都安裝成功，也都拒絕未登入的無頭呼叫。
2. 因此無法在這台機器上啟動兩個會改同一個本地 git 儲存庫的程式代理工作階段，也無法觀察遺失更新或 token 成本。
3. 代理工作階段沒有啟動，所以「那些工作階段使用 ATM」這件事沒有被觀察到。ATM CLI 本身可以在這台 VM 上安裝並執行版本指令。
4. 若之後要在一個新的暫存儲存庫裡用本 repo 的 `node atm.mjs welcome`，該目錄需要先有 ATMChart。doctor 的 drift 與缺 `dist` 警告仍在；這次依照範圍沒有 build。

## 驗證

```bash
sh research/paper-v2/prereg-v3-feasibility/2026-10-15/verify.sh
```

`verify.sh` 只讀。指紋不含 `SHA256SUMS` 自己。

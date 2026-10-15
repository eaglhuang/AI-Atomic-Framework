# HIST-v3（探索性）預先登記草稿：寫入前准入能否避開寫入後的解衝突成本

狀態：**草稿，尚未凍結，也還沒經作者批准**。HIST-v2 prereg v2.0 維持凍結，本文件不修改它。
本草稿寫於 2026-10-15，用來接續 HIST-v2 pilot 的發現：在可合併題目上，ATM 和 textual_merge_file 結果相同。

## 0. 一句話
在同一台機器、同一個 repo、多個代理並行寫入的情境下，比較三條臂：
- ATM：寫入前准入，排隊寫，寫完立即 commit。
- 一般 git 流程：各開 worktree 或 branch，寫完再 merge。
- file_lock。

量的是 commit／合併時碰到的衝突，以及解這些衝突的成本，而不是只看「最後合不合得進去」。

## 1. 範圍
這是刻意畫下的範圍邊界。主張只到這條邊界為止，不超出它。

- **納入**：同一台機器、同一個 repo 裡，多個代理（不同行程或對話）並行寫入。ATM 只在這個範圍內避免代理彼此的衝突。原因是它的 CAS、鎖和佇列都在本機的 `.atm/runtime/`。
- **不納入，也不主張能防止**：外部 git 衝突。別台機器的 push、其他 clone，以及遠端 PR，都不在這套本機機制能擋住的範圍。這些仍然走一般的 git merge 或 rebase。§11 只記錄 push 前的 broker 檢查，那是程式現況，不是超出這條邊界的主張。
- **不主張語意等價**：ATM 不保證合併後的語意和各代理原意一樣，人類也做不到。語意層的結果只描述，不當成 ATM 的勝負指標。

## 限制（Limitations）
ATM 只避免同一台機器、同一個 repo 裡，代理彼此之間的衝突。CAS、鎖和佇列都放在本機 `.atm/runtime/`，所以效力只到這台機器上的這個工作目錄。

它不能避免外部 git 衝突。別台機器的 push、其他 clone，或遠端 PR，都不會被這套本機機制擋住。那些衝突仍依一般 git 的 merge 或 rebase 來解。

§11 寫的 push 前檢查，是在推送當下對同名遠端分支做一次快照。那不是本主張的一部分，也不能拿來主張 ATM 防止了外部 git 衝突。

這是刻意的範圍邊界。本草稿不主張 ATM 能處理這條邊界以外的衝突。

## 2. 主張（假設）
- **H1（成本）**：與 git 流程相比，ATM 在 commit 或合併時需要的人工或代理解衝突次數較少，總解衝突成本（時間、token、重做次數、人工介入）較低。
- **H2（窗口）**：寫入到 commit 的窗口越長，commit 時的衝突率越高。在 ATM 臂內把窗口拉長，衝突率應該上升。這用來檢驗「ATM 縮短窗口」這個機制的解釋。
- **H3（部分寫入）**：多檔提案在 ATM 下只會整份進或整份不進。git 流程和 file_lock 下可能只寫進一部分。
- **描述性（非主張）**：合併後 build 或 test 失敗率。Brun 2011 §4.2 發現，VCS 回報為乾淨的 399 次 merge 中有 33% 其實是 build 或 test 衝突。本研究只報告各臂的比例，不預設方向。

## 3. 臂
| 臂 | 流程 | 衝突在何時被發現 |
|---|---|---|
| atm | broker 准入 → steward 合成 → canonical commit（base-hash CAS 加原子 rename）→ 立即 `atm git commit`（branch commit queue lock 加 HEAD 檢查） | 寫入前（re-compose 或 blocked） |
| git_worktree | 每個代理一個 worktree 或 branch，各自寫完並 commit，最後依序 `git merge`（三方）回主分支 | 合併時 |
| file_lock | 寫入前取檔案鎖，在鎖內套 hunk，不做三方合併（沿用 HIST-v2 定義） | 取鎖時（等待） |

git_worktree 用來代表 Claude Code worktree、CAID 等常見作法；它和 HIST-v2 的 textual_merge_file 不同，要把「之後解衝突」的成本算進去。

## 4. 指標（主要 → 次要）
1. **commit／合併時衝突率**：分母是嘗試整合的提案數。各臂都要定義「衝突事件」：atm 是 re-compose、HEAD_MOVED、BRANCH_QUEUE_RACE；git 是 merge 衝突；file_lock 是等鎖逾時。
2. **解衝突成本**（每個衝突事件、每個提案都記）：
   - 牆鐘時間；
   - 代理 token（只在真實代理階段記）；
   - 重做次數（re-compose、rebase 或重寫）；
   - 人工介入次數。程式化階段改用「需要人工裁決」的旗標代替。
3. **白做的工作**：最後沒有進主分支的寫入量（行數或 token），加上後來被覆寫的量。
4. **寫入到 commit 的窗口**：每個提案記 `t_write_done` 到 `t_commit_published` 的時間。ATM 臂另外做**窗口掃描**，在寫入和 commit 之間注入人工延遲，例如 0、1、5、30、120 秒，畫出衝突率對窗口的曲線（檢驗 H2）。git 臂的窗口自然記錄即可。
5. **合併後 build／test 破壞率**：每次整合後跑該 repo 的 build 和測試。分開報告「文字乾淨但測試壞了」的比例。
6. **多檔部分寫入**：多檔提案只有部分檔案落地的次數。

所有指標都按臂、題型、並行度（2、4、8 個代理）分層。

## 5. 工作負載
- **階段 A（程式化）**：沿用 HIST-v2 的 29 題 dev 題目和重播資料，用 harness v3（已修正 base 套用 bug、已有抖動）。新增兩樣：
  - 多檔提案；
  - 刻意的過時讀取，代理拿舊版檔案產生修改。
  
  程式化寫手沒有 token 成本。成本只記時間、重做次數和人工裁決旗標。
- **階段 B（真實代理，另外批准）**：多個 AI 對話在同一台機器、同一個 repo 並行處理同一批任務，其中有刻意重疊的檔案。記錄 token、時間、重做次數和人工介入。這一階段要另外編預算，也要另外取得作者批准；pilot、main、held-out 各自需要批准（照既有規則）。

## 6. 分析
- 主要比較：atm 和 git_worktree 的衝突率、解衝突成本，給出差值和 95% CI（以題目為單位做 bootstrap）。file_lock 當參考臂。
- H2：在 ATM 臂內，用窗口長度對衝突率做 logistic 迴歸，並畫劑量反應曲線。
- 不宣稱勝出。任何遺失寫入或損毀都算反例，一律報告。
- 確認是 bug 影響的數據，不放進論文正文（照使用者 2026-10-15 的規則）。

## 7. 引用的外部證據（只作動機，不作本研究結果）
- AgenticFlict（arXiv:2604.03551）：代理 PR 對 base 的衝突率 27.67%（29,609 / 105,533，Table 1）。
- arXiv:2607.04697：共時代理 PR 配對中，同代理 19.8%（119/601）、跨代理 41.7%（48/115）。§6.2 自述**沒有量**成本。
- Campos Junior & Murta（SBES 2026）：衝突 merge 有 96.1% 由人類 commit（14,381 / 14,960）。
- Brun et al. 2011：merge 中 16% 到 17% 有文字衝突；399 次「乾淨」merge 中有 33% 是 build 或 test 衝突；衝突平均存在 9.8 天（中位數 1.6 天）。
- Brindescu et al.（EMSE）：19.32% 的 merge 衝突（6,979 / 36,122）。
- Vale et al.（TSE）：解衝突時間中位數 697 秒，Q3 為 6,372 秒。
- **沒有來源支持「大部分 PR 會衝突」，論文不得這樣寫。**

## 8. 威脅與限制
- 外部 git 衝突不在範圍內，見「限制（Limitations）」。本機 `.atm/runtime/` 裡的 CAS、鎖和佇列擋不住別台機器的 push、其他 clone 或遠端 PR；那些仍走一般的 git merge 或 rebase。§11 的 push 前檢查不把這條邊界往外推。本草稿不主張超出這條邊界。
- 程式化寫手不能代表真實代理的行為，階段 B 才能回答成本問題。
- 窗口注入延遲是人為操作，只能檢驗機制，不能代表自然分布。
- 語意正確性不在主張內。build 和測試只能部分代理語意。
- git_worktree 臂的「解衝突」在程式化階段沒有真正的解題者，只能記錄需要裁決的事件，所以成本會低估。

## 9. ATM 程式碼現況（2026-10-15 讀 main 的結果）
說明：以下行號是從 connector 取回的內容推算，可能差 1 到 2 行；函式名稱是準確的。

**已經有的部分**
- 寫入前准入，寫入只在准入之後發生：`packages/cli/src/commands/broker/shared-delivery-commit-transaction.ts`。
  - 第 1–20 行的檔頭註解寫明順序：plan/admit → seal → prove → move ref。
  - `runSharedDeliveryCommitTransaction` 先跑 `planSharedDeliveryCommit`，准入不過就不會寫任何 object 或 ref。
  - `applySealedSharedDeliveryCommit` 中只有 `git update-ref HEAD <new> <expected>` 會產生可觀察的效果，而且做 compare-and-swap。HEAD 已經被移動時，會丟出 `ATM_BROKER_BATCH_COMMIT_HEAD_MOVED`，要求重新排隊。
  - 這條路徑把「寫入」和「commit」合成同一個交易，**中間沒有工作樹窗口**，因為它直接用暫存 index、commit-tree 和 update-ref。
- steward 寫檔的鎖只包住 CAS 和 rename：`packages/core/src/broker/steward-commit-guard.ts`。
  - 約第 29–46 行是 `stewardCanonicalCommitPolicy`：lockWaitMs 2000、lockPollMs 5、maxRecomposeAttempts 4。
  - 約第 106–214 行是 `commitCanonicalFiles`：依路徑排序後，對所有目標檔取核心層建議鎖，比對 base hash，不符就回 re-compose。
  - 約第 265–280 行是 `replaceFileAtomically`：先寫同目錄暫存檔，再 rename。
  - 這裡的「commit」指**檔案層級**的 canonical commit，**不是 git commit**。
- steward 准入與重試：`packages/core/src/broker/steward.ts`，`applyStewardPlan` 約第 175–247 行。流程是 apply queue → 合成 → 交易式寫入；碰到 re-compose 時，帶 backoff 和 jitter 重試。
- 每個目標檔一條 apply queue：`packages/core/src/broker/steward-apply-queue.ts`，第 1–7 行註解寫明「佇列只決定先後，正確性仍靠鎖與 CAS」。
- git commit 的分支佇列鎖：`packages/cli/src/commands/git-governance/implementation/branch-commit-window.ts`。
  - `withBranchCommitQueueLock` 用 mkdir 作鎖，逾時 15 秒，重試間隔 200 毫秒，5 分鐘後自我修復過期的鎖。
  - `commit-execution.ts` 約第 100–140 行在鎖內重讀 HEAD。和取鎖時不同就丟出 `ATM_GIT_COMMIT_BRANCH_QUEUE_RACE`。
- 「關閉的任務必須先 durable commit，才能領下一題」：`packages/cli/src/commands/batch/checkpoint-commit-window-policy.ts`，`decideCheckpointContinuation`，全檔約 35 行。
  - 這是目前**唯一明確限制寫入到 commit 窗口**的政策，但做法是禁止在窗口未關閉時領下一題，不是限制窗口長度。
- taskflow close 的分支 commit 閘門：`packages/cli/src/commands/taskflow/branch-commit-queue-gate.ts`，`evaluateTaskflowBranchCommitQueueGate` 約第 65 行起。有記錄 `waitedMs`（約第 142 行），但那是**排隊等待時間**。
- task-scoped commit 交易：`packages/cli/src/commands/git-governance/task-scoped-commit-transaction.ts`，`executeTaskScopedCommitTransaction` 會先停放其他任務的 index 項目，commit 後再還原。

**沒有的部分**
- **沒有任何「寫入到 git commit 窗口長度」的量測或指標**。用 search_code 搜 `writeToCommit`、`commit window`、`commitLatency`、`write-to-commit`，結果都是 0 筆。
  - 現有的時間欄位只有 build 指令的 `durationMs` 和 `phaseTimingsMs`（`broker/batch-execute-actions.ts` 約第 435–437 行）、commit 的 `timeoutMs`，以及排隊的 `waitedMs`。
- **steward 的檔案寫入和 `atm git commit` 是分開的兩步**，沒有一個鎖同時包住兩者：
  - steward 的鎖在 rename 後就放掉；
  - 分支 commit 鎖要等 commit 時才取；
  - 中間只靠 checkpoint 政策和 HEAD 比對保護。
  - 例外是 shared-delivery 的 commit 介面，它本身就是單一交易。
- 沒有對窗口長度設上限或逾時，也沒有在窗口過長時主動提交或警告的機制。

**對使用者模型的判斷**：大方向成立。衝突在寫入前的准入和 CAS 階段處理，寫入計畫已經定案；寫入是原子 rename；commit 有佇列鎖和 HEAD 檢查。但「寫入後馬上 commit、窗口很短」目前**只是流程上的效果，沒有被量測，也沒有被強制**，只有 shared-delivery 路徑在結構上沒有窗口。所以本 prereg 的 H2 要先在 harness 裡加上窗口時間戳才能檢驗。

## 10. 執行前要先做的工具工作（不改 HIST-v2 凍結內容）
1. harness 每個提案都記錄 `t_admit`、`t_write_done`、`t_commit_published`。
2. ATM 臂加入可設定的寫入後延遲注入，用於窗口掃描。
3. 新增 git_worktree 臂：worktree 加三方 merge，並記錄衝突事件。
4. 整合後掛 build 和測試。
5. 加入多檔提案與過時讀取兩種題目產生器。
6. 本草稿要經作者批准、凍結並記入 EVIDENCE_INDEX 之後，才能跑 smoke 和 pilot。

## 11. 追加（2026-10-15 19:20）：ATM 的 push／PR 前檢查現況與範圍修訂

### 11.1 程式碼現況（main，透過 cursor-github 讀取；行號約略，誤差 ±2 行）
**有的部分**
- **push 前的准入**：`packages/cli/src/commands/git-governance/implementation/push-command.ts`，`runGitPush`（約 90–340 行）。
  - 先呼叫 `evaluateGitAdmission({... fetch: !options.noFetch ...})`（約 122–131 行）。
  - 准入結果不是 allow 或 no-op 時，回報「ATM git push blocked before host git push」，不會執行 push。
  - 准入通過後，才執行 `git push <remote> HEAD:<branch>`（約 241–246 行）。
- **抓取遠端**：`packages/core/src/git/diff-mutation-request.ts`，`collectGitDiffMutationRequests`（約 47–90 行）。
  - 預設會執行 `git fetch --quiet --no-tags <remote> <branch>`，可用 `--no-fetch` 關掉。
  - 接著跑 `git merge-base HEAD <remote>/<branch>`，再分別算本地和遠端相對 merge-base 的 diff。
- **broker 檢查**：`packages/core/src/git/admission.ts`，`evaluateGitAdmission`（約 63–190 行）。
  - 遠端的變更被建模成虛擬代理 `virtual:git-remote@<remoteSha>` 的 active intent，交給 `calculateBrokerDecision` 判斷。
  - 結果分成 `allow`、`block`、`composer-routed`、`no-op`、`internal-error`，並列出 `conflictingFiles`。
- **失敗後復原**：`runGitPostPushFailRecovery`（約 359 行起）會重新 fetch，判斷本地是落後還是分歧。
- **pre-push hook**：`packages/cli/src/commands/hook/pre-push.ts`，`resolvePushBase`（約 387–420 行）以 `@{upstream}` 作為 base。

**沒有的部分**
- **沒有自動 rebase**：程式只在建議文字中提到 rebase（`admission.ts` 約 422 行：「rebase, split the work, or rearbitrate before push」），不會自己執行。
- **沒有建立 PR 的程式**：用 search_code 搜 `"gh pr create"`、`"pulls"`、`"pull request"`（限 packages 下的 TypeScript），結果都是 0 筆。搜尋索引可能不完整，但讀過的檔案裡也沒看到。
- **准入比對的是同名遠端分支**（`<remote>/<branch>`），**不是 PR 的目標 base**（例如 main）。只有直接推 main 時，兩者才一樣。
- **沒有明確對遠端 ref 做 CAS**：沒有 `--force-with-lease`。repo 內唯一的命中在 research 文件，不在程式碼裡。
  - 唯一的保護是 git 預設會拒絕非快轉推送，這等於隱含的「遠端沒動才成功」。但 fetch／准入和 push 之間仍然有競爭窗口，程式沒有鎖住這段。

### 11.2 對範圍的影響
- 這個機制讓 ATM 在**推送前**，能偵測並擋下「遠端同名分支在 fetch 當下已有的重疊修改」。所以 ATM 對跨機器衝突**有部分前移偵測**，不是完全沒處理。
- 但它**不能防止**以下情況，論文不得主張防止：
  - fetch 之後才發生的遠端推送；
  - PR 目標分支（例如 main）上的後續變更；
  - PR 開出後才合入的其他 PR。

### 11.3 建議改寫 §1 範圍
> **主要範圍**：同一台機器、同一個 repo 內，不同代理並行寫入所產生的衝突。ATM 在寫入前准入，主張可避開這類衝突的寫入後解衝突成本。
> **次要（描述性）範圍**：推送到遠端前，ATM 會 fetch 同名遠端分支，並把遠端變更當成虛擬代理交給 broker 判斷。本研究可以描述這一步攔下的重疊數量，但只作描述，不列入主張。
> **不在範圍內**：fetch／准入之後才發生的遠端推送、PR 目標分支（base）的後續變更、PR 開出後的合併衝突。ATM 沒有自動 rebase、沒有建立 PR 的流程，也沒有對遠端 ref 的明確 CAS，所以這些衝突只能**降低機率，無法防止**。

### 11.4 建議加進 §8 威脅與限制
- ATM 推送前的准入是時間點快照：從 fetch 到 `git push` 之間，遠端仍可能前進。git 預設會拒絕非快轉推送，失敗後走 `recover-push-fail` 流程重新准入，但這段重試成本本研究不量。
- 准入比對的是同名遠端分支，不是 PR 目標分支。所以「PR 開出後與 main 衝突」的機率，ATM 沒有直接處理。外部文獻中的 PR 衝突率（AgenticFlict 27.67%、2607.04697 的 19.8%／41.7%）都屬於這一類，**不能拿來當 ATM 的效果**。
- 若日後加入「以 PR 目標 base 為對象的 fetch 加 rebase 加准入」或「`--force-with-lease`」，需要另開預先登記來評估，不能沿用本研究的結論。

### 11.5 可選的探索性子實驗（不列入主張）
在本機建一個 bare repo 當作 remote，模擬「另一台機器」在 ATM fetch 之後的 Δt 秒推送，Δt 依序設為 0、1、5、30 秒。量測：
- ATM 准入攔下的比例；
- 推送被非快轉拒絕的比例；
- 需要 recover 的比例。

這只用來描述殘餘風險，需要另外經作者批准。

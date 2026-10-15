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

- **納入**：同一台機器、同一個 repo 裡，多個代理（不同行程或對話）並行寫入。ATM 只處理這一種衝突。原因是它的 CAS、鎖和佇列都在本機的 `.atm/runtime/`。
- **不納入**：外部 git 衝突。別台機器的 push、其他 clone，以及遠端 PR，都不在 ATM 能擋住的範圍。這些仍然走一般的 git merge 或 rebase。
- **不主張語意等價**：ATM 不保證合併後的語意和各代理原意一樣，人類也做不到。語意層的結果只描述，不當成 ATM 的勝負指標。

## 限制（Limitations）
ATM 只避免同一台機器、同一個 repo 裡，代理彼此之間的衝突。CAS、鎖和佇列都放在本機 `.atm/runtime/`，所以效力只到這台機器上的這個工作目錄。

它不能避免外部 git 衝突。別台機器的 push、其他 clone，或遠端 PR，都不會被這套本機機制擋住。那些衝突仍依一般 git 的 merge 或 rebase 來解。

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
- 外部 git 衝突不在範圍內，見「限制（Limitations）」。本機 `.atm/runtime/` 裡的 CAS、鎖和佇列擋不住別台機器的 push、其他 clone 或遠端 PR；那些仍走一般的 git merge 或 rebase。本草稿不主張超出這條邊界。
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

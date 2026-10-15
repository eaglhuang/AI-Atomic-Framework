# HIST-v3 預先登記草稿：真實 AI 代理並行寫入，比較有無 ATM

**狀態**：草稿，尚未凍結，也還沒經作者批准。HIST-v2 prereg v2.0 維持凍結，本文件不修改它。
**版本**：2026-10-15 第二版（以真實代理研究為主）。前一版的程式化研究、證據整理與程式碼發現都保留在附錄 A–C。

---

## 1. 研究問題
同一台機器、同一個 repo 裡，讓多個**真實 AI 代理工作階段**（不同行程或不同對話）並行寫入，而且任務刻意設計成會互相衝突。比較兩種情況：

1. 照一般人的作法開發，不用 ATM；
2. 同一批代理、同一批任務，但裝上 ATM，所有寫入都經過 broker／steward。

我們要回答：在沒有 ATM 時，會出現多少**看得見、數得出來**的遺失寫入、損毀、合併衝突與解衝突成本；裝上 ATM 後，這些數字改變多少，代價又是什麼。

## 2. 範圍與不主張
- **範圍**：同一台機器、同一個 repo、多個並行的代理工作階段。
- **不在範圍內**：跨機器的遠端衝突。ATM 只在推送前 fetch 同名遠端分支並准入，沒有自動 rebase，也沒有對遠端 ref 的 CAS（見附錄 C）。PR 開出後與目標分支的衝突也不在範圍內。
- **刻意邊界**：上面這條範圍成立，是因為 CAS、鎖和佇列都在本機 `.atm/runtime/`。別台機器的 push、其他 clone，以及遠端 PR，仍走一般的 git merge 或 rebase。不主張超出這條邊界。
- **不主張語意等價**：ATM 不保證合併後的語意和各代理原意相同，人類也做不到。語意相關的結果只靠測試通過率**描述**。
- **不預先宣稱勝出**：任何 ATM 的反例（遺失寫入、損毀、錯誤放行）都要報告。

## 3. 條件（臂）
| 臂 | 名稱 | 設定 | 代表的真實作法 |
|---|---|---|---|
| B-shared | 無 ATM／共用工作樹 | 所有代理在**同一個工作樹**直接編輯，不隔離、不加鎖；各自決定何時 `git add`／`commit` | 最常見、最天真的多代理作法 |
| B-wt | 無 ATM／各自 worktree | 每個代理一個 `git worktree` 加 branch；全部結束後，由**整合者**依預先固定的順序 `git merge` 回主分支；遇到衝突就照 §6.4 的協定解 | Claude Code worktree、CAID 等隔離作法 |
| ATM | 有 ATM | 同一個共用工作樹，但裝好 ATM；代理只能透過 ATM 的 broker／steward 和 `atm git commit` 寫入與提交；raw git 寫入照 ATM 既有政策封鎖 | 本研究要評估的處理組 |

- B-shared 和 B-wt 都是誠實的基準線，主要比較是 **ATM 對 B-wt**，B-shared 當成「完全不協調」的參考。
- 三臂使用相同的模型、相同的任務提示（ATM 臂只多一段固定的「ATM 使用說明」，見 §5.2）、相同的工作階段數與啟動錯開時間。

## 4. 任務組（必須來自公開、可信的 GitHub benchmark）

### 4.1 原則
- **任務一律取自公開 benchmark 的真實實例**，例如 issue 加 gold patch 加測試；這些 benchmark 原本是為測代理能力而設計也沒關係。
- **專用 repo 只能用於 smoke**，不能用在 pilot、main 或 held-out。
- **挑選方法**：在同一個 repo 裡，找出 gold patch 修改**重疊或相鄰**的檔案、函式或區域的實例配對（或 k 個一組），把它們同時派給並行的工作階段，讓衝突自然發生。不另外改寫任務內容。
- 優先選有測試、有現成評估 harness 的 benchmark，並記錄授權。

### 4.2 衝突分類（由 gold patch 自動判定，再人工確認）
| 代碼 | 類別 | 從 gold patch 判定的規則 |
|---|---|---|
| T1 | 同區域重疊 | 同一檔，hunk 行範圍重疊 |
| T2 | 相鄰 hunk | 同一檔，hunk 間距 ≤ 3 行 |
| T3 | 同檔不同區域 | 同一檔，hunk 間距 > 3 行 |
| T4 | 多檔 | 任一實例改 ≥ 2 個檔，而且至少一個檔與另一實例共用 |
| T5 | 改名或搬移 | 任一 gold patch 含 rename 或 delete，而且另一實例修改該路徑 |
| T6 | 符號相依 | 檔案不重疊，但其中一個修改了另一個所引用的符號（用靜態分析判定） |
| C0 | 不相交對照 | 同一 repo，但檔案集合不相交 |

### 4.3 共同 base 問題（關鍵設計）
各實例的 `base_commit` 通常不同；在 SWE-bench Verified 的同檔配對中，相同 base 的配對數是 0（見 4.4）。所以要先定一個共同起點：
- **規則**：每組取組內最新的 base commit 作為共同起點，把每個實例的 gold patch 和測試套用上去，確認仍然可以套用、而且 fail-to-pass 測試仍然有效，才收錄這一組。
- 套不上或測試失效的組，丟棄並記錄數量。
- 這一步要由工具自動完成（§13 第 6 項）。

### 4.4 候選 benchmark 比較
| 候選 | 適合度 | 衝突配對怎麼挖 | 已算出的數字 | 優點 | 缺點 | 授權 |
|---|---|---|---|---|---|---|
| **SWE-bench Verified**（500 題，Python） | **高** | 依 repo 分組，比對 gold patch 的檔案與 hunk 行範圍 | **本稿實算**（HF `princeton-nlp/SWE-bench_Verified` test parquet，500 題）：同 repo 且同檔的配對 644 對；其中 hunk 行範圍重疊 42 對、相鄰 ≤ 3 行 13 對；**相同 base_commit 0 對**。依 repo（同檔／重疊／相鄰）：django 475/30/10、sphinx 72/6/1、sympy 27/2/1、xarray 26/0/1、matplotlib 18/0/0、pytest 10/1/0、requests 6/2/0。⚠ 行範圍是各自 base 上的行號，換到共同 base 後要重算 | 人工驗證過可解、有 Docker harness、社群公認；django 配對多 | 每題都是單一 issue，彼此本來互不相干；base 不同，需要 4.3 的重新定位；行號重疊不等於真正衝突 | SWE-bench repo 為 MIT（GitHub 授權欄位）；資料集條款與各上游專案授權**另行核對** |
| SWE-bench（full／Lite） | 中高 | 同上，題數更多 | 未計算 | 配對數可能更多 | 部分題目品質未經人工驗證 | 同上 |
| Multi-SWE-bench | 中 | 同上，跨多語言 | 未計算 | 可以測非 Python 語言 | harness 較新；每個 repo 題數可能偏少 | Apache-2.0（GitHub 授權欄位）；資料集條款另行核對 |
| **CooperBench**（arXiv:2601.13295） | **高**（專為多代理干擾設計） | 直接使用它設計的協作任務對 | 未計算 | 原生就是多代理同 repo 互相干擾 | GitHub repo 規模小（28 星），**授權欄位為空**，能否改作與再散布需要確認；harness 成熟度未知 | **未標示**，使用前必須向作者確認 |
| Commit0 | 中低 | 同一個函式庫裡，從零實作的不同模組 | 未計算 | 有測試；CAID 用過（Commit0-Lite） | 任務是從零實作整個函式庫，不是並行修改既有程式；衝突型態和本研究不同 | MIT（GitHub 授權欄位） |
| HIST-v2 真實 PR 配對（Django、sympy、sphinx） | 中（作為延續） | 沿用 HIST-v2 已封存的配對 | 未計算（數量以 HIST-v2 封存資料為準） | 可以和 HIST-v2 對照；已經有重播資料 | 原本為程式化寫手設計；要對真實代理重新撰寫任務說明 | 上游專案授權 |
| AgenticFlict 衝突 PR 配對 | 中低 | 從資料集取「與 base 衝突」的代理 PR | 未計算 | 衝突是真實發生的 | 是 PR 對 base 的衝突，不是兩個任務彼此衝突；多數沒有測試和 harness | 論文為 CC BY 4.0；資料集（Zenodo）授權**未核對** |

### 4.5 建議
- **主要**：SWE-bench Verified，以 django 為主，sphinx 與 sympy 為輔。理由：
  - 有人工驗證、有 harness；
  - 實算已經有 42 對行範圍重疊、13 對相鄰的候選；
  - 和 HIST-v2 使用的 repo 相同，便於對照。
  - T4（多檔）、T5（改名或搬移）、C0 等類別要另外再篩選。
- **備案**：CooperBench。授權確認可用，而且 harness 跑得起來時，可以改為主要 benchmark 或加做一組。
- **smoke**：可以用專用的小 repo，或直接取 1 對 django 重疊配對。
- **不採用**：
  - Commit0：衝突型態不符。
  - AgenticFlict：沒有任務對與測試。
  - Multi-SWE-bench 只在需要多語言時才加入。

### 4.6 題數與挑選流程
1. 從候選配對中，依 4.2 自動標記類別。
2. 依 4.3 重新定位到共同 base，並驗證 gold patch 可套用、fail-to-pass 測試仍有效。
3. 做單一代理基線：每個實例單獨跑，成功率 ≥ 50% 才收錄（門檻待作者決定），排除本身太難的題。
4. 每類目標 `n_c` 組，C0 為 `n_0` 組；不足的類別如實報告，**不得用改寫題目補足**。
5. 分出 dev 和 held-out；held-out 先封存雜湊。
6. **k > 2 的組**：在同一 repo 內找 k 個兩兩有重疊或相鄰關係的實例（團）。找不到時，k = 4、8 只能用「部分重疊加不相交」的混合組，這一點必須報告。

## 5. 代理設定

### 5.1 代理與模型
- 代理 CLI 以無頭（headless）模式執行，例如 Claude Code、Codex CLI、Cursor CLI。**主跑只用一種 CLI 加一個固定模型版本**；跨廠商列為探索性分析。
- 鎖定模型版本、溫度（若可設定）、系統提示與工具權限。

### 5.2 提示
- 三臂的任務提示逐字相同。
- ATM 臂額外附上一段固定的 ATM 使用說明（內容凍結、計算雜湊後存檔）。
- 兩個基準臂附上一段**長度相近的中性說明**，例如 repo 慣例，用來控制提示長度。
- 提示**不得**告訴代理「有其他代理在同時工作」。這個是否揭露，列為作者要決定的選項（§12）。

### 5.3 工作階段數與錯開
- 工作階段數 k 設為 {2, 4, 8}。
  - 依據（已核對原文）：CAID（arXiv:2603.21489v1）§4.2 原文：「In Commit0-Lite, performance improves when increasing engineers from 2 to 4 (53.1% single-agent to 59.1%), but decreases when expanding to 8 engineers.」同節也指出，在 PaperBench 上「increasing engineers beyond 2 yields minimal gain」。
  - 這是 CAID 在 manager 加 engineer 架構下的結果，不能直接套到本研究，只用來說明 k 的取值範圍。
- 啟動錯開 Δ 設為 {0 秒, 30 秒, 120 秒}，依序啟動各工作階段。
- 每個（題組 × k × Δ × 臂）都跑 r 次，主跑建議 r = 3，用不同隨機種子或重跑次序（模型不一定支援固定種子，見 §9）。

### 5.4 預算
每個工作階段都設上限，達到上限就終止，並記錄為「未完成」：
- 牆鐘時間 `T_max`，建議 20 分鐘；
- token `K_max`；
- 工具呼叫次數。

## 6. 結果指標（精確定義）

### 6.1 預期變更 oracle
每個子任務 j 預先寫好一組**機器可檢查的斷言** `O_j`，例如：某函式存在且包含某個行為、某個測試通過、某個符號被改名。這些斷言在單一代理的成功解答上都必須成立。

### 6.2 主要指標
| 代碼 | 指標 | 定義 | 單位與分母 |
|---|---|---|---|
| M1 | **遺失寫入** | 代理 j 在自己的工作階段結束時 `O_j` 成立（用該代理結束當下的快照檢查），但在**最終樹**上 `O_j` 不成立 | 次數 ÷ 「結束時 `O_j` 成立的子任務數」 |
| M2 | **損毀檔案** | 最終樹中出現衝突標記、語法無法解析，或檔案被截斷 | 檔案數 ÷ 題組 |
| M3 | **合併衝突** | B-wt：`git merge` 回報衝突的次數。B-shared：commit 時遇到 index 或 HEAD 競爭導致失敗的次數。ATM：re-compose、HEAD_MOVED、BRANCH_QUEUE_RACE、blocked 的次數 | 事件數 ÷ 題組 |
| M4 | **解衝突成本** | 每個衝突事件的牆鐘時間、token、重做輪數、人工介入次數（§6.4） | 依事件、依題組加總 |

### 6.3 次要指標
- **M5 白做的工作**：寫入後沒有出現在最終樹的變更行數，加上這些變更花掉的 token。
- **M6 最終測試通過率**：最終樹上跑該 repo 全部測試，加上各子任務的驗收測試。
- **M7 寫入到 commit 的窗口**：每次寫入從 `t_write_done` 到 `t_commit_published` 的時間。B-shared 用檔案監看加 git log 記錄；ATM 用 harness 時間戳。
- **M8 各代理任務完成率**：`O_j` 在最終樹上成立，而且該子任務的驗收測試通過。
- **M9 ATM 拒絕與重排隊**：ATM 臂中 blocked、re-compose、requeue 的次數，以及每次的等待時間。這是 ATM 的成本面，必須報告。

### 6.4 解衝突協定（B-wt）
衝突交給**一個新的代理工作階段**解，用同一模型，提示固定為「解決這些合併衝突並讓測試通過」。每次合併最多允許 R_max 輪。超過 R_max 輪就記為「需人工介入」，並由作者或研究者依固定規程處理，記錄所花的時間。

## 7. 假設（預先指定）
- **H1（遺失寫入）**：ATM 臂的 M1 低於 B-shared。
- **H2（衝突成本）**：ATM 臂的 M4 總成本（時間、token）低於 B-wt。
- **H3（損毀）**：ATM 臂的 M2 不高於任一基準臂，而且預期為 0。只要觀察到任何 ATM 損毀，就是反例。
- **H4（成本面，雙尾、只描述）**：ATM 臂在 C0（不相交）上的總時間和 token 相對 B-wt 的增量。
- **H5（劑量反應，探索性）**：效果隨 k 和衝突類別變化。

## 8. 分析計畫
- **配對單位**：題組 × k × Δ × 重跑次序。各臂使用相同的題組與設定。
- **估計量**：各指標在臂之間的差，以題組為單位做 cluster bootstrap（10,000 次）計算 95% CI。
- **最小關注效果**（待作者確認）：
  - M1 的絕對差 ≥ 5 個百分點；
  - M4 時間的相對差 ≥ 20%。
  
  CI 完全落在最小關注效果之外，才稱為「有實質差異」；否則只報告估計值。
- **多重比較**：H1–H3 為主要假設，用 Holm 校正；H4、H5 只描述。
- 依衝突類別 T1–T6、C0 和 k 分層報告，不只報合併結果。
- **排除規則**：工作階段因 API 錯誤終止時，記錄下來並重跑一次。仍然失敗就列入「未完成」，不排除。
- 確認是 harness bug 影響的數據不得放進論文正文；該代標為作廢，原始封存不改。
- 一律不寫「ATM 勝出」這類結論，只報告估計值、CI 與反例。

## 9. 威脅與限制
- **模型非決定性**：同一提示可能產生不同結果。用重跑次數 r 與配對設計處理，並報告重跑之間的變異。
- **提示汙染**：ATM 說明可能讓代理更謹慎。用長度相近的中性說明控制；另設一個探索性臂「ATM 提示，但不裝 ATM」作檢查（成本允許時才做）。
- **代理察覺他人修改**：B-shared 的代理可能看到檔案在變化而自行調整。這是真實行為，照實記錄，但要把「察覺事件」標註出來，例如代理輸出中提到檔案被改。
- **ATM CLI 熟悉度**：代理可能誤用 ATM 指令。M9 和 ATM 臂的完成率會反映這一點；誤用造成的失敗算在 ATM 臂，不排除。
- **成本**：k = 8 加上重跑，費用高。見 §11 公式；必要時縮減 k 或 r，並在凍結前定案。
- **整合者偏差（B-wt）**：合併順序固定、解衝突協定固定，以減少研究者自由度。
- **外部效度**：單一 repo、單一模型的結果不能推廣到所有情境。
- **範圍外**：跨機器遠端衝突；語意等價。CAS、鎖和佇列在本機 `.atm/runtime/`，擋不住別台機器的 push、其他 clone 或遠端 PR；那些仍依一般 git 的 merge 或 rebase 解。不主張超出這條邊界。

## 10. 執行階段與封存
| 階段 | 內容 | 批准 |
|---|---|---|
| smoke | 1 組 T1 × k = 2 × Δ = 0 × 三臂 × r = 1 | 需作者批准 |
| pilot | 約 10 組 × k ∈ {2, 4} × Δ ∈ {0, 30} × 三臂 × r = 1 | 需作者批准 |
| main | §4.2 全部 × k ∈ {2, 4, 8} × Δ 三種 × 三臂 × r = 3 | 需作者批准 |
| held-out | 封存的 held-out 題組，設定和 main 相同 | 需作者批准 |

- **封存規則**：
  - 每一代都放在 `research/paper-v2/` 下的新資料夾，例如 `benchmark-trials/2026-xx-xx-hist-v3-<stage>/`，並加上 EVIDENCE_INDEX 條目；
  - 封存內容包含原始對話紀錄、工具呼叫紀錄、最終樹、SHA256SUMS；
  - 各代不可變更；
  - 完成後立即 commit 和 push，不留 WIP；
  - 不打 tag，也不 npm publish。
- prereg 凍結前不得跑 main；任何偏離都要寫進偏離表。

## 11. 成本估算（公式）
令：
- `G` 為題組數；
- `K` 為 k 的集合，`k̄` 為依 K 加權後的平均工作階段數；
- `|Δ|` 為錯開設定數；
- `A` 為臂數（3）；
- `r` 為重跑次數；
- `t̄_tok` 為每個工作階段平均 token（由 pilot 估計）；
- `p_tok` 為每 token 單價；
- `ρ` 為 B-wt 的衝突率；
- `t̄_res` 為每次解衝突平均 token。

則：
- 代理工作階段數 `N_sess = G × |Δ| × A × r × Σ_{k∈K} k`
- token 費用 ≈ `N_sess × t̄_tok × p_tok`，加上 `G × |Δ| × r × |K| × ρ × t̄_res × p_tok`（B-wt 解衝突）
- 牆鐘時間：並行跑 P 組時約為 `(G × |Δ| × A × r × |K| × T̄_run) / P`
- 人工時間 ≈ 人工介入次數 × 平均處理分鐘

`t̄_tok`、`ρ`、`T̄_run` 一律由 pilot 實測後代入，不預先假設數值。凍結前要依實測數字重算 main 的預算，送作者批准。

## 12. 需要作者決定的事項
1. benchmark：**已決定（2026-10-15，作者）**：主要用 SWE-bench Verified（django 為主，sphinx、sympy 為輔），CooperBench 為備案（使用前需先確認授權）。專用 repo 只能用於 smoke。
2. 代理 CLI 與模型：主跑用哪一個（Claude Code、Codex、Cursor CLI），是否加跨廠商探索。
3. 規模：`n_c`、`n_0`（建議 6／6）、k 是否包含 8、r = 3 或 2。
4. 是否在提示中告知「有其他代理同時工作」。
5. B-wt 解衝突協定：用代理解（R_max = ?），還是人工解。
6. 最小關注效果的門檻（建議 M1 為 5 個百分點、M4 為 20%）。
7. 預算上限：每工作階段 `T_max`、`K_max`，以及整體費用上限。

## 13. 開跑前要先做的工具（可直接開成 GitHub issue）
1. **多代理啟動器（multi-agent launcher）**
   - 驗收：可用設定檔指定 CLI、模型、k、Δ、臂、提示檔；
   - 每個工作階段都是獨立行程；
   - 完整保存 stdout、對話與工具呼叫紀錄；
   - 達到 `T_max`／`K_max` 會終止並記錄原因；
   - 在 smoke 組（專用 repo 或 1 對 django 重疊配對）上能重現。
2. **三臂環境建置器**
   - 驗收：B-shared 建立單一工作樹；B-wt 為每個代理建 worktree 加 branch；ATM 安裝固定版本並啟用 raw git 封鎖；
   - 三臂起始 commit 與檔案雜湊完全相同（有測試證明）。
3. **B-wt 整合器與解衝突代理**
   - 驗收：依固定順序合併；衝突時呼叫解衝突工作階段，最多 R_max 輪；
   - 記錄每輪時間、token；超過就標記需人工處理。
4. **預期變更 oracle 框架**
   - 驗收：每個子任務的 `O_j` 都可以對任意樹求值；
   - 在單一代理的參考解上全部成立，在空變更上全部不成立（有測試）。
5. **觀測器**
   - 驗收：記錄 `t_write_done`（檔案監看）、`t_commit_published`（git log 或 ATM 收據）；
   - 量 M2（衝突標記、語法解析）和 M3 的事件分類；
   - 讀取 ATM 收據統計 M9。
6. **題組產生與驗證工具**
   - 驗收：每組都標好 T1–T6 或 C0；
   - 單一代理基線成功率 ≥ 80% 才收錄；
   - held-out 組產生後就封存雜湊。
7. **成本計量**
   - 驗收：可從各 CLI 的輸出抽取 token 用量，並依 §11 公式產出預算報表。
8. **分析腳本**
   - 驗收：配對 cluster bootstrap、Holm 校正、分層表；
   - 在合成資料上能重現已知的效果大小。
9. **封存與 EVIDENCE_INDEX 自動化**
   - 驗收：每次跑完都產生不可變的資料夾、SHA256SUMS 和索引條目，`verify.sh` 通過。

---
# 附錄（前版內容，降為次要／支持章節）
附錄 A 是原本的程式化研究（現改為次要研究，可作為工具驗證與機制檢驗）；附錄 B 是外部證據；附錄 C 是 ATM 程式碼現況（原 §9、§11）。以下保留前版全文，章節編號沿用前版。

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
- **納入**：同一台機器、同一個 repo，不同代理（不同行程或對話）並行修改。
- **排除**：其他機器推到 remote 造成的衝突，例如別人先 push、本地落後 origin。ATM 目前的 CAS 與鎖都是本機的（見 §9），這類衝突列為 threat 與 limitation，不在主張內。
- **不主張語意等價**：ATM 不保證合併後的語意和各代理原意一樣，人類也做不到。語意層的結果只描述，不當成 ATM 的勝負指標。

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
- 跨機器的 remote 衝突不在範圍內（見 §1）。ATM 的 CAS 與鎖都在本機 `.atm/runtime/`，無法擋住別台機器的 push。
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

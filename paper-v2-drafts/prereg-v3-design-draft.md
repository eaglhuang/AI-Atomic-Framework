# Prereg v3 設計草稿：多 AI agent 並行開發時，ATM 能否「提早」發現並化解衝突

- **狀態**：設計草稿（DESIGN DRAFT），**不是**凍結的預先登記，沒有跑任何實驗、沒有呼叫付費模型。
- **日期**：2026-10-31（Asia/Taipei）。作者：Grok Bot 依文一 2026-10-31 的定位（t521u／t522u）起草。
- **位置**：孤兒備份分支 `backup/grok-bot-box-20261030`，`paper-v2-drafts/prereg-v3-design-draft.md`；不開 PR、不合併。
- **與舊稿關係**：取代 `P/prereg-v3-draft/2026-10-15/prereg-v3-draft.md`（以下稱「舊 v3 稿」）的**研究問題與假設骨架**；舊稿的臂（B-shared／B-wt／ATM）、指標 M1–M9、six-pairs 資料集、v14 kit、成本公式都沿用，見 §11。
- `P/` = `research/paper-v2/`。

---

## 0. 一句話定位（文一，權威）

ATM **不是**要贏過或取代 git。git 的設計是「commit 之後、merge 時才發現衝突」。當大量 AI agent 同時改同一個 repo，衝突會暴增，而且常以三種壞形式出現：當場出錯、默默覆蓋、或拖到 merge 才爆。ATM 的目的是讓衝突在**寫程式之前（或寫到一半）**就被發現並處理，讓多個 agent 能順暢並行。

本研究要拿出數據證明（或否證）：
1. ATM 讓衝突**更早**被發現（偵測時點前移）；
2. 因此**遺失／覆蓋**更少（目標 0）、**白做的工**更少；
3. agent 數量變多時，ATM 的整體進度不會被拖垮，而且優勢隨 agent 數增加而擴大；
4. 最終結果仍然通過測試。

**不主張**：ATM 的合併演算法比 git 好（HIST-v2 已顯示 steward 與 textual_merge_file 同為 `git merge-file`，579/580 組逐位元相同，這是預期的「同演算法上限」）；不主張語意正確性保證；不主張跨機器／遠端 PR 情境。

---

## 1. 研究問題

- **RQ1（時點）**：在同一組並行任務下，衝突在哪個階段被發現？發現前已經做了多少工？
- **RQ2（安全）**：被確認寫入（acknowledged）的修改，有多少最後不在最終樹上（遺失／被覆蓋）？
- **RQ3（浪費）**：被丟棄或重做的工作量（行數、重做次數、token、牆鐘時間）？
- **RQ4（規模）**：並行 agent 數 k 從 2 增加到 16 時，上述指標和完工時間（makespan）怎麼變化？ATM 的代價（等待、排隊、誤判重疊）有多大？
- **RQ5（品質）**：最終樹的測試通過率是否不劣於基準？

---

## 2. 臂（arms）

| 代碼 | 名稱 | 規則 | 代表的真實作法 | L1 | L2 |
|---|---|---|---|---|---|
| **GIT** | git-branch-late-merge（主要基準） | 每個 agent 一個 branch／worktree，各自 commit；結束後由整合者按**完成順序** `git merge` 回主線；衝突交給解衝突協定（§6.5） | 目前多 agent 主流作法（Claude Code worktree、Codex 各自分支、PR 流程） | ✔ | ✔ |
| **ATM** | ATM（處理組） | 開工前 agent 對要改的範圍做 **claim／lease**（檔案或符號層級，§2.1）；主要分析為**檔案層級**（D1）；重疊時 ATM **當場**回報（P0），雙方**共享範圍、不等待、不縮小**，改動一律交給 steward 合併（D2）；寫入與提交一律經 steward（CORE_MERGE `cb25242433` 的 batch coordinator，ack + deadline + 原子替換）；未 claim 就碰到的檔案在第一次寫入時觸發 lease 檢查 | 本研究評估的作法 | ✔ | ✔ |
| **SHARED** | 無保護共用工作樹（下限，floor） | 所有 agent 直接改同一個工作樹，自行 `git add/commit`；無鎖、無隔離 | 最天真的多 agent 作法 | ✔ | ✔（建議） |
| **LOCK** | file_lock（可選） | 第一次寫某檔時取得排他鎖，持有到 submit；拿不到就等 | 傳統悲觀鎖 | ✔ | ✗（預設不跑，待決） |

主要比較：**ATM vs GIT**（H1、H3、H4、H5）；**ATM vs SHARED**（H2）。LOCK 用來分離「提早發現」與「單純序列化」的效果：如果 ATM 的好處只是鎖，ATM 和 LOCK 在 H1 會相同，但 ATM 在 H4（進度）應較好。

### 2.1 ATM claim 的定義（D1、D2 已由文一於 2026-10-31 決定）

- **粒度**（D1，已決定）：主要分析一律 `file` 層級 claim。`symbol` 層級（函式／類別，用 tree-sitter 或 Python AST 決定）列為**附加實驗**（次要／探索性），另開臂 `ATM-sym`，只做描述與探索性比較，不進主要假設族。
- **重疊政策**（D2，已決定）：固定為 `share-and-steward`：
  1. claim 與現有 lease 重疊 → ATM 立即回 `CLAIM_OVERLAP`（記為 P0 偵測），告知雙方 agent ID 與重疊範圍；
  2. 雙方自動成為**共享 claim**，各自繼續工作，**不等待、不縮小範圍**；所有寫入與提交經 steward 合併（ack + deadline + 原子替換），steward 拒絕的衝突 hunk 退回原 agent 重做並計入 `WW`；
  3. lease 有 TTL，commit 或逾時釋放。等待／縮小範圍政策不在主要設計中（如需可日後另立探索性分析）。
- **未 claim 的寫入**：第一次寫入未 claim 的檔案時做同樣檢查；重疊時記為 P1 偵測。

---

## 3. 因子

| 因子 | 水準 | 備註 |
|---|---|---|
| 並行 agent 數 k | 2, 4, 8, 16 | L1 全做；L2 主跑 2, 4（8 為探索，16 不做，見 §8.4） |
| 任務重疊程度 O | O0 不相交／O1 同檔不同 hunk／O2 同 hunk（真衝突）／O3 混合（自然分佈） | 以 gold diff 自動判定（沿用舊 v3 稿 §4.2 與 HIST-v2 類別 A/A′/B/B′/C 的對應，見 §5.3） |
| 開工錯開 Δ | L1：歷史實際時間或壓縮後；L2：0 s、60 s | L2 只用 2 個水準以省額度 |
| 重複 r | L1：2 種子 × 2 順序；L2：r = 2（待決） | |

---

## 4. 指標（精確定義）

### 4.1 「真衝突」基準（與臂無關）

為了不讓 ATM 因「claim 得寬」就被算成「偵測到很多衝突」，先用**與臂無關**的方式定義真衝突：
- 對每一對 agent (i, j)，用兩者**最終 diff**（L1 = 歷史 PR diff；L2 = 各自單獨完成的解答）在共同 base 上做 `git merge-file`（CORE_MERGE `cb25242433` 的 applier）：
  - `G_text(i,j)` = 有文字衝突（O2）；
  - `G_file(i,j)` = 改到同檔但可自動合併（O1）；
  - 其餘為不相交（O0）。
- L2 另以測試判定 `G_sem(i,j)`：各自單獨通過、合併後測試失敗（語意衝突，對應 B′）。
- **主要分母** = `G_text ∪ G_sem` 的 agent 對。ATM 在 `G_file`／O0 上觸發的重疊回報計為 **假警報（over-serialization）**，是 ATM 的代價面，必報。

### 4.2 偵測時點（detection phase）

對每個真衝突對，記錄**第一次有任何一方被系統明確告知衝突**的階段：

| 代碼 | 階段 | 例 |
|---|---|---|
| P0 | **寫之前**（pre-edit） | ATM `CLAIM_OVERLAP`；LOCK 第一次寫入前取鎖失敗不算（那屬 P1） |
| P1 | **寫到一半**（mid-edit，已寫入衝突檔、尚未 commit/submit） | ATM 未 claim 檔案的第一次寫入檢查；LOCK 取鎖失敗 |
| P2 | **提交時**（commit／submit） | ATM steward 拒絕；SHARED commit 時 index／HEAD 競爭 |
| P3 | **合併時**（merge／integration） | GIT `git merge` 回報衝突 |
| P4 | **從未被告知**（silent） | 覆蓋、遺失，或合併後測試失敗才發現 |

- **早期偵測率** `EDR = #(P0 ∪ P1) / #真衝突對`。
- **偵測前工作量** `W_det`：被告知那一刻，受影響 agent 已在衝突範圍上產生的工作：L1 = 已寫入的 diff 行數（依 commit 時間內插）；L2 = 已寫入行數 + 已花 token + 牆鐘秒數。

### 4.3 遺失／覆蓋（沿用 06a §6.1 全論文定義）

- **遺失寫入 M1** = 某修改已被系統確認（ack／commit 成功／agent 在結束快照上 oracle `O_j` 成立），但最終樹上不成立。**未提交的 hunk 不算遺失**（舊 pilot 的教訓）。
- **損毀 M2** = 最終樹有衝突標記、無法 parse、截斷。
- ATM 的目標是 M1 = M2 = 0；任何一筆都是反例，必須逐筆報告。

### 4.4 白做的工（wasted work）

- `WW_lines` = 寫入後沒有出現在最終樹、且非 agent 自行修訂的行數；
- `WW_redo` = 因衝突而重做的次數（重新 claim 後重寫、解衝突 session 數、rebase 後重改）；
- `WW_tok`（僅 L2）= 上述工作與解衝突 session 的 token 總和；
- 以「每完成一個子任務」正規化。

### 4.5 進度與品質

- **makespan** = 第一個 agent 開工到最後一個子任務併入主線（含解衝突）；
- **吞吐量** = 完成子任務數 ÷ makespan；
- **ATM 等待時間** = steward 排隊總和（D2 下無 lease 等待；代價面，必報）；
- **最終測試** T_pass = 最終樹上所有子任務的 FAIL_TO_PASS 與 PASS_TO_PASS 全過（L2；L1 只在可跑測試的子集描述）。

---

## 5. 假設與主要指標（預先指定、可否證）

最小關注效果（MCE）為建議值，凍結前由文一確認（決策 D7）。

| 假設 | 主張 | 主要指標 | 可否證條件（任一成立即視為「未支持」） | 層 |
|---|---|---|---|---|
| **H1 提早偵測** | ATM 讓真衝突更早被發現 | `EDR(ATM) − EDR(GIT)`；次要：`W_det` 中位數比 | 差值 95% CI 下界 < **+50 個百分點**，或 `W_det(ATM)/W_det(GIT)` CI 上界 > **0.5** | L1 主、L2 確認 |
| **H2 零遺失** | ATM 不遺失／覆蓋已確認的修改 | ATM 的 M1 + M2 計數；對照 SHARED 的率 | ATM 出現 **≥ 1** 筆 M1 或 M2（逐筆報告為反例）；SHARED 對照只描述 | L1、L2 |
| **H3 少白做** | ATM 的白做工作比 GIT 少 | 每完成子任務的 `WW_lines`（L1）／`WW_tok`（L2） | ATM/GIT 比值 CI 上界 > **0.8**（即沒有至少 20% 減少） | L1 主、L2 確認 |
| **H4 規模** | k 增加時 GIT 的晚期衝突與白做工超線性增加，ATM 保持低；且 ATM makespan 不劣於 GIT | (a) 混合模型 `metric ~ arm × log2(k) + O + (1|group)` 中 arm×log2(k) 交互作用；(b) makespan 比值 | (a) 交互作用 CI 含 0 或方向相反；(b) 任一 k 的 `makespan(ATM)/makespan(GIT)` CI 上界 > **1.10**（非劣性失敗） | L1 主（k=2..16）、L2（k=2,4） |
| **H5 品質** | ATM 最終樹測試通過率不劣於 GIT | `T_pass(ATM) − T_pass(GIT)` | CI 下界 < **−5 個百分點** | L2 主 |

- **主要分析只用檔案層級 ATM 臂**（D1）；`ATM-sym` 結果另節報告、不做校正後推論。
- **多重比較**：H1、H2、H3 為主要族，Holm 校正；H4、H5 為非劣性／交互作用檢定，單獨報告；分層（O、k、類別）只描述。
- **不寫「ATM 勝出」**；報告估計值、CI、反例與代價（假警報率、等待時間）。
- **預期中可能失敗的地方**（先寫出來以示誠實）：O0／O1 為主的工作負載中，ATM 的假警報與等待可能使 H4(b) 失敗；這必須如實報告，並以 `ATM-sym` 附加實驗（符號層級 claim，D1）作為探索性解釋。

---

## 6. 第一層（L1）：歷史 PR 時間線重播（零模型成本）

### 6.1 資料

- **開發集**：Django（沿用 HIST mining `P/benchmark-trials/2026-10-09-hist-mining/data/django_pr_snapshot_raw.jsonl`，1,547 筆 PR，含 `created_at`、`merged_at`、`closed_at`、`n_commits`、`head_sha`、`merge_commit_sha`），以及 HIST-v2 classify-v8 的 2,288 個有類別的 dev items 作為 hunk 來源。
- **保留集（held-out）**：flask、requests（沿用 v2 的保留設定；開發期間不得看其結果）。
- **新增需要抓的欄位**（免費，`gh api`，受 rate limit）：每個 PR 的 commit 清單（author date、committer date、每個 commit 改的檔案與行數）。這是推「開工時間」與「寫到一半」的依據。

### 6.2 由歷史資料推導的量

| 量 | 推導 | 備註／敏感度分析 |
|---|---|---|
| agent 開工 `t_start` | PR 第一個 commit 的 author date | 敏感度：`created_at − 中位數開發時長` |
| 每檔第一次寫入 `t_write(f)` | 第一個碰到 f 的 commit 的 author date | commit 粒度粗，寫入時點只能落在 commit 上 |
| 提交 `t_submit` | PR `created_at`（開 PR = 宣告完成） | 敏感度：最後一個 commit 的 committer date |
| 合併 `t_merge` | GIT 臂中依模擬順序決定；歷史 `merged_at` 只用來排序 | |
| ATM claim 範圍 | 三種，**主要分析用 S1**：S1「第一個 commit 改到的檔案」（開工時合理能知道的範圍）；S2「最終 diff 的全部檔案」（完美預知，上限）；S3「S1 所在目錄」（粗 claim，假警報上限） | S2 會高估 ATM，只當上限報告；S1 之外後來才碰到的檔案走 P1 檢查 |
| 工作量 | diff 行數依 commit 時間累積 | L1 沒有 token，只用行數 |

### 6.3 並行情境的建構

歷史上同時開著的 PR 很少到 16 個且彼此重疊，所以用**合成並行**：
1. 從同一個 base 時間窗（例如 30 天）抽 k 個 PR，依重疊程度 O 分層抽樣（用 §4.1 的 `G_text`／`G_file`）；
2. 每個 PR 保留自己的**相對**時間線（各 commit 相對 `t_start` 的偏移），開工時間依 Δ 重新對齊（0、歷史實際分佈、或均勻錯開）；
3. 所有 PR 的 diff 在共同 base 上重播（用 HIST-v2 的 three-way 方式：`parent_text`／`head_text`，dev replay bindings v2）；無法對齊 base 的 PR 排除並記錄。
4. 每個情境（k × O × Δ × 種子）四臂各跑一次；離散事件模擬，決定性、帶種子，與 harness v4 一樣使用 `CLOCK_MONOTONIC` 與 A9 時鐘有效性規則。

### 6.4 各臂在 L1 的模擬規則

- **GIT**：各自寫到 `t_submit`；依 `t_submit` 順序合併；衝突在 P3 被發現，`W_det` = 該 PR 全部 diff 行數；解衝突以「重做衝突 hunk 行數 × 1」計 `WW_lines`（L1 無法模擬 agent 解衝突，以此為代理量，限制見 §6.5）。
- **ATM**：`t_start` 時以 S1/S2/S3 claim；重疊 → P0；依 D2 一律共享 claim、不等待（之後經 steward 合併，衝突 hunk 於 P2 被拒則計入 `WW_lines`）；`ATM-sym` 附加臂同規則、改用符號層級 claim；S1 之外的檔案在 `t_write(f)` 檢查 → P1，`W_det` = 當時已寫行數。
- **SHARED**：每次 commit 時把該 PR 該檔的 post-image 寫入共用樹（後寫者覆蓋），無偵測；被覆蓋的已 commit 修改計 M1，衝突計 P4。
- **LOCK**：`t_write(f)` 時取鎖，持有到 `t_submit`；取不到等待 → P1。

### 6.5 L1 效度威脅（必寫進論文）

1. **人類 PR ≠ AI agent**：人類開發時長、commit 習慣與 agent 不同；L1 只說明「在真實改動形狀下」的衝突結構與時點，**不**代表 agent 行為。L2 用來補這一點。
2. **commit 粒度**：寫入時點只能落在 commit 上，`W_det` 有誤差；以 commit 數分層報告。
3. **合成並行**：把不同時期的 PR 對齊到同一 base 是人造情境；以「只用歷史上真的同時開著的 PR 對」做一個小的自然子集作為對照。
4. **ATM 的早期偵測部分是設計使然**：claim 在開工時就做，P0 自然多。所以 H1 的價值在**量化**（多少衝突、省多少工、代價多少），並以 S1（非完美預知）為主、S3 報告假警報上限。
5. **解衝突代價是代理量**：L1 不模擬 agent 解衝突，`WW_lines` 只是下限；L2 才量真實 token。
6. **Rebase／force-push 遺失的歷史**：抓到的 commit 時間可能被改寫；記錄 `n_commits` 與實際抓到的差異。

---

## 7. 第二層（L2）：小豆執行的真實多 agent 實驗（不另付 API 費）

### 7.1 原則

- 由**小豆**（文一的 Codex，使用既有 ChatGPT 訂閱額度登入的 Codex CLI）執行；**不得**使用 API key 或任何按量付費的端點。額度用完就停，記錄停在哪，不改用付費方式。
- 規模設計成訂閱額度可負擔；正式規模在 pilot 實測 token／時間後才決定（§8）。
- 所有 agent 使用同一個 Codex 模型與推理設定（凍結前記錄版本），跨模型不在範圍。

### 7.2 任務組

- **k = 2**：沿用 six-pairs（`P/prereg-v3-datasets/2026-10-24-six-pairs`）：主 4 組（含 g05 = `django__django-13820` + `django__django-11141`），保留 2 組（g04、g06）。
- **k = 4**（新建）：從 SWE-bench Verified 的 Django 實例中，依同一套 eligibility 流程（FAIL_TO_PASS 在 gold 前失敗、後通過；PASS_TO_PASS 前後都過；組合 gold 可共存）組出 4 個子任務共用一個 base 的「四件組」，每組至少含一對 `G_text` 真衝突與一對 O0；主 3 組、保留 1 組。
- **k = 8**（探索性，可省略）：兩個四件組合併，只跑 ATM 與 GIT，r = 1。
- 每組在凍結前算好 §4.1 的真衝突基準（用 gold patch 先算一次；agent 實際解答的基準在跑完後用各自單獨完成的 diff 再算）。

### 7.3 執行方式

- 每個（組 × k × Δ × 臂 × 重複）是一個 **run**；run 內 k 個 Codex CLI 無頭 session 同時啟動（依 Δ 錯開），每個 session 一個子任務。
- 各臂設定：
  - GIT：每 session 一個 worktree + branch；全部結束後由 harness 依完成順序 merge，衝突交給一個新的 Codex session 解，最多 R_max = 2 輪，超過記為「需人工」；
  - ATM：共用工作樹，提示附固定的 ATM 使用說明（claim → 編輯 → `atm` 提交），raw git 寫入依 ATM 政策封鎖；
  - SHARED：共用工作樹、無說明。
- 提示：三臂任務文字逐字相同；ATM 說明與基準的中性說明長度相近（沿用舊 v3 稿 §5.2）。是否告知「有其他 agent 同時工作」= 決策 D5。
- 每 session 上限：牆鐘 20 分鐘、token 上限（pilot 後訂）；達上限記為未完成。
- 跑完由 harness（不是 agent）跑最終測試與 oracle。

### 7.4 小豆必須記錄的東西

見 §7.6 英文 brief。

### 7.5 封存

- 每個 run 一個目錄 `runs/<run_id>/`；run 結束立刻產生 `SHA256SUMS` 與 `MANIFEST.json`（kit 版本、Codex CLI 版本、模型、ATM commit、任務組、臂、種子、開始／結束時間 Asia/Taipei 與 UTC）。
- 封存後不得修改；如需更正，另開 `ERRATA.md`。
- 小豆把封存包推到遠端分支 `research/prereg-v3-l2-<YYYYMMDD>`（只推、不合併）；Grok Bot 用 `verify.sh` 驗雜湊後才分析。
- 大檔（Codex rollout）打包成 `tar.gz`，雜湊記在 git，檔案本身放在 git 外（同 A13 提案）。

### 7.6 Operator brief for 小豆 (English)

> **To:** 小豆 (Codex) **From:** 文一 / Grok Bot **Re:** ATM paper v3, Layer 2 live multi-agent runs
>
> **Goal.** Measure *when* conflicts are detected and how much work is wasted when several coding agents edit the same repo at once, under three setups: GIT (one branch/worktree per agent, merged at the end), ATM (agents claim their scope up front; ATM steward handles writes), and SHARED (everyone edits one working tree, no protection). We are **not** trying to show ATM beats git at merging.
>
> **Hard rules.**
> 1. Use only the Codex CLI signed in with the existing ChatGPT subscription. Run `codex login status` first and record the output; if it shows an API key, stop. Never set `OPENAI_API_KEY` or use any pay-per-token endpoint. If quota runs out, stop, write `QUOTA_STOP.md` with the time and the last finished run, and wait.
> 2. Run **only** what 文一 has approved: first the pilot (§8.1); formal runs only after a written go-ahead from 文一.
> 3. Do not edit task prompts, the ATM instruction text, the kit, or seeds. If something is broken, stop and report; do not patch and continue.
> 4. Never modify a sealed run directory. Corrections go in `ERRATA.md`.
> 5. Do not merge anything. Push sealed runs to `research/prereg-v3-l2-<YYYYMMDD>` only.
>
> **Per run, launch.** `run-l2.sh --group <g> --k <k> --arm <GIT|ATM|SHARED> --delta <0|60> --rep <r>` (kit v15, to be provided). It starts k headless Codex sessions with the frozen prompts and a 20-minute wall cap each.
>
> **What must be logged (the kit does most of this; check it exists before sealing).**
> - `session-<i>/rollout.jsonl`: the full Codex session log, including `token_count` / `total_tokens` events.
> - `session-<i>/timeline.jsonl`: start, end, exit reason (done / wall cap / token cap / error), all timestamps with timezone.
> - `fs-events.jsonl`: every file write in the working tree(s) from the watcher: time, path, session id, bytes, sha256 after write.
> - `git/`: `git log --all --format=fuller`, every merge attempt with its stdout/stderr and conflicted paths, and the final tree hash.
> - `atm/` (ATM arm only): the `.atm/runtime/` event log: every claim, `CLAIM_OVERLAP`, lease grant/release/expiry, steward accept/reject, ack, with timestamps.
> - `resolve/` (GIT arm only): each conflict-resolution session's rollout and outcome, round count, and whether a human was needed.
> - `tests/`: final-tree test output (FAIL_TO_PASS and PASS_TO_PASS per subtask) and per-session oracle checks.
> - `env.json`: Codex CLI version, model name and reasoning setting as shown by the CLI, OS, Python and Node versions, ATM commit, `codex login status` output (no secrets).
>
> **Seal.** Run `seal-run.sh runs/<run_id>`. It writes `MANIFEST.json` and `SHA256SUMS`. Then `git add` only that run directory, commit `l2: seal <run_id>`, and push. Report the commit SHA, run ids, total tokens used, and wall time to 文一.
>
> **Never put secrets (tokens, auth files, `~/.codex/auth.json`) in any log or commit.**

---

## 8. 先 pilot 再正式（Pilot-first）

### 8.1 Pilot 內容

- **L1 pilot**：Django 一個 30 天時間窗，k ∈ {2, 4, 8, 16}，O3（自然分佈），1 種子，四臂。目的：驗證 miner 與模擬器、量每情境秒數、檢查負控（§8.3）。成本：box 時間，0 token。
- **L2 pilot**：g05，k = 2，Δ = 0，三臂各 1 次 = **6 個 Codex session**（加上 GIT 臂可能的 1–2 個解衝突 session）。目的：量每 session token 與牆鐘、確認記錄完整、檢查 kit。

### 8.2 Pilot 通過條件（沿用 A10 精神）

- 所有計畫中的 run／情境都完成；0 個 harness error；封存驗證通過；
- 所有負控被抓到；
- L2：每個 run 的 `rollout.jsonl`、`fs-events.jsonl`、`atm/`、`tests/` 都存在且雜湊正確。

### 8.3 負控（planted controls）

- 兩個 agent 同時改同一 hunk 的合成任務：GIT 必在 P3、ATM 必在 P0、SHARED 必出現 M1；
- 不相交任務：ATM 不應出現 `G_text` 偵測（只可能是假警報，需列出）；
- 故意未 claim 的寫入：ATM 必在 P1 偵測。

### 8.4 正式規模（pilot 後重算，**需文一批准**）

- L1：每個 (k, O) 至少 200 個情境 × 4 臂 × 2 種子 × 2 順序；只耗 box 時間（估計待 pilot 實測）。保留集 flask／requests 在開發集凍結後跑一次。
- L2 建議起點：主 4 組（k=2）+ 3 組（k=4）× 3 臂 × Δ{0,60} × r=2 → session 數 = (4×2 + 3×4) × 3 × 2 × 2 = **240**（未含解衝突 session）。若 pilot 顯示超出訂閱額度，降為 Δ 只用 0（120 session）或 r = 1（120 session）；最低版本 60 session。保留集（g04／g06 + 1 個四件組）在主跑封存後跑。
- 任何正式 run 開跑前，文一書面同意；pilot 的數字不得當作正式結果引用。
- 因 box 常被還原：L1 按情境 checkpoint、每個 shard 完成就推遠端（A13 做法）。

---

## 9. 分析計畫

- **單位**：L1 = 情境（k × O × Δ × 種子 × 順序）；L2 = run（組 × k × Δ × 重複）。同一情境四臂配對。
- **估計**：臂間差／比，以任務組（L2）或 base 時間窗（L1）為 cluster 做 bootstrap 10,000 次，95% CI。
- **H4 模型**：線性（或對計數用 Poisson／負二項）混合模型 `metric ~ arm × log2(k) + O + (1|group)`。
- **排除**：A9 時鐘不連續、A12（若採納）主機暫停的 run → 封存、排除、重跑一次；超過 1% 停止。Codex 因額度或服務錯誤中斷 → 記錄、重跑一次，仍失敗算「未完成」，不排除。
- **L1 與 L2 一致性**：在 k = 2, 4 比較兩層 `EDR` 與 `WW` 的方向是否一致；不一致要討論。
- **代價面必報**：ATM 假警報率、等待時間、拒絕／重排隊次數（舊稿 M9）。

---

## 10. 與 v2.1、pilot-r3 的關係

| 項目 | 處理 |
|---|---|
| 論文定位（D9，文一 2026-10-31 決定） | **v3 為論文主要研究**；HIST-v2 降為**次要研究**。 |
| HIST-v2 prereg r7 與 v2.1 修正（A1–A11） | **保留**，凍結內容不改。作為次要研究：「ATM 的合併能力與 git 同等」（合併同等性附帶證據）。 |
| v2 正式主跑（2,288 題） | 文一 2026-10-31 決定**先不跑**；v3 不依賴它。是否日後跑另行決定。 |
| A12、A13（提案） | 仍只屬 v2 提案；A13 的分片／checkpoint 作法 v3 直接沿用為工程作法。 |
| pilot-r3（PR #427，未合併） | 在論文中作為次要研究的**合併同等性附帶證據**，標明為 **pilot**（非正式結果）：0 token、1,740 cells、steward 與 textual_merge_file 在 579/580 組相同，並解釋為「同演算法上限」；那 1 個不一致組逐筆說明。 |
| harness v4（PR #426） | v3 L1 模擬器沿用其 hunk applier（CORE_MERGE `cb25242433`）、monotonic 時鐘、A9 規則與 jitter 種子格式。 |
| 舊 v3 稿（2026-10-15） | 研究問題改為「偵測時點」；臂、M1–M9、提示控制、成本公式、six-pairs、v14 kit 沿用；舊稿 H1–H5 由本稿 §5 取代。 |
| 論文章節 09 | 改寫為 v3 兩層設計；06c 仍待 v2 決定。 |

---

## 11. 需要的 harness／ATM 修改（粗估）

| # | 項目 | 內容 | 估計 |
|---|---|---|---|
| W1 | L1 時間線 miner | `gh api` 抓 PR commit 清單與每 commit 檔案；Django 開發集 + flask／requests 保留集；封存 | 1 天 |
| W2 | L1 事件模擬器 | 決定性離散事件模擬，四臂政策、S1/S2/S3 claim、checkpoint；重用 v4 applier | 2–3 天 |
| W3 | 真衝突基準 | `G_text`／`G_file` 計算（L1、L2 共用），`G_sem`（L2 測試） | 1 天 |
| W4 | **ATM 開工前 claim／lease** | 先讀碼確認現有 `framework-mode claim`、quickfix claim、lane-sessions 能否給任意 agent 用；缺的話補：檔案 lease（主要）、共享 claim 模式（重疊時不阻擋、轉 steward 合併）、TTL、`CLAIM_OVERLAP` 回報與通知、未 claim 寫入檢查；符號 lease 只為附加實驗，可延後、帶時間戳事件記錄 | 2–4 天（讀碼後再估） |
| W5 | 偵測時點儀器 | inotify 檔案監看、git hook 記 commit／merge 衝突，統一事件格式 | 1 天 |
| W6 | L2 kit v15 | 以 v14 為基礎：k 個 Codex session 啟動器、三臂、Δ、上限、`codex login status` 檢查、seal 腳本 | 2–3 天 |
| W7 | k = 4 任務組 | 依 six-pairs 流程建四件組並跑 eligibility | 2 天 |
| W8 | scorer | EDR、W_det、M1/M2、WW、makespan、T_pass；單元測試含負控 | 2 天 |
| W4b | 符號層級 claim（附加實驗，D1） | tree-sitter／Python AST 符號範圍判定、`ATM-sym` 臂；不擋主線，可最後做或刪減 | 1–2 天 |
| W9 | 預先登記文件 | 凍結成 `P/prereg-v3-<date>/`（含 SHA256SUMS、verify.sh、EVIDENCE_INDEX 列）— governance 紀錄，需文一同意 | 0.5 天 |

合計約 13–17 個工作天（可平行）；D2 固定共享政策省去等待／縮小範圍邏輯（W2、W4 約省 0.5–1 天），但 W4b 附加實驗加 1–2 天，總估計不變。W1–W3、W8 不花錢；W6 的測試只用乾跑（不呼叫模型）。

---

## 12. 需要文一決定的事項

1. **D1 claim 粒度** — ✅ **已決定（文一，2026-10-31）**：主要分析為檔案層級；符號層級為附加實驗（次要／探索性）。
2. **D2 重疊政策** — ✅ **已決定（文一，2026-10-31）**：重疊時共享範圍、改動交給 steward 合併；主要設計不等待、不縮小範圍。
3. **D3 L1 主要 claim 推導**：S1「第一個 commit 的檔案」（建議）vs S2 完美預知。
4. **D4 LOCK 臂**：只在 L1 跑（建議），或 L2 也跑。
5. **D5** 是否告訴 agent 有其他 agent 同時在工作。
6. **D6 GIT 解衝突**：Codex 解、R_max = 2（建議），或人工解。
7. **D7 MCE 門檻**：H1 +50 個百分點／W_det 比 ≤ 0.5；H3 減少 ≥ 20%；H4 makespan 非劣性 10%；H5 非劣性 5 個百分點。
8. **D8 L2 規模與小豆額度**：pilot 6 session 是否可以先跑；正式 240／120／60 session 哪一個；Codex 模型與推理等級。
9. **D9 論文主研究** — ✅ **已決定（文一，2026-10-31）**：v3 為主要研究；HIST-v2 降為次要研究，pilot-r3 作為合併同等性附帶證據。
10. **D10** 何時把本稿凍結成正式 prereg 目錄（governance 紀錄，需同意）。

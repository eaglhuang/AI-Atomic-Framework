# ATM 論文 2.0：真實開源歷史外部工作負載（HIST-PAIRS）預先登記計畫

| 欄位 | 內容 |
|---|---|
| 狀態 | **PRE-REGISTRATION 草稿 v0.1，待作者核准**。目前沒有挖資料、沒有跑任何實驗、沒有改 repo |
| 日期 | 2026-10-08（台北時間） |
| 依據 | `BENCHMARK_SURVEY_zh.md`（同目錄）；`atm-v2-harness/METRIC_DEFINITIONS.md`（r3、r4 的口徑）；STALE（arXiv:2609.25396） |
| 標籤規則 | 本計畫產生的所有 run 一律標「作者執行（author-executed），尚未獨立重現」。論文維持 DRAFT，不宣稱勝出 |
| 生效條件 | 作者核准，並完成 §6 的凍結封存之後，才可以進入 §7 的任何階段 |

---

## 1. 動機、引用 STALE、沿用與延伸

### 1.1 動機
論文 2.0 目前的 E4、barrier 和故障情境，工作負載全部是作者自己設計的。這份計畫改從知名開源專案的**真實 PR 歷史**抽出「同時開著、改到同一個檔案」的 PR 配對，把每個 PR 當成一個寫入者，在同一個 base 上同時送進五個 arm。這樣可以回應「情境是作者挑的」這類質疑。

### 1.2 STALE 的方法與引用
- Xia, Wu, Park. *Passes Alone, Fails Together: Benchmarking Semantic Coordination in Parallel LLM-Agent Development.* EXPRESS '26. arXiv:2609.25396，DOI 10.1145/3842650.3843171。Repo：https://github.com/illinoisdata/STALE-bench
- STALE 的建構規則（依論文 §3 和 repo README）：
  1. 收集已合併的 PR，只保留改動 1 到 12 個 runtime 原始碼檔的 PR（排除 docs、CI、格式化）。
  2. 兩個 PR 至少改到一個共同的原始碼檔，才配成候選對。
  3. shared base 取兩個 PR base 的 merge-base。
  4. 兩個 gold code patch 都要能套用到 base，而且合併時沒有文字衝突（clean merge）。
  5. base validity：每個 PR 的 fail-to-pass（F2P）測試，要在 base 加 test patch 時失敗，在 base 加 code 再加 test 時通過。
- STALE 的評分規則：每個條件（solo A、solo B、合併後）都跑**同一組合併後的測試集**，並丟掉 agent 對測試檔的修改。干擾 Δ = |F_merged \ (F_A ∪ F_B)|，也就是只計「各自單獨都過、合併後才失敗」的測試。

### 1.3 沿用的部分
- 同一個 shared base、至少改到一個共同檔案的已合併 PR 配對。
- 1 到 12 個原始碼檔的篩選，以及排除非程式碼檔。
- base validity 檢查，只用在語意終點（§5.6）。
- 評分規則：每個條件都跑同一組聯集測試，只計合併後才新出現的失敗。

### 1.4 延伸的部分
| 項目 | STALE | 本計畫 |
|---|---|---|
| 量什麼 | agent 盲合併造成的語意干擾 | 寫入層安全（遺失效果、損毀檔、被擋下的 intent），**再加上**語意回歸 |
| 文字衝突的配對 | 排除（約 36% 因文字衝突被剔除） | **保留**，獨立成「同一 hunk」分層。這正是寫入安全最需要測的情況：正確行為是擋下或安全合成，**不能靜默遺失** |
| 是否真的同時開著 | 沒要求 | **要求**兩個 PR 的開啟期間 [created_at, merged_at] 有重疊，代表歷史上真的平行開發過 |
| 專案 | Django（主），另有 SymPy、xarray、seaborn 少量 | 6 個知名 Python 專案，每個專案有樣本上限（§2） |
| 執行方式 | LLM agent 產生 patch | 不用 LLM。用 gold patch 決定性重播，加上 seed 控制的交錯順序，在多 process 下跑五個 arm |
| base validity 不通過的配對 | 剔除 | 寫入安全終點**照用**（因為不需要測試）；只從語意終點排除 |

### 1.5 授權處理
- STALE-bench 在 2026-10-08 用 GitHub API 查 `/license` 回 404，**repo 沒有授權檔**。另外，repo tree 只有 `instances/`、`patches/`、`results/` 和 README，README 提到的 `pdbench/` 挖掘程式碼**不在 repo 裡**（以 recursive tree 確認過，沒有任何 `.py` 檔）。
- 因此：**只引用 STALE 的方法，不重新散布它的資料，也不直接用它的 instances 或 patches。** 我們依論文和 README 的描述自己寫挖掘程式，從上游 git 歷史和 GitHub 公開 PR 資料重新產生配對。如果之後 STALE 補上允許散布的授權，可以另外加一個「與 STALE Django instances 交叉比對」的附錄，但不列入主結果。

---

## 2. 候選專案

### 2.1 可行性查證（2026-10-08）
以下授權、大小、主要語言、星數都來自 GitHub API；「2025 年合併 PR 數」來自 GitHub Search API 的 `is:pr is:merged merged:2025-01-01..2025-12-31`。測試執行時間我**沒有實測**，要在 pilot 量。是否需要編譯，依各專案一般已知的建置方式標註，也會在 pilot 確認。

| 專案 | URL | 授權（API） | repo 大小 | 2025 年合併 PR | 純 Python？ | 判斷 |
|---|---|---|---|---|---|---|
| Django | https://github.com/django/django | BSD-3-Clause | 約 283 MB | 795 | 是 | **主要**（STALE 的主要專案，可以對照） |
| SymPy | https://github.com/sympy/sympy | NOASSERTION（要人工確認 LICENSE） | 約 196 MB | 414 | 是 | **主要** |
| xarray | https://github.com/pydata/xarray | Apache-2.0 | 約 55 MB | 513 | 是 | **主要**（STALE 有少量） |
| pytest | https://github.com/pytest-dev/pytest | MIT | 約 42 MB | 477 | 是 | **主要** |
| Sphinx | https://github.com/sphinx-doc/sphinx | NOASSERTION（要人工確認） | 約 109 MB | 506 | 是 | **主要** |
| FastAPI | https://github.com/fastapi/fastapi | MIT | 約 55 MB | 545 | 是 | **主要（條件式）**：合併 PR 很多是文件翻譯，排除 docs 之後的程式碼 PR 數未知，pilot 量 yield，不足 20 對就降為候補 |
| pandas | https://github.com/pandas-dev/pandas | BSD-3-Clause | 約 416 MB | 1,221 | 否（Cython） | **候補**：寫入安全終點可以照跑；語意測試要在每個 base 重新編譯，成本高 |
| scikit-learn | https://github.com/scikit-learn/scikit-learn | BSD-3-Clause | 約 188 MB | 1,254 | 否（Cython） | **候補**，理由同 pandas |
| astropy | https://github.com/astropy/astropy | BSD-3-Clause | 約 188 MB | 883 | 否（含 C 擴充） | 候補 |
| matplotlib | https://github.com/matplotlib/matplotlib | API 回 None（要人工確認） | 約 492 MB | 808 | 否 | 候補 |
| requests | https://github.com/psf/requests | Apache-2.0 | 約 14 MB | 34 | 是 | 不列入：PR 太少，yield 預期極低 |
| Flask | https://github.com/pallets/flask | BSD-3-Clause | 約 12 MB | 26 | 是 | 不列入，理由同上 |
| httpx | https://github.com/encode/httpx | BSD-3-Clause | 約 9 MB | 29 | 是 | 不列入，理由同上 |
| seaborn | https://github.com/mwaskom/seaborn | BSD-3-Clause | 約 55 MB | 7 | 是 | 不列入，理由同上 |
| click | https://github.com/pallets/click | BSD-3-Clause | 約 5 MB | 124 | 是 | 不列入：CooperBench 已經用了 pallets 系列專案，避免重複 |
| CPython | https://github.com/python/cpython | NOASSERTION | 約 885 MB | 8,747 | 否 | **不列入**：要先建置直譯器，測試很重，大量改動是 C |
| Express（JS） | https://github.com/expressjs/express | MIT | 約 10 MB | 111 | JS | 第三階段選用附錄，不列入主結果 |
| axios（JS） | https://github.com/axios/axios | MIT | 約 30 MB | 180 | JS | 第三階段選用附錄 |

### 2.2 主要專案組（6 個）與上限
- **主要組：Django、SymPy、xarray、pytest、Sphinx、FastAPI**（FastAPI 是條件式，不足時依序由 pandas、scikit-learn 遞補）。
- 理由：
  - 都是知名專案，而且都是純 Python，每個 base commit 用 editable install 就能建環境，語意測試的成本可控。
  - 授權都是寬鬆授權。SymPy 和 Sphinx 的 API 回 NOASSERTION，凍結前要人工讀 LICENSE 確認。
  - 2025 年各有約 400 到 800 個合併 PR，兩年的時間窗應該足夠，但實際 yield 要等 pilot。
- **每個專案上限 60 對，目標 50 對，下限 20 對。** 低於 20 對的專案改列候補，由候補專案依序遞補到總數。
- **同一個 PR 在主樣本最多出現在 2 個配對中**，避免熱門 PR 主導結果。
- JS/TS（Express、axios）只當第三階段的選用附錄，因為公司情境和 harness 的主要驗證都是 Python。

---

## 3. 配對抽取規則（完全決定性）

### 3.1 時間窗與 PR 資格
1. **時間窗**：PR 的 `merged_at` 介於 **2024-01-01T00:00:00Z 到 2025-12-31T23:59:59Z**（依 GitHub API 的 UTC 時間）。
2. 只取 target 為預設分支的**已合併** PR（`merged_at` 不為 null）。關閉但沒合併的不收。
3. GitHub 的 PR 中繼資料（number、created_at、merged_at、base.ref、head.sha、merge_commit_sha）在抓取當天存成 `pr_snapshot.jsonl`，一起封存。之後一律以封存檔為準，不再即時查 API。
4. **PR 的 code patch** = `git diff --no-renames --diff-algorithm=histogram <mb_X> <head_X>`。其中 head_X 是 `refs/pull/N/head` 在快照中的 head.sha，mb_X = `git merge-base <head_X> <landing_X^1>`，landing_X 是快照中的 merge_commit_sha。這個做法對 squash、rebase、merge commit 三種合併方式都適用。PR 分支中途把 main 合併進來的那些變更，會因為 merge-base 前移而自動排除。
5. 如果 head.sha 已經 fetch 不到（例如被 force-push 刪除），就排除，記錄理由 `head-unavailable`。

### 3.2 檔案分類與排除
- **原始碼檔**：`.py`（JS 附錄用 `.js`、`.ts`、`.mjs`），而且路徑不符合以下任一條：
  - 測試：`tests/`、`test/`、`testing/`、`*_test.py`、`test_*.py`、`conftest.py`
  - 文件與中繼資料：`docs/`、`doc/`、`*.rst`、`*.md`、`*.txt`、`.github/`、`changelog*`、`release*notes*`、`AUTHORS*`
  - vendored 與第三方：`vendor/`、`_vendor/`、`vendored/`、`third_party/`、`externals/`、`extern/`
  - 產生檔：檔頭前 5 行含 `generated` 或 `DO NOT EDIT`，或副檔名是 `.min.js`、`*.lock`、`*.po`、`*.mo`
  - 二進位：`git diff --numstat` 顯示 `-`
- **測試檔**另存成 test patch，只給語意終點用，**不當成寫入 intent**（比照 STALE 丟掉測試修改、評分時再套 gold test patch 的做法）。
- **PR 層級排除**（每一條都記錄理由碼）：
  - 原始碼檔數不在 1 到 12 之間
  - 單一 PR 的原始碼變更行數（加加減）超過 **400 行**。這是本計畫自訂的門檻，目的是讓單次 run 可以控制；被排除的數量會照實回報
  - 改名、刪除整檔、模式變更、submodule 變更
  - 原始碼檔在 base 不是 UTF-8
- 新增檔案的 hunk 照樣算成 intent（它們不會被競爭），但「共同檔案」只看 base 中已經存在的檔案。

### 3.3 配對條件
1. 同一專案內兩個合格 PR，`[created_at, merged_at]` 有重疊。
2. 兩者至少有一個**共同原始碼檔**。
3. **shared base** b = `git merge-base <mb_A> <mb_B>`（比照 STALE）。
4. 兩個 code patch 都要能**各自**以 `git apply --check`（不允許 fuzz）套用到 b。不行的話排除，理由 `drift`。
5. 依共同檔案上的 hunk 位置（以 b 的行座標計）分層：
   - **O1 同一 hunk**：A、B 有任何 hunk 範圍相交或相鄰（距離 0）。
   - **O2 鄰近**：最小距離 1 到 3 行（落在 git 預設 context 內）。
   - **O3 同檔不同區域**：所有 hunk 距離都大於 3 行。
   - **O0 對照組**：沒有共同檔案，但開啟期間重疊。只抽少量，當零點。
6. 另外記錄獨立標籤 `git_merge_file_clean`：在每個共同檔案上，用 b 當 base 做 `git merge-file` 的結果是否乾淨。這個標籤只用來描述，不用來分層。
7. 每一對產生穩定的 `pair_id = {project}:{prA}_{prB}`（prA < prB）。

### 3.4 PR diff → ATM intent／效果
- **寫入者**：一個 PR 對應一個寫入者（agent）。主設定每對 2 個寫入者。
- **logical operation（intent）**：用 `git diff --unified=0 --diff-algorithm=histogram` 拆出的每一個 hunk 就是一個 intent，`logical_id = log:{pair_id}:{pr}:{path}:h{k}`。種類依 hunk 判定：純新增是 insert，純刪除是 delete，其餘是 replace。intent 記錄 b 上的行範圍、pre-image bytes、post-image bytes，以及前後各 3 行 context（給需要重新定位的 arm 用）。
- **提交單位**：同一個寫入者對同一個檔案的所有 hunk，在同一個 compose 窗內一起送出（模擬 agent 一次寫一個檔）。計數單位是 intent，所以恆等式「完成 + 遺失效果 + blocked = 總 intents」維持不變。
- **五個 arm**（定義沿用 `src/arms.mjs` 的 D5 凍結）：
  - `steward`：完整 ATM admit、ComposeWindowManager、composeBrokerProposals、applyStewardPlan
  - `file_lock`：每個檔案一個 mutex 的讀改寫
  - `occ`：CAS 加有上限的重試與重建
  - `git_three_way`：以 `git merge-file` 依序左折疊，有衝突就 blocked
  - `bare_composer`：同樣的合成與 steward apply，但繞過 admission
- **執行前必須完成的 harness 改動**（要另外開 PR，測試和 CI 都過才能凍結；本計畫只登記需求）：
  1. **hunk 工作負載載入器**：把上面的 intent 轉成 harness 的 insert、replace、delete 操作。
  2. **oracle_v2-hist**：現有 oracle_v2 依賴 fixture 裡的 `<region:…>` 標籤，真實檔案沒有這種標籤。延伸方式是用 hunk 範圍當虛擬區域，由 oracle 自己的 reference applier 依 b 加上已提交操作產生期望 bytes。frame 規則改成「b 上不屬於任何已提交操作範圍的行，必須逐位元組保留且順序不變」。原有 6 類契約案例必須照樣全過，另外新增 hist 專屬案例（replace、delete、相鄰 hunk、同一 hunk 兩邊都提交）。
  3. **occ arm 的重建**：目前是「在現有 bytes 上重建 marker 插入」，要一般化成「以 pre-image 加 context 精確定位後重新套用 hunk，找不到定位就 blocked」。
  4. **ATM 對真實 Python 檔的 atomization**：論文 1.0 說 atom-map 涵蓋不完整時會用 virtual atoms。真實檔案上是否能正常運作，**目前還沒驗證**，是 pilot 的第一個檢查項目。
- **ATM pin**：凍結當下最新、而且已 merge 的 main SHA，預期是 fix-pidns-broker 的 merge SHA，寫入 GENERATION.md。另外，5692474f（舊版）只跑 steward arm 當次要對照，用來看舊版反例在真實工作負載上是否重現。

### 3.5 並行排程
- **模式**：多 process（沿用 harness 的 `mp-runner`／`mp-worker`），因為 E4 的 lost write 就是在多 process 下出現的。
- **寫入者數**：主設定 2。延伸設定是 3 到 4 個開啟期間兩兩重疊、共用同一檔案的 PR 組，只在第三階段做，每個專案上限 10 組。
- **交錯**：沿用 E4 的 barrier 和 seed 機制（實際參數在凍結時從 harness 設定檔抄入 GENERATION.md）。
  - 每對跑 **S = 5 個 seed**：`seed_{pair,k} = uint32(SHA-256("hist-v1|" + pair_id + "|" + k))`，k = 0 到 4。
  - **seed 只由 pair 和 k 決定，與 arm 無關**，所以五個 arm 在同一 seed 下的送出順序、抖動、barrier 釋放都相同，可以逐 run 配對。
  - seed 控制三件事：兩個寫入者的啟動先後、到達間隔抖動（0 到 J ms，J 沿用 E4）、barrier 釋放順序。

---

## 4. 抽樣

### 4.1 種子與程序
- 候選對依 `(project, pair_id)` 字典序排序。
- 用 `numpy.random.Generator(PCG64(20261008))` 在每個專案內按分層（O1、O2、O3）做無放回抽樣。
  - 每個專案目標 50 對，三層盡量各三分之一。某一層不足時，依 O1 → O2 → O3 的順序由其他層補，補了多少照實記錄。
  - 抽樣同時遵守「每個 PR 最多出現在 2 對」：依抽中順序檢查，超過就跳過。
- O0 對照組：全部專案合計 30 對，每個專案 5 對，同一個種子。
- pilot 用的配對**不得**再進主樣本：pilot 先抽，主樣本從剩下的候選中抽。
- 抽樣腳本、候選清單、抽樣結果三者一起封存（§6）。

### 4.2 目標樣本數與理由
- **主樣本：6 個專案 × 50 對 = 300 對**（加上 30 對 O0）。每對 5 個 seed、5 個 arm，主矩陣共 300 × 5 × 5 = **7,500 runs**。
- 主要安全終點的單位是**配對**（同一對的 run 彼此相關，不能當成獨立樣本，見 METRIC_DEFINITIONS §0）。
  - **零事件上界**：如果 300 對都沒有任何失敗，失敗配對比例的 95% 單尾上界約 3/300 = 1.0%（rule of three；精確值 1 − 0.05^(1/300) = 0.99%）。雙尾 Clopper-Pearson 的上界是 1.22%。
  - **偵測力**：如果真實「每對至少出一次問題」的機率是 1%，300 對裡至少觀察到一次的機率是 1 − 0.99^300 ≈ 95.1%；機率是 0.5% 時約 77.8%。
  - **完成率的精確度**：以配對為單位，p = 0.5 時 Wilson 95% CI 的半寬約 ±5.6 個百分點；以 intent 計會更窄，但必須用配對叢集 bootstrap 修正。
  - 對照：240 對時零事件上界是 1.24%，偵測力 91%；400 對時是 0.75% 和 98.2%。選 300 是在成本（§7）和「1% 上界」之間的折衷。
- run 層級只當輔助：每個 arm 1,500 runs 零失敗時，雙尾上界是 0.25%。但因為 run 之間相關，**主文不能只用 run 層級的上界**。

---

## 5. 指標（照論文 2.0 的措辭規則）

每個 arm、每個專案、每個分層都報整數和比例。比例一律附分子、分母和彙總方式（ratio-of-sums）。

1. **完成 intent／總 intents**：ATM 回 `applied`，而且 oracle_v2-hist 判定效果確實在最終 bytes 中。不得改稱「成功率」或「全部成功」。
2. **失敗 runs／總 runs**：任一 intent 判定失敗、任一檔 frame 或 structure 違規、出現外來寫入、或有多餘檔（例如殘留 `*.atm-tmp`），該 run 就算失敗。
3. **遺失效果**：已 `applied`（ack）但效果不在最終 bytes。報「合計 N 個遺失效果」，和失敗 run 數分開。如果 O1 兩邊都 `applied`，但 oracle 無法證明兩個 post-image 都以正確順序存在、而且 frame 完整，就判為遺失或錯位，另外列 `overlap-both-applied` 子類，逐筆鑑識。
4. **blocked intents**：另列，並**依最終理由分列**：`steward-final-patch-required` 子類、`file-hash-drift`、`re-compose attempts exhausted…`、`recovery-required:`、git 衝突、occ 重試用盡等。恆等式「完成 + 遺失效果 + blocked = 總 intents」每一格都要驗證。
5. **損壞檔**：frame 或 structure 違規的檔案數，包含尾端撕裂。structure 對 `.py` 的定義是：如果 b、b+A、b+B 都能 `ast.parse`，最終檔也必須能 parse；只要其中任一個本來就不能 parse，structure 判 N/A，只看 frame。
6. **語意回歸（合併後才新出現的測試失敗）**：
   - 只在通過 base validity 的配對上，而且只在該 run 兩個 PR 的 intents **全部完成**時計算。其他情況標「不可評估」，不能算 0。
   - 測試集 T = F2P_A ∪ F2P_B（主），另外以兩個 test patch 動到的整個測試模組當輔助（P2P）。
   - 五個條件全部跑同一個 T：b+A、b+B、gold 合成（依序 `git apply` 兩個 code patch）、arm 最終樹，以及 b 本身。
   - **歸因到 arm 的回歸** = 在 arm 最終樹失敗、但在 b+A、b+B、gold 合成三者都通過的測試。
   - **gold 合成本身就失敗的測試**另外報成「資料集層級的歷史語意干擾」，不歸因給任何 arm。
   - flaky 測試的處理：solo 條件各跑 3 次，結果不一致的測試列入 flaky 名單並排除，名單照實公布。
   - 快取規則：如果 arm 最終樹的 hash 和 gold 合成相同，直接沿用 gold 的測試結果（前提是同 bytes 會得到同結果，已排除 flaky）。
7. **CI 與統計**：
   - 比例報 Wilson 95% CI（以配對為單位）和配對叢集 bootstrap 95% CI（10,000 次重抽，種子 20261008）。
   - 零事件報 Clopper-Pearson 上界，並註明 rule of three。
   - 延遲用線性插值的分位數；mean±sd 不算 CI。
8. **比較 arm 的規則**：
   - 只做描述性的逐 run 配對：同一 pair 同一 seed 下，完成數「較高、相同、較低」各有幾對，加上合計差。
   - **不做顯著性檢定，也不宣稱優越或不劣**。完成數沒下降，只能寫「本次觀察中未下降」。
   - 如果作者想做非劣性主張，必須在凍結前先寫好界限（見 §8 Q2），否則一律不寫。
9. **次要指標**（沿用 METRIC_DEFINITIONS）：offered、eligible、attempted、committed、unsafe_accept、false_reject、receipt completeness、goodput。eligible 用獨立政策 `hist-policy-v1`：O3 和 O0 判為應可合成，O1 判為不應兩邊都靜默提交，O2 判 N/A（政策差異只描述）。
10. 每個表都標「作者執行，尚未獨立重現」。CI（GitHub Actions）只驗證紀錄一致性，不重跑實驗，這點要另外寫明。

---

## 6. 凍結、不可變性、停止規則、偏離紀錄

### 6.1 執行前封存（新 generation：`paper-v2-hist-prereg-g1`）
內容：
- 本文件的核准版（v1.0）
- 挖掘與抽樣腳本，以及它們的語言和套件版本鎖定檔
- `pr_snapshot.jsonl`、候選清單（含每一筆排除理由碼）、抽中的配對清單（pilot 和主樣本分開）
- seed 公式和逐 run 的 seed 表
- 每個專案的 clone 來源 URL、抓取日期、相關 commit SHA
- ATM pin、harness pin、oracle_v2-hist 的版本和契約測試結果
- 預先寫好的分析腳本（analyze）
- 各專案的 LICENSE 副本和 NOTICE

格式比照既有的 generation：`GENERATION.md`、`MANIFEST.json`、`SHA256SUMS`，以及唯讀的 `verify.sh`（`sha256sum -c --strict`，可以在 sh 下跑）。tarball 要是決定性的，每個部分小於 25 MB。

上傳方式：透過 cloud agent 開 PR 到 `eaglhuang/AI-Atomic-Framework` 的 `research/paper-v2/`，同步更新 EVIDENCE_INDEX。依既有的常設授權，verify 和 CI 都通過才 merge。**merge 之後才能開始執行任何 run。** 不打 tag，不發 npm。

上游程式碼的散布：預設只封存 SHA 和 patch 的 SHA-256，必要的 patch 檔附原授權聲明（主要組都是寬鬆授權）。見 §8 Q3。

### 6.2 執行中與執行後
- 每個階段的原始輸出另封成新的 generation（例如 `paper-v2-hist-r1-pilot`、`-r1-main`），**不修改**已經封存的 generation。
- **停止規則（§5.7）**：
  - `steward` arm（也就是 ATM 主方法）出現任何遺失效果或損壞檔，就是**反例**。做法是：凍結該 run 的原始產物，跑完當前專案批次讓分母完整，**暫停後續階段**，回報作者並附鑑識。
  - 不在同一個 generation 中途修 ATM。修好後換新 pin、開新 generation，舊結果保留並照實報告，**不以完成率提升抵銷反例**。
  - 基準 arm 的遺失效果是預期中的結果，照實報告，不觸發停止。
- **harness 或 oracle 本身的錯誤**：暫停，寫進偏離紀錄。oracle 修正後，對所有已收集的 run 做 artifact-only 重新評分，新舊兩版結果並列。
- **偏離紀錄** `DEVIATIONS.md`：任何與本文件不同的做法，包括門檻、分層補位、專案遞補、跳過的配對、環境建置失敗，都要逐條記錄時間（台北時間）、理由、影響範圍，並在論文附錄全文列出。
- pilot 之後如果要改規則，先出 prereg v1.1 給作者核准、重新封存，才能跑主樣本。pilot 的配對不進主樣本。

---

## 7. 運算估計與分階段

### 7.1 估計（粗估，pilot 後重估）
- **寫入安全 run**：參考 r4 實測，2026-10-08 14:37 到 14:58 共 513 runs，約 21 分鐘牆鐘時間（平行度當時沒記錄）。假設真實檔案每 run 慢 2 到 5 倍（檔案更大、hunk 更多，**這是假設，沒有實測**）：
  - 主矩陣 7,500 runs、舊 pin 1,500 runs、O0 對照 750 runs，合計約 9,750 runs。
  - 約 6.6 小時（同 r4 速度）到 33 小時（慢 5 倍）。
- **語意測試**：每對至少 5 個條件，再加上與 gold 不同 hash 的 arm 最終樹，只跑 F2P 加相關模組。每個條件的時間（含環境）**未知**，假設 1 到 3 分鐘、8 路平行：300 對約 3 到 10 小時，另加建環境的時間。
- **挖掘**：主要組 6 個專案全量 clone（約 0.75 GB）並 fetch 候選 PR 的 `refs/pull/N/head`。GitHub API 呼叫量約數千次，**需要已認證的 token**，未認證每小時只有 60 次。
- **總計**：在 box 上大約 1 到 3 天的牆鐘時間，以 pilot 實測為準。

### 7.2 分階段
1. **階段 0：凍結前準備**（不跑實驗 run）
   - 確認 LICENSE（SymPy、Sphinx）
   - 透過 PR 完成 §3.4 的 harness 改動，契約測試和 CI 都要過
   - 寫挖掘和抽樣腳本，封存 prereg generation 並 merge
2. **階段 1：pilot（只做 Django）**
   - 30 對（O1、O2、O3 各 10）× 5 arm × 2 seed = 300 runs，加上語意測試
   - 同時對 6 個專案只做**挖掘**，量測各專案、各分層的 yield
   - 驗收條件：ATM 在真實 `.py` 檔上能 admit 和合成；oracle_v2-hist 沒有誤判（逐筆人工抽查 20 個 run）；恆等式全部成立；測得每 run 和每個語意條件的時間
   - 結果另封成 `-pilot` generation，**標成 pilot，不進主結果**
   - 回報作者
3. **階段 2：主樣本**（作者看過 pilot 之後才開始）
   - 6 個專案共 300 對、7,500 runs，加上舊 pin 和 O0
   - 依專案分批封存，並套用 §6.2 的停止規則
4. **階段 3：選用延伸**（要作者另外同意）
   - 3 到 4 個寫入者的 PR 組
   - JS 附錄（Express、axios）
   - pandas、scikit-learn 的語意終點（需要逐 base 編譯）

注意：這份計畫和先前說好「Phase 3（450 runs）不得未告知就開始」是兩件不同的事。本計畫每一個階段開始前同樣會先告知作者。

---

## 8. 需要作者決定的問題（只列真的需要的）

1. **Q1 專案組與規模**：主要組（Django、SymPy、xarray、pytest、Sphinx、FastAPI），每個專案 50 對、合計 300 對，可以嗎？JS/TS 先放第三階段附錄，可以嗎？
   - 預設：同意，JS 不進主結果。
2. **Q2 要不要事先設定比較性主張**：例如「steward 的完成率相對 file_lock 不劣於 −5 個百分點」這類非劣性界限，必須在凍結前寫死。
   - 預設：**不設，全部描述性**，符合現行措辭規則。
3. **Q3 上游 patch 的散布方式，以及要不要聯絡 STALE 作者**：
   - generation 內要附重新產生的 patch 檔（寬鬆授權，附 NOTICE），還是只放 SHA 和 hash、由腳本重新產生？
   - 要不要由你寄信詢問 STALE 的授權？這是對外動作，需要你決定寄不寄，以及寄給誰、內容是什麼。
   - 預設：附 patch 加 NOTICE；不聯絡 STALE，只引用方法。
4. **Q4 運算地點與 GitHub token**：在 box 上跑約 1 到 3 天，可以嗎？挖掘需要已認證的 GitHub API 存取，要用哪個 token 或什麼方式？
   - box 上目前沒有確認可用的 token，**我不會自行去找或讀取任何憑證**。

---

## 9. 已查證與未查證

- **已查證**：
  - 所有候選 repo 的 URL、授權欄位、大小、語言、2025 年合併 PR 數（GitHub API，2026-10-08）
  - STALE 的方法、評分規則、沒有 LICENSE、repo 裡沒有 `pdbench/` 程式碼（arXiv 頁、README、GitHub tree API）
  - harness 的 arm 定義和 oracle_v2 依賴 region 標籤（讀過 `src/arms.mjs`、`src/oracle_v2.mjs`）
  - r4 的 run 數和時間（`EXPERIMENT_CHECKLIST.md`）
- **未查證**：
  - 各專案測試執行時間
  - 主要組在 2024 到 2025 時間窗內的實際配對 yield，以及各分層的分布
  - ATM 在真實 Python 檔上的 atomization 行為
  - E4 的 barrier 和抖動參數實際值（凍結時從 harness 抄入）
  - SymPy、Sphinx、matplotlib 的實際 LICENSE 全文
  - 第 7 節的倍率假設

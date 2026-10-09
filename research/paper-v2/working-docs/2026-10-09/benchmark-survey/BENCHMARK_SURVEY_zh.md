# ATM 論文 2.0：公開 benchmark／資料集調查（草稿）

- 調查日期：2026-10-08（台北時間）
- 範圍：只做調查，沒有改 repo，也沒有開 PR
- 方法：用 WebSearch／WebFetch 查 arXiv 摘要頁，用 GitHub API 查 repo 是否存在與授權，用 Hugging Face API 列出資料集檔案。下表每一項都至少開過一個真實 URL。開不了或沒查證的地方會直接註明。
- 注意：2026 年的項目多半是 arXiv 預印本，尚未經同儕審查。文中引用的數字都是各論文自己報告的，我們沒有重跑。

---

## 0. 結論先講

1. **目前查不到能直接拿來跑、而且量的正好是 ATM 指標的公開 benchmark。** ATM 的指標是多 process 同時寫入時的遺失效果、檔案損毀、被擋下的 intent，以及 PID namespace、殘留暫存檔這類故障情境。現有公開 benchmark 大致分成三種，都不是量這個：
   - 整合後任務是否成功（CooperBench、STALE、NP-Bench）
   - 合併衝突的解法準不準（ConflictBench、ConGra、MergeBERT）
   - 一般 agent 的並行控制（CoAgent、S-Bus）。這一類最接近 ATM，但工作負載和指標都不一樣，而且 CoAgent 我沒找到公開程式碼。
2. **最值得採用的三個（按優先順序）：**
   - **CooperBench**（https://arxiv.org/abs/2601.13295 ，資料集 https://huggingface.co/datasets/CooperBench/cooperbench-dataset ，MIT）。當**工作負載來源**：用真實開源 repo 的「同一 base、多個 feature 的 gold patch 加測試」做決定性重播，五個 arm 都跑。另外，引用 ATM 的 Claim Plane（arXiv:2607.21909）已經用 CooperBench 做過 6 組的機制檢查，所以用它比較容易和相關工作對照。
   - **STALE-bench**（https://arxiv.org/abs/2609.25396 ，https://github.com/illinoisdata/STALE-bench ）。當**工作負載來源和評分方法**：447 組通過驗證、共用 base commit 的真實 PR 配對（Django、SymPy、xarray、seaborn），附 gold patch 和 F2P 測試。它的評分規則「每個條件都用同一組合併後的測試」可以直接拿來量語意干擾。**但 repo 沒有偵測到授權檔，使用前要先確認授權或聯絡作者。**
   - **Jepsen／Elle 的方法論**（https://jepsen.io/analyses ，https://arxiv.org/abs/2003.10554 ），加上 ALICE 和 CrashMonkey 的檔案系統故障測試。**只引用方法**：用操作歷史加上自動檢查器判定 lost update 這類異常，用故障注入找反例。ATM 的 oracle_v2 和 §5.7 停止規則可以明確對應到這套方法。
3. **可以把 ATM 自己的測試組釋出成公開 benchmark，當作論文的貢獻之一。** 但措辭要保守，例如「據我們所知，截至 2026-10，沒有公開 benchmark 專門量多 agent／多 process 寫入的遺失效果與檔案完整性」。**不要說「第一個」**，因為 CoAgent、S-Bus、STORM 都量過相近的東西（見 §3）。另外 ATM 論文 1.0 已經有 ATM-AdmissionBench，2.0 的測試組可以定位成它的延伸。

---

## 1. 總表

「適用度」的分類：
- **直接使用**：照原樣拿來跑
- **工作負載來源**：取出它的任務或 patch，轉成 ATM harness 的寫入 intent
- **只引用**：寫進相關研究或方法論
- **不適用**

| # | 名稱 | 年份 | 量什麼 | 有沒有並行／多 agent 寫入 | 授權／可取得性 | ATM 適用度 |
|---|---|---|---|---|---|---|
| A1 | CooperBench | 2026 | 兩個 agent 各做一個 feature，合併後跑測試是否成功 | 有（2 到 4 個 agent，同一 repo） | GitHub／PyPI／HF 資料集都標 MIT（底層 repo 各有授權） | **工作負載來源（首選）** |
| A2 | STALE（Passes Alone, Fails Together） | 2026 | 各自單獨能過、合併後才壞的語意干擾 | 有（平行 agent，盲合併） | GitHub 公開，**沒偵測到授權檔** | **工作負載來源，並採用它的評分方法** |
| A3 | NP-Bench（Nerveplane） | 2026-10 | 三種協調方式下能否乾淨整合、衝突數、浪費的程式碼行數 | 有（有決定性模擬 tier，也有 live agent tier） | FSL-1.1-MIT（不是 OSI 開源授權） | 只引用 |
| A4 | STORM | 2026 | 寫入當下的衝突控制（類似 OCC），比對 git worktree | 有（共用一個工作區） | 程式碼在 GitHub，**沒偵測到授權檔** | 只引用（相當於 occ arm 的旁證） |
| A5 | AgentRoom | 2026 | CRDT 共用工作區加檔案 claim | 有 | 只有論文和專案頁，沒確認到程式碼 repo | 只引用 |
| A6 | CodeCRDT | 2025 | 用 CRDT 讓多個 agent 同時產生程式碼 | 有 | 只確認到 arXiv 論文 | 只引用 |
| A7 | CAID（Effective Strategies for Asynchronous SWE Agents） | 2026 | git worktree 加 branch-and-merge 的多 agent 做法 | 有 | GitHub JiayiGeng/CAID（已用 API 確認存在，沒偵測到授權檔） | 只引用（相當於 git_three_way arm 的旁證） |
| A8 | CoAgent（MTPO） | 2026 | 多 agent 並行控制：serial、naive、2PL、OCC、MTPO，十種有競爭的工作負載 | 有 | arXiv，**沒找到公開程式碼** | 只引用（最接近 ATM 的問題設定） |
| A9 | S-Bus | 2026 | 透過 HTTP 共享狀態時的讀取集合重建與損毀計數 | 有 | GitHub sajjadanwar0/sbus，MIT | 只引用，損毀計數的方式可以借用 |
| A10 | MultiAgentBench | 2025 | 多 agent 合作與競爭（不是專門量寫入程式碼） | 有，但不是檔案寫入 | arXiv | 只引用或不適用 |
| B1 | AgenticFlict | 2026 | 真實 AI agent PR 的文字合併衝突（14.2 萬個 PR） | 間接（不同 PR 對同一 base） | MIT（GitHub），資料在 Zenodo | **工作負載參數來源**（衝突區塊大小分布） |
| B2 | ConflictBench | 2024 | 180 個 Java 合併衝突情境，評估合併工具 | 沒有（歷史資料） | GitHub 公開，**沒偵測到授權檔** | 只引用，或給 git_three_way arm 當困難案例 |
| B3 | ConGra | 2024 | 44,948 個衝突，依複雜度分級，評估 LLM 解衝突 | 沒有 | GitHub 公開，**沒偵測到授權檔** | 只引用 |
| B4 | MergeBERT 資料集 | 2022 | 歷史合併衝突與解法（訓練和測試用） | 沒有 | Zenodo（工具開不了，見 §4） | 只引用 |
| C1 | SWE-bench／Verified | 2023–2024 | 單一 agent 修 GitHub issue | 沒有 | MIT | 不能直接用；可以當工作負載來源（同 repo 配對） |
| C2 | SWE-bench Pro、SWE-bench-Live、Multi-SWE-bench、SWE-smith、SWE-Gym | 2024–2025 | 單一 agent 解題，或產生訓練資料 | 沒有 | 各自公開（見 §2） | 只引用，或當次要工作負載來源 |
| C3 | Commit0（Lite） | 2024 | 從零實作整個函式庫，直到測試通過 | 沒有，但 STORM 和 CAID 拿它跑多 agent | MIT | 選用：端到端 live tier |
| C4 | PaperBench | 2025 | 重現論文 | 沒有，但 STORM 和 CAID 拿它跑多 agent | arXiv | 不適用（成本高，又要 LLM 評分） |
| D1 | Jepsen／Knossos | 2013– | 分散式系統一致性測試：歷史紀錄加檢查器、故障注入 | 方法論 | 開源 | **只引用（首選方法論）** |
| D2 | Elle | 2020 | 從觀測到的歷史推斷 isolation 異常 | 方法論 | EPL-2.0 | **只引用** |
| D3 | A Critique of ANSI SQL Isolation Levels | 1995 | 定義 lost update（P4）等異常 | 定義 | arXiv 有掃描版 | 只引用（拿來定義「遺失效果」） |
| D4 | Hermitage | 2014– | 各資料庫 isolation 異常的測試案例 | 方法論 | GitHub 公開 | 只引用 |
| D5 | ALICE | 2014 | 應用程式的 crash consistency 漏洞 | 方法論 | GitHub 公開 | 只引用（對應殘留暫存檔、rename 原子性） |
| D6 | CrashMonkey／ACE | 2018 | 有界的黑箱 crash 測試 | 方法論 | Apache-2.0 | 只引用 |
| D7 | FoundationDB 決定性模擬 | 2021 | 用決定性模擬加故障注入做測試 | 方法論 | SIGMOD 論文 | 只引用（對應 seed 化重播） |

---

## 2. 逐項說明

### A. 多 agent 同時編輯同一份程式碼、協作寫程式

**A1. CooperBench: Why Coding Agents Cannot be Your Teammates Yet**
- URL：https://arxiv.org/abs/2601.13295 ；程式碼：https://github.com/cooperbench/CooperBench ；資料集：https://huggingface.co/datasets/CooperBench/cooperbench-dataset ；專案頁：https://cooperbench.com/
- 年份：2026 年 1 月（arXiv）
- 量什麼：652 個協作寫程式任務，來自 12 個開源函式庫，涵蓋 Python、TypeScript、Go、Rust 四種語言。每個任務把兩個可以各自實作、但沒協調就可能衝突的 feature 分給兩個 agent，最後合併 patch 再跑專家寫的測試。論文報告兩個 agent 合作的成功率平均比各自單獨做低約 30%，並稱之為「curse of coordination」。另外在 46 個任務上把 agent 數從 2 增加到 4，成功率從 68.6% 降到 46.5%，再降到 30.0%。
- 並行寫入：有。
- 授權：README 徽章和 PyPI 都標 MIT。HF 資料集的 card 也標 MIT，但它包含的 repo 程式碼保留各自原本的授權。我用 HF API 看過檔案列表，每個 task 目錄都有 `Dockerfile`、`combined.patch`、`run_tests.sh`，以及 `featureN/{feature.md, feature.patch, tests.patch}`。我依檔名粗略數到約 31 個 task 目錄、約 211 個 feature 目錄。652 這個數字應該是同一 task 內的 feature 兩兩配對，這只是推論，沒有查證。
- ATM 適用度：**工作負載來源（首選）**。每組 feature 都有同一 base 上的 gold `feature.patch`，不需要叫 LLM 就能做決定性重播，五個 arm 可以用完全相同的輸入比較。Claim Plane 已經用它做過 6 組的機制檢查，可以直接對照。

**A2. Passes Alone, Fails Together: Benchmarking Semantic Coordination in Parallel LLM-Agent Development（STALE）**
- URL：https://arxiv.org/abs/2609.25396 ；https://github.com/illinoisdata/STALE-bench
- 年份：2026（EXPRESS '26 workshop，DOI 10.1145/3842650.3843171）
- 量什麼：各自單獨能過、合併後才失敗的「語意干擾」。指標 Δ_blind 是「合併後才失敗的測試數，扣掉任何單一 patch 本來就會失敗的測試」。資料分三層：合成任務、真實 PR 配對、以真實 Django helper 建構的任務。論文報告：
  - 用確定性流程挖出 447 組真實 PR 配對，共用 base commit 都驗證過。
  - Django 的 417 組跑了 834 次，修正評分方法後只有 1 次出現干擾。
  - 建構任務出現干擾的比例是 97%（105/108），給一則訊息說明已完成的變更後，82% 的情況能恢復。
  - 論文自己強調，建構任務的失敗率不能代表實務上的發生頻率。
- 並行寫入：有（平行 agent 各自做，最後盲合併）。
- 授權：repo 有 `instances/`（control、django、requests、seaborn、sympy、xarray 的 jsonl）、`patches/` 和 `results/`。**GitHub API 沒偵測到授權檔。**
- ATM 適用度：**工作負載來源，並採用它的評分方法**。
  1. 真實配對的 patch 都改到至少一個共同的原始碼檔，正好可以拿來做同檔並行寫入。
  2. 它特別點出一個評分陷阱：單一 patch 和合併後如果用不同的測試集評分，會誤報干擾。這可以直接寫進 ATM 的語意評分規則。
  3. 使用前要先確認授權。

**A3. Verifying Coordination in Parallel Coding Agents: NP-Bench and a Scheduling Planner**
- URL：https://arxiv.org/abs/2610.07261 ；https://github.com/sumanyumuku98/Nerveplane
- 年份：2026 年 10 月，非常新
- 量什麼：比較三個 arm：不協調、事後偵測、事先排程。Tier A 是決定性模擬，Tier B 是 live agent，結果都用真實的 git merge 判定。論文報告：Tier A 的 9 個情境中，乾淨整合從 1/9 提升到 9/9，衝突從 13 降到 0。
- 授權：README 標 FSL-1.1-MIT，這是 Functional Source License，不是 OSI 認可的開源授權。
- ATM 適用度：**只引用**。它的情境是作者自己設計的，而且量的是整合結果，不是遺失或損毀。不過「決定性 tier 加 live tier」的分法和 ATM 一樣，可以當方法論上的對照。

**A4. Multi-agent Collaboration with State Management（STORM）**
- URL：https://arxiv.org/abs/2605.20563 ；https://github.com/dreamyang-liu/STORM
- 年份：2026
- 量什麼：在 Commit0-Lite 和 PaperBench 上，比較單一 agent、git worktree、STORM。STORM 是寫入時做版本檢查，類似 OCC：只要讀過的檔案已經過期就拒絕寫入，再把差異回傳給 agent。論文報告用 Sonnet 4.6 在 Commit0-Lite 的加權分數是 46.2，對比 git worktree 的 24.6。論文也自己列出限制：用 bash 直接寫檔可以繞過檢查，而且只能做到檔案層級的粒度。
- 授權：GitHub 沒偵測到授權檔。
- ATM 適用度：**只引用**。它是 occ arm 在任務層級的旁證。它承認的 bash 繞過問題，正好支持 ATM 為什麼要用 steward 獨占寫入路徑。

**A5. AgentRoom: Concurrent Multi-Agent Coding in a CRDT-Backed Shared Workspace**
- URL：https://arxiv.org/abs/2608.23740 ；專案頁 https://seongland.com/article/agentroom
- 年份：2026
- 量什麼：用 CRDT 讓多個 agent 共用工作區，再加上 MCP 提供的檔案 claim 和廣播，比較 Solo、parallel-merge、ChatDev 式流程等條件，主要用 LLM 評分。論文提到 parallel-merge 會發生「後寫入的 agent 靜默覆蓋前一個 agent 的檔案」，也就是 lost write 的實例。
- ATM 適用度：**只引用**，可以當「無協調時發生 lost write」的外部佐證。它的評分靠 LLM judge，不適合當作 ATM 的 oracle。

**A6. CodeCRDT: Observation-Driven Coordination for Multi-Agent LLM Code Generation**
- URL：https://arxiv.org/abs/2510.18893
- 年份：2025
- 量什麼：用 CRDT（Yjs）讓多個 agent 同時產生程式碼，共 600 次試驗（6 個任務）。論文報告 100% 收斂、字元層級零合併失敗，但初步檢查有 5% 到 10% 的語意衝突。
- ATM 適用度：**只引用**。可以用來說明「位元組層級不遺失，不等於語意正確」，所以 ATM 要分開報告位元組 oracle 和語意測試。

**A7. Effective Strategies for Asynchronous Software Engineering Agents（CAID）**
- URL：https://arxiv.org/abs/2603.21489 ；https://github.com/JiayiGeng/CAID
- 年份：2026
- 量什麼：中央 manager 分派工作，每個 engineer 在自己的 git worktree 做，最後 git merge，在 Commit0-Lite 和 PaperBench 上評估。論文報告，大家共用工作區、只靠 prompt 隔離時，PaperBench 的分數反而低於單一 agent。
- ATM 適用度：**只引用**，對應 git_three_way arm。

**A8. CoAgent: Concurrency Control for Multi-Agent Systems（MTPO）**
- URL：https://arxiv.org/abs/2606.15376
- 年份：2026
- 量什麼：把多 agent 修改共享狀態（git tree、K8s、文件）當成並行控制問題。在十種有競爭的工作負載上比較 serial、naive、2PL、OCC 和 MTPO。論文報告 MTPO 的正確性和 serial 相差不到 5%，速度是 1.4 倍；2PL 和 OCC 則幾乎抵銷了並行的好處。
- 可取得性：arXiv HTML 裡沒找到它自己的程式碼連結，**我沒確認到公開程式碼**。
- ATM 適用度：**只引用，相關研究一定要寫**。它的 arm（2PL、OCC）和 ATM 的 file_lock、occ 很接近，審稿人很可能會問兩者差在哪。

**A9. S-Bus: Automatic Read-Set Reconstruction for Multi-Agent LLM State Coordination**
- URL：https://arxiv.org/abs/2605.17076 ；https://github.com/sajjadanwar0/sbus （MIT）
- 年份：2026
- 量什麼：HTTP middleware 從 GET 流量重建 agent 的讀取集合，用 TLA+ 和 Dafny 做形式化驗證。論文報告在 884,110 次 commit 嘗試中 Type-I 損毀為零，並拿 PostgreSQL 17 SERIALIZABLE 和 Redis WATCH/MULTI 當安全性基準。
- ATM 適用度：**只引用**。兩種做法值得借用：一是拿成熟的資料庫當安全性基準，二是大量 commit 嘗試時用損毀計數當主要安全指標。

**A10. MultiAgentBench**
- URL：https://arxiv.org/abs/2503.01935 （2025）
- 量的是多 agent 的合作與競爭，不是同一份程式碼的檔案寫入。**只引用或不適用。**

（另外看到一篇 SSRN 預印本，"State Consistency in Concurrent LLM Agent Workflows…"，https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7472480 ，以及一篇 DEV Community 部落格，示範兩個 agent 改同一檔時的 lost update。兩者都沒經同儕審查，我也沒逐篇讀完，**不建議當主要引用**。）

### B. 合併衝突資料集（來自真實 git 歷史）

**B1. AgenticFlict**
- URL：https://arxiv.org/abs/2604.03551 ；https://github.com/unlv-evol/AgenticFlict （MIT）；資料：Zenodo DOI 10.5281/zenodo.19396916
- 年份：2026
- 量什麼：AI coding agent 所開 PR 的文字合併衝突。共 142,652 個 PR，其中 107,026 個成功模擬合併，29,609 個有衝突（27.67%），取出 336,380 個衝突區塊，每個區塊都有行範圍和 SHA-256。
- ATM 適用度：**工作負載參數來源**。它不是並行寫入，但可以提供真實 agent 改動的衝突區塊大小和檔案分布，用來校準 ATM 合成工作負載的重疊程度。這樣可以回應「重疊比例是作者自己挑的」這類質疑。

**B2. ConflictBench**
- URL：https://github.com/UBOWENVT/ConflictBench ；論文預印本 https://people.cs.vt.edu/nm8247/publications/bowen-jss-2024-preprint.pdf （JSS 2024，ASE 2024 journal-first）
- 量什麼：從 180 個 Java 專案各取一個 git-merge 衝突，人工標成 136 個真衝突、44 個假衝突，附開發者的實際解法，用來評估五個合併工具。
- 授權：沒偵測到授權檔。
- ATM 適用度：**只引用**。也可以挑幾個真衝突給 git_three_way arm 當困難案例，但它是單一歷史合併事件，不是並行寫入。

**B3. ConGra**
- URL：https://arxiv.org/abs/2409.14121 ；https://github.com/HKU-System-Security-Lab/ConGra
- 量什麼：從 34 個 C/C++、Java、Python 專案取出 44,948 個衝突，依複雜度分成 7 類，評估 LLM 解衝突的能力。
- ATM 適用度：**只引用**。它量的是解衝突的準確度，ATM 的主張是在寫入前就避免衝突或讓它安全失敗，兩者是不同層次。

**B4. MergeBERT（Program Merge Conflict Resolution via Neural Transformers）**
- URL：https://arxiv.org/abs/2109.00084 （ESEC/FSE 2022）
- 資料集：搜尋結果顯示是 Zenodo DOI 10.5281/zenodo.6366908，但我的工具開 Zenodo 頁面時被擋（403），**沒親自確認內容**。
- ATM 適用度：**只引用**。

### C. 一般 coding agent benchmark（可以當並行編輯的工作負載來源）

- **SWE-bench**：https://arxiv.org/abs/2310.06770 ，https://www.swebench.com/ ，https://github.com/SWE-bench/SWE-bench （MIT）。Verified 子集：https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified 。OpenAI 介紹 Verified 的頁面被擋（403），沒開到。
- **SWE-bench Pro**：https://arxiv.org/abs/2509.16941
- **SWE-bench-Live**（"SWE-bench Goes Live!"）：https://arxiv.org/abs/2505.23419
- **Multi-SWE-bench**：https://arxiv.org/abs/2504.02605 ，https://github.com/multi-swe-bench/multi-swe-bench （Apache-2.0）
- **SWE-smith**：https://arxiv.org/abs/2504.21798
- **SWE-Gym**：https://github.com/SWE-Gym/SWE-Gym （Apache-2.0）
- **Commit0**：https://arxiv.org/abs/2412.01769 ，https://github.com/commit-0/commit0 （MIT）
- **PaperBench**：https://arxiv.org/abs/2504.01848

適用度：
- 上面這些全部都是單一 agent、一次一個任務，**不能直接拿來量 ATM**。
- 拿 SWE-bench 系列的解題率當 ATM 的成效，會被質疑「解題率跟寫入安全有什麼關係」，不建議。
- 可行的用法和 STALE 一樣：在同一 repo、同一版本裡找兩個改到同一檔案的 instance，用它們的 gold patch 當並行寫入的工作負載。不過 STALE 和 CooperBench 已經把這件事做好並驗證過，**優先用它們，不必重新挖。**
- Commit0 可以當選用的端到端 live tier，因為 STORM 和 CAID 都拿它跑多 agent，可以對照。但這需要 LLM，成本高、不是決定性的，而且結果主要反映 agent 能力，不是寫入安全。

### D. 並行正確性測試方法論（可引用）

- **Jepsen**：https://jepsen.io/analyses ，https://github.com/jepsen-io/jepsen 。對真實系統注入故障（網路分割、程序暫停、時鐘偏移），記下每個操作的呼叫和結果，再用檢查器判定是否違反一致性模型。**Knossos**（https://github.com/jepsen-io/knossos ）是它的線性一致性（linearizability）檢查器。
- **Elle**：Kingsbury & Alvaro，"Elle: Inferring Isolation Anomalies from Experimental Observations"，https://arxiv.org/abs/2003.10554 ，PVLDB 14(3)，https://www.vldb.org/pvldb/vol14/p268-alvaro.pdf ；程式碼 https://github.com/jepsen-io/elle （EPL-2.0）。它從可觀察的歷史推出依賴圖，找出循環就判定為異常，不必窮舉所有交錯順序。
- **Berenson et al., "A Critique of ANSI SQL Isolation Levels"**（SIGMOD 1995）：https://arxiv.org/abs/cs/0701157 。這篇定義了 P4 Lost Update 等異常，可以拿來給 ATM 的「遺失效果」一個標準定義。
- **Hermitage**：https://github.com/ept/hermitage 。用一組可重跑的小案例，系統性測試各資料庫的 isolation 異常。ATM 的 E4 和 F6 反例集可以比照這種形式。
- **ALICE**（Pillai et al., OSDI 2014, "All File Systems Are Not Created Equal"）：https://www.usenix.org/conference/osdi14/technical-sessions/presentation/pillai ；https://github.com/madthanu/alice 。研究應用程式在 crash 時因寫入、rename、fsync 的順序錯誤而產生的漏洞，可以直接對應 ATM 的「寫 temp 再 rename」和殘留暫存檔反例。
- **CrashMonkey／ACE**（Mohan et al., OSDI 2018）：https://www.usenix.org/conference/osdi18/presentation/mohan ；https://github.com/utsaslab/crashmonkey （Apache-2.0）。有界的黑箱 crash 測試。
- **FoundationDB 決定性模擬**（SIGMOD 2021）：論文 PDF https://www.foundationdb.org/files/fdb-paper.pdf ，DOI 10.1145/3448016.3457559（ACM 頁面擋工具，我是從 foundationdb.org 的 PDF 和搜尋結果確認）。用 seed 驅動的決定性模擬加故障注入。ATM 用 seed、barrier 重播的做法可以引用這篇當先例。

ATM 適用度：全部**只引用**。這些是方法論，不是工作負載。論文 2.0 可以這樣寫 ATM 的評估法：「仿照 Jepsen／Elle：記錄每個 intent 的操作歷史，用自動 oracle 判定 lost update（P4）與損毀；仿照 ALICE／CrashMonkey 注入 crash、殘留暫存檔、PID namespace 等故障」。這樣比較容易被系統領域的審稿人接受。

---

## 3. 有沒有「專門的」benchmark？

逐一檢查 ATM 論文 2.0 的指標：

| ATM 指標 | 有沒有公開 benchmark 直接量這個 |
|---|---|
| 同時寫入時遺失效果（lost effect）的數量 | 沒有專門的。AgentRoom 只觀察到 parallel-merge 會覆蓋；CoAgent 和 S-Bus 量的是正確性和損毀，但工作負載不是寫程式碼的檔案，或程式碼沒公開 |
| 位元組、結構層級的檔案損毀 | 沒有針對寫程式碼的。S-Bus 有 Type-I 損毀計數，但對象是 HTTP 共享狀態 |
| 被擋下的 intent 和完成率並列 | 沒有 |
| 多 process、跨 PID namespace 的鎖存活性，殘留 temp 檔 | 沒有。最接近的是 ALICE、CrashMonkey，但它們是一般應用程式的 crash 測試方法論 |
| 五個 arm（steward、file_lock、occ、git_three_way、bare_composer）用同一組輸入比較 | 沒有。CoAgent 有 2PL 和 OCC，STORM 有 OCC，CAID 有 worktree，但沒有人把這些放在同一組重播輸入上比較 |

結論：**據我查到的範圍，截至 2026-10-08，沒有公開 benchmark 專門量「多 agent／多 process 同時寫入程式碼時的遺失效果、檔案完整性與被擋下的 intent」。** 因此釋出 ATM 的測試組（E4、F6、殘留暫存檔反例、seed、oracle_v2、verify.sh、五個 arm 的轉接層）可以算一項貢獻。

建議措辭：「我們釋出一套可重現的寫入安全 benchmark，並以公開資料集（CooperBench／STALE）作為工作負載來源」。**不要寫「第一個」。** 理由：CoAgent、S-Bus、STORM 都在相近問題上做過量測，搜尋也可能漏掉沒被索引的工作。

---

## 4. 建議：前三名，以及怎麼接進 ATM harness

### 建議 1：CooperBench 當主要的外部工作負載（決定性重播）
- **取出工作負載**：
  1. 從 HF 資料集讀出每個 task 的 base（Dockerfile 加 setup.sh 固定的 commit），以及各 feature 的 `feature.patch` 和 `tests.patch`。
  2. 把每個 feature patch 依檔案、hunk 拆成 ATM 的寫入 intent，同一 task 內兩兩配成 composer 輸入。
  3. 依重疊類型分層：不同檔案、同檔但區域不重疊、同一區域。
  4. 用 ATM 現有的 seed 和 barrier，把兩個以上的 intent 同時送進五個 arm。
  5. 要測 N > 2 時，從同一 task 取 3 到 4 個 feature。
- **Oracle**：
  1. 位元組和效果 oracle：沿用 oracle_v2。每個 gold hunk 的效果都必須在最後的檔案中，少一個就記一個 lost effect；框架或結構檢查沒過就記 corruption。
  2. 語意 oracle：在最後的 tree 上跑**所有相關 feature 的 tests.patch 聯集**，比照 STALE 的規則，每個條件都用同一組測試。
  3. 被擋下的 intent 照現有定義另列，不算成失敗也不算成成功。
- **指標**：沿用論文 2.0 的四欄（完成的 intent／總 intent、失敗的 run／總 run、遺失效果、被擋下的 intent），再加一欄「語意干擾 Δ」，定義同 STALE。
- **抽樣**：先用固定 seed 隨機抽出要跑的 pair，抽樣腳本和抽樣結果在執行前就放進證據 generation，相當於事先登記。這樣可以避免被質疑挑了對 ATM 有利的任務。
- **好處**：不需要 LLM，成本低、結果是決定性的、別人可以重現。而且能和 Claim Plane 的 CooperBench 機制檢查對照。
- **限制**：CooperBench 的 pair 原本是為了量「agent 協作能力」設計的。用 gold patch 重播只量寫入層，不量 agent 規劃能力，論文裡要講清楚。

### 建議 2：STALE 的真實 PR 配對當第二個工作負載，並採用它的評分規則
- 用 `instances/*.jsonl` 裡已經驗證過的 shared base 和兩個 PR 的 gold patch，做同樣的決定性重播。這些配對都至少改到一個共同的原始碼檔，正好可以測同檔並行寫入。
- 評分直接採用它的修正規則：丟掉 agent 對測試檔的修改，每個條件都跑合併後的測試集，只把「各自單獨都過、合併後才失敗」的測試算成干擾。
- **前提：先確認授權。** repo 沒偵測到授權檔，要先問作者，或只引用而不重新散布它的資料。

### 建議 3：方法論引用 Jepsen／Elle、Berenson P4、ALICE／CrashMonkey
- 論文寫「遺失效果」時引用 Berenson 的 P4 定義；寫 oracle 和反例搜尋時引用 Jepsen／Elle 的「歷史紀錄加自動檢查器」；寫殘留暫存檔、rename、crash 故障時引用 ALICE 和 CrashMonkey；寫 seed 化重播時引用 FoundationDB。
- 可以考慮把 ATM 每次 run 的操作記錄輸出成類似 Elle 的歷史格式（intent 呼叫、結果、base hash、寫入 hash），寫一個獨立的檢查器重新判定 lost update。這樣審稿人或外部重現者就不必相信 ATM 自己的統計程式。

### 次要選項
- **AgenticFlict**：取它的衝突區塊行數分布和每個 PR 的衝突檔案數，給 ATM 的合成工作負載當參數，並在論文中說明參數來源。
- **ConflictBench**：挑一小部分真衝突，示範 git_three_way 在真衝突時會怎麼停下來或出錯，只放附錄。
- **Commit0-Lite**：之後如果要做 live agent 的端到端 tier，可以和 STORM、CAID 對照。但成本高、不是決定性的，不建議放進論文 2.0 的主要結果。

---

## 5. 對論文 2.0 寫法的影響（建議）

1. 外部工作負載的結果要和 author-executed 的 483 次分開列，並且一樣標成「作者執行，尚未獨立重現」。
2. 如果採用 CooperBench／STALE，要寫清楚：工作負載來自公開資料集，但重播和評分是 ATM harness 做的。這**不等於**第三方 benchmark 的成績。
3. 相關研究要補上 CoAgent、S-Bus、STORM、AgentRoom、CodeCRDT、CAID、NP-Bench、STALE、CooperBench，說明 ATM 的差別：寫入前的准入（pre-write admission）、steward 獨占寫入路徑、量的是遺失和損毀而不是任務成功率。
4. 「目前沒有專門 benchmark」這句話要加上日期和「據我們所知」。

---

## 6. 查證紀錄與不確定處

- arXiv 標題和日期是用 export.arxiv.org API 查的：2601.13295、2609.25396、2610.07261、2608.23740、2605.20563、2510.18893、2603.21489、2606.15376、2605.17076、2604.03551、2409.14121、2109.00084、2310.06770、2412.01769、2504.01848、2504.02605、2505.23419、2504.21798、2509.16941、2503.01935、2003.10554、cs/0701157 都存在，標題也符合。
- 用 GitHub API 查到 repo 存在的有：STALE-bench、Nerveplane、STORM、AgenticFlict、ConflictBench、ConGra、SWE-bench、commit0、jepsen、elle、hermitage、crashmonkey、alice、CooperBench、multi-swe-bench、SWE-Gym、sbus。授權欄位寫 None 或 NOASSERTION 的，表示 API 沒判讀出標準授權。其中 CooperBench 的 README 和 PyPI 標 MIT，Nerveplane 的 README 標 FSL-1.1-MIT，其他的我沒逐一讀 LICENSE。
- 開不了的頁面（被擋 403，不代表不存在）：OpenAI 的 SWE-bench Verified 介紹頁、Zenodo 的 MergeBERT 頁面、ACM DL 的 FoundationDB 頁面。
- CooperBench 的 task 和 feature 數量是我依 HF 檔名粗算的，可能有誤差。652 是 feature 兩兩配對，這是推論。
- CoAgent 沒找到公開程式碼。CAID 的 GitHub repo（JiayiGeng/CAID）已用 API 確認存在，沒偵測到授權檔。AgentRoom 只確認到論文和專案頁。
- 搜尋不是窮舉，可能還有沒被索引的相關工作。

# PR 開出後衝突比例與解衝突成本：實證整理（2026-10-15）

本報告的數字全部來自我實際讀過的 PDF 全文（用 pdftotext 抽出），頁碼是 PDF 的頁序。
Ghiotto 只讀了預印本，Brun 讀的是作者主頁上的版本。

## 結論先講
- **沒有任何一篇來源支持「大部分（>50%）PR 會衝突」。** 讀過的來源裡，衝突率大多落在 17%–28%，最高的是跨代理配對的 41.7%。Ghiotto 的引言提到「部分專案將近 50%」，那是轉引二手資料，而且只是個別專案。
- 有實證支持的說法是：衝突**常見**（約 1/5 到 1/4），而且是**有成本的**，包括解衝突的時間、衝突存活的天數，以及更高的 bug 機率。不過，代理 PR 的衝突成本目前**沒有人直接量過**；2607.04697 §6.2 明說那部分只是假設。
- 對 ATM 比較有力的論點：Brun 發現 VCS 回報「乾淨合併」的案例中，有 33% 其實帶有 build 或 test 衝突（見 B 段）。這表示只看文字衝突，會低估成本。

## A. 代理 PR

### A1. AgenticFlict — arXiv:2604.03551（https://arxiv.org/abs/2604.03551）
- 母體：142,652 個代理 PR，成功模擬了 107,026 個。對每個 PR 和它的 base branch 做確定性 merge 模擬（p.5 Table 1）。
- **衝突率 27.67%**：分母是 29,609 + 75,924 = 105,533 個有結果的 PR（Table 1，p.5）。原文：「27.67% of PRs result」(p.4)。
  - 注意：Table 1 列的成功模擬數是 107,026，跟衝突加乾淨的總和 105,533 對不上，原文沒有解釋差額。
- 每個衝突 PR 平均有 4.36 個衝突檔（中位數 2），平均 11.36 個衝突區塊（Table 1，p.5）。
- 各代理（Table 2 / Fig.3，p.5）：
  - Copilot 15.43%、Cursor 20.06%、Devin 23.04%、Claude_Code 26.86%、OpenAI Codex 32.31%。
  - 原文：「OpenAI Codex shows the highest conflict rate at 32.31%」。
- PR 大小（Fig.5，p.5）：
  - churn 中位數約 2 行的組，衝突率約 9.9%；約 25 行的組接近 30%。
  - 中型 PR（46–185 行）穩定在 32–33%。
- 成本：只有衝突的嚴重度（衝突行數、檔數），**沒有量解衝突的時間**。
- 這篇的 Related Work（p.6）把 Brun 轉述成「frequent and costly」，也轉引 Ghiotto 的「nearly 20% of merges require manual intervention」。

### A2. AI Agent PRs on GitHub — arXiv:2607.04697（https://arxiv.org/abs/2607.04697）
- 母體：AIDev-pop，2,807 個 repo 中的 33,596 個代理 PR。這篇量的是**同時活躍的兩個代理 PR 之間**的衝突（PR 對 PR，不是 PR 對 base）。
- 共時性（Abstract，p.1）：
  - 嚴格時間重疊下，40.2% 的 repo 有共時的代理 PR 配對，這些配對涵蓋 **79.4%** 的代理 PR。
  - 用一週時間窗口算，比例分別是 53.4% 和 95.0%。
  - ⚠ 這裡的 79.4% 是「有共時重疊」的比例，**不是衝突率**，不能拿來說「大部分 PR 會衝突」。
- 衝突率（§5，p.3；git merge-tree 三方重播，每個 repo 取一對）：
  - 同代理配對 **19.8%（119/601，95% CI 16.8–23.2%）**。
  - 跨代理配對 **41.7%（48/115，95% CI 33.1–50.9%）**。
  - 評估範圍：716/747 對可評估，佔 95.8%。
- 衝突結構（p.4，Fig.3）：
  - 按衝突類型：content 57.6%、modify/delete 26.8%；約 42% 屬於結構性衝突（modify/delete 或 add/add）。
  - 衝突檔案中，原始碼佔 84.4%。
- 成本：§6.2（p.5–6）原文：「In this paper we do not measure CI/CD logs, token usage, or maintainer time; therefore, the examples provided below are hypothesized outcomes」。也就是說，CI、token、維護者疲勞這些成本**都是假設，沒有量測**。
- 作者自己說這些數字是「conservative lower bounds」（Abstract）。
- 使用者記得「大部分 PR 會衝突」，很可能是把 79.4% / 95.0% 的**共時率**記成了衝突率。

## B. 經典文獻（人類開發者）

### B1. Brun, Holmes, Ernst, Notkin, "Proactive Detection of Collaboration Conflicts", ESEC/FSE 2011
DOI: https://doi.org/10.1145/2025113.2025139

- 母體：9 個開源系統。
- 頻率：
  - **17%** 的 merge 有文字衝突，分母是 3,562 次 merge（564/3,562；§4.1、Fig.4，p.3）。原文：「one in six, or 17%, had textual conflicts」。
    - Fig.4 合計列寫的是 16%；Conclusion 也寫「16% of all merges required human effort」(p.10)。
  - 可提早合併的時點中，19% 會有文字衝突（55,498/292,921，Fig.5）。
- 高階衝突（§4.2，p.4；Git、Perl5、Voldemort 三個系統，共 5,355 次 merge）：
  - 76% 乾淨合併、16% 文字衝突、1% build 失敗、6% test 失敗。
  - 原文：「33% of the 399 merges that the version control system reported as being a clean merge, actually were a build or test conflict」。
- 成本／持續時間（§4.3，p.4；Gallery3、Insoshi、MaNGOS、Voldemort 四個系統）：
  - 文字衝突平均存在 **9.8 天**、跨 23.2 個 changeset，中位數 1.6 天。最長的一例是 334 天。
- 原文：「conflicts are the norm」(p.3)。⚠ 這句指的是「開發者副本之間不一致」是常態，**不是指大部分 merge 都衝突**。
- 原文轉引 Zimmermann 的 CVS 研究：23%–47% 的 merge 有文字衝突（p.3，屬二手資料）。

### B2. Ghiotto, Murta, Barros, van der Hoek, "On the Nature of Merge Conflicts", IEEE TSE 46(8), 2020
DOI: https://doi.org/10.1109/TSE.2018.2871083

- 母體：2,731 個 Java 專案，共 25,328 次失敗 merge。
- 失敗 merge 的分母（總 merge 數）我沒有從抽出的文字找到，所以**不報它自己的衝突率**。
- 引言轉引（p.1）：「it has been reported that 10% to 20% of all merges fail ..., with some projects experiencing rates of almost 50%」。這是二手資料，不是本研究的量測結果。
- 結構：
  - 40% 的失敗 merge 只有 1 個衝突區塊，90% 不超過 10 個。
  - 60% 的失敗 merge 有多個衝突區塊。

### B3. Brindescu, Ahmed, Jensen, Sarma, "An empirical investigation into merge conflicts and their effect on software quality", EMSE 2020
DOI: https://doi.org/10.1007/s10664-019-09735-4

- 母體：143 個開源專案。
- **19.32%**，也就是 36,122 次 merge 中有 6,979 次衝突（§4.1，p.16）。原文：「almost 1 in 5 merges resulted in conflicts that required human intervention」。
- 至少 75.23% 的衝突需要開發者思考程式邏輯才能解決（p.16）。
- 品質成本（Abstract，p.1）：
  - 與衝突相關的程式碼出 bug 的機率是兩倍。
  - 需要手動介入的衝突，相關程式碼出 bug 的機率高 26 倍。

### B4. Vale et al., "Challenges of Resolving Merge Conflicts: A Mining and Survey Study", IEEE TSE 2022
DOI: https://doi.org/10.1109/TSE.2021.3130098

- 母體：66 個 GitHub 專案、約 81,000 個 merge scenario，另外問卷調查了 140 位開發者。
- 解衝突時間（§3.2.1、Fig.3，p.6）：
  - 中位數 **697 秒（約 11 分鐘）**。
  - Q1 是 149 秒，Q3 是 6,372 秒（約 1.77 小時）。
  - 最長約 530 天，屬於離群值。
- 時間主要受 merge scenario 的規模（LoC、chunks、files）影響，衝突本身的規模影響較小。
- 轉引 Brindescu 等人的觀察研究：7 位開發者解 10 個衝突，每個花 40–2,190 秒。

### 未讀全文、未列數字
- Nelson et al. (EMSE 2019)〈life-cycle of merge conflicts〉：搜尋摘要提到延後處理衝突的比例，但我沒讀全文，所以不引用。
- 巴西開發者問卷（JSERD）：搜尋摘要有「80.7% 在 24 小時內解完」，但我沒讀全文，所以不引用。

## C. 分類

**支持「衝突常見、而且有成本」：**
- AgenticFlict 27.67%（Codex 32.31%，中型 PR 32–33%）。
- 2607.04697 同代理 19.8%、跨代理 41.7%。
- Brun 17%／16%；另有 33% 的「乾淨」merge 其實帶有 build 或 test 衝突；衝突平均存在 9.8 天。
- Brindescu 19.32%；bug 機率 2 倍、手動介入的衝突 26 倍。
- Vale 解衝突時間中位數 11 分鐘，Q3 約 1.77 小時。

**不支持「大部分 PR 會衝突」，或容易被誤讀成支持的數字：**
- 2607.04697 的 79.4% / 95.0%：這是共時率，不是衝突率。
- Brun 的「conflicts are the norm」：講的是副本不一致是常態。
- Ghiotto 的「almost 50%」：只是部分專案，而且是二手轉引。
- 所有實測衝突率都低於 50%。最高的跨代理 41.7%，95% CI 上限 50.9%，樣本只有 115 對。

**建議論文措辭：** 「代理 PR 有約 1/5 到 1/4 與 base 或並行 PR 文字衝突，跨代理配對約 2/5。人類研究顯示衝突需要人工介入、平均存在約 10 天，而且與更高的 bug 率相關。另外，約 1/3 的『乾淨』合併其實帶有 build 或 test 衝突。」不要寫「大部分 PR 會衝突」。代理場景的解衝突成本，目前沒有人量測過，正好是 ATM 實驗可以補上的缺口。

---

## D. 追加：新聞／GitHub 官方統計搜尋（2026-10-15 19:05 搜尋）

搜尋範圍：GitHub blog、Octoverse、GitHub Next、The Register、InfoQ、TechCrunch、iThome、HN，以及中文關鍵字。
結論：**沒有找到 GitHub 官方或主流科技媒體發布「極高比例 PR 會衝突」的數字。** 搜到的數字都可以追回 D3 列的學術論文。

### D1. GitHub 官方（以下網址都用 curl 確認回 200）
- **Octoverse 2025**，GitHub Blog
  - 網址：https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
  - 數字：「merged 43.2 million pull requests on average each month (+23% YoY)」；Copilot coding agent 在 2025 年 5–9 月建立了 1M+ 個 PR。
  - **沒有衝突率。**
- **GitHub merge queue is generally available**，GitHub Blog（2023 年 7 月 GA）
  - 網址：https://github.blog/news-insights/product-news/github-merge-queue-is-generally-available/
  - 只有質性描述：「potentially running into code conflicts, and then spiraling into a cycle of rework」。
  - **沒有數字。**
- **How GitHub uses merge queue to ship hundreds of changes every day**，GitHub Engineering Blog
  - 網址：https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/
  - 成本軼事：「developers could wait 8+ hours after joining a train for it to ship, only for it to be removed due to a conflict between two pull requests in the train」。
  - 數字：每月 2,500 個 PR；平均等待時間降 33%。這是**等待時間，不是衝突率**，而且只是 GitHub 自家 monorepo。
  - 這篇可以當「衝突造成排隊成本」的業界佐證，但沒有比例數字。

### D2. 二手轉述網站（非主流媒體）
- **agentpatterns.ai〈Concurrent Agent Pull Requests and Merge-Conflict Cost〉**（WebFetch 確認可讀，頁面沒標日期）
  - 網址：https://agentpatterns.ai/workflows/concurrent-agent-pr-merge-conflicts/
  - 原文：「Concurrent, overlapping agent PRs are the norm — 79.4% of agent PRs are co-active with another agent PR」。
  - **79.4% 是共時率，不是衝突率。** 同一頁也正確列出衝突率：同代理 19.8%、跨代理 41.7%。
  - 原始來源：arXiv:2607.04697。
  - 這種「the norm + 79.4%」的寫法，很容易被記成「大部分 PR 會衝突」。**這最可能是使用者記憶的來源。**
- **wal.sh〈2026 agentic software engineering〉**（200）
  - 網址：https://www.wal.sh/research/2026-agentic-software-engineering/index.md
  - 只轉述 27.67% 和 79.4%，並註明 2607.04697 的成本「hypothesized ... they did not measure them」。
- 主流媒體 The Register、InfoQ、TechCrunch、iThome，以及 HN：搜尋**沒有找到**相關報導。
  - 搜尋索引可能不完整，所以這只能說「沒找到」，不等於「不存在」。

### D3. 新發現的一次來源：Campos Junior & Murta, "How AI Coding Agents Resolve Merge Conflicts: An Empirical Study", SBES 2026（2026-09-08–11）
- PDF（已下載並讀過全文）：https://cbsoft.sbc.org.br/2026/data/papers/sbes/How%20AI%20Coding%20Agents%20Resolve%20Merge%20Conflicts%20An%20Empirical%20Study.pdf
- 資料來源：AIDev，210,902 個 in-scope 代理 PR。量的是 PR **內部**的 merge commit，例如把 base 合回 PR 分支。

Table 1（§5.1）：

| 量測 | 數字 | 分母 |
|---|---|---|
| 會產生衝突的 internal merge | **29.5%**（14,960 / 50,700） | merge commit 數 |
| 至少有一次衝突 merge 的 PR | **59.1%**（7,268 / 12,299） | **只算「有內部 merge 的 PR」** |
| 同上，換成全部 PR | **3.4%**（7,268 / 210,902） | 全部 in-scope PR |

- 原文：「7,268 (3.4%) contain at least one conflicting merge, indicating that internal merges are the exception」。
- ⚠ **59.1% 是唯一超過一半的數字，但分母是被條件篩過的。** 只有 5.8% 的 PR 有內部 merge，在這群 PR 裡有 59.1% 碰到衝突。換成全部 PR 只有 3.4%。所以**這也不支持「大部分 PR 會衝突」**。
- 成本與解衝突者：衝突 merge 中有 **96.1%（14,381 / 14,960）由人類 commit**，代理自己解的只有 3.1%（462 筆）。
  - 原文：「agents rarely resolve the conflicts they produce」。
  - 這可以當成「代理 PR 的衝突要由人類付成本」的直接證據。

### D 小結
- 沒有 GitHub 官方或主流媒體的「高比例 PR 衝突」數字。
- 使用者的印象最可能來自 agentpatterns.ai 這類轉述把 79.4% 共時率寫成「the norm」，或來自 SBES 2026 的條件式 59.1%。
- 兩者都**不是**「全部 PR 中多數會衝突」。
- 可以引用的成本證據要補一條：SBES 2026 的「96.1% 由人類解」。

# ATM 論文 2.0 參考文獻集（2026-10-15）

這個資料夾收錄相關度評為高或中的論文、ATM v1 本身，以及閱讀過程中核對過的相鄰工作。相關度與理由都出自上一層目錄的 `related-papers-2026-10-15.md`，章節編號指的是論文 2.0 工作稿（`ATM_PAPER_V2_DRAFT_zh.md`）的章節。所有 arXiv ID、標題與作者都在 arXiv 摘要頁核對過。

PDF 是否放進資料夾，依 arXiv 頁面標示的授權決定。CC BY、CC BY-SA、CC BY-NC-ND 允許原樣轉存，所以放了 PDF（CC BY-NC-ND 只能非商業、不得改作）。標示為 arXiv 非專屬散布授權（nonexclusive-distrib 1.0）的論文，只授權 arXiv 散布，所以只給連結。

`references.bib` 收錄下表全部 14 篇，條目和主文 §13 的 BibTeX 相同。

## 索引

| 標題 | ID | 相關度 | 支援 2.0 的章節 | 一行理由 | 檔案 |
|---|---|---|---|---|---|
| ATM: CID-Brokered Pre-Write Admission for Multi-Agent Code Co-Synthesis | arXiv:2607.00041 | 基準（v1） | 全文，特別是 §1.6、§5 | 2.0 的起點；七層閘門、steward 與 G1–G3 都在這裡定義 | `pdf/2607.00041_ATM-v1.pdf`（CC BY 4.0） |
| When Agents Coordinate: Measuring Coordination in Multi-Agent AI Coding | arXiv:2608.16801 | 高 | §1、§5、§6、§7.1、§7.2 | 量協調結構與成本卻不量寫入完整性，是「事後量測」層的代表；預先登記與偏離表的寫法可借 | `pdf/2608.16801_Destefanis-Aste.pdf`（CC BY 4.0） |
| AgentRoom: Concurrent Multi-Agent Coding in a CRDT-Backed Shared Workspace | arXiv:2608.23740 | 高 | §1、§5、§6、§7.2 | 最近的寫入層鄰居：檔案層級 advisory 認領加 CRDT；無協調時觀察到靜默覆蓋，但不計數遺失更新 | `pdf/2608.23740_AgentRoom.pdf`（CC BY 4.0） |
| AI Agent Pull Requests on GitHub: Frequency, Structure, and Merge Conflict Rates | arXiv:2607.04697 | 高 | §1、§7.2 | 40.2% 的 repo 有同時活躍的代理 PR 配對，跨代理 textual 衝突率 41.7%，並定義 textual／build／semantic 三層衝突 | `pdf/2607.04697_AgentPR-Conflicts.pdf`（CC BY 4.0） |
| AgentRadio: Passive Awareness for Long-Horizon Multi-Agent Collaboration | arXiv:2607.28430 | 中 | §7.2、§7.1 | 「溝通層」的代表；評估規則禁止改原始檔，正好對照 ATM 處理的寫入層 | `pdf/2607.28430_AgentRadio.pdf`（CC BY 4.0） |
| The Collaboration Tax: How Much LLM Multi-Agent Systems Pay to Coordinate | arXiv:2608.22152 | 中 | §1、§6、§7.2 | 以單一代理完整資訊為上界定義協調成本，可轉成「寫入層協作稅」的描述性呈現 | 只給連結：https://arxiv.org/abs/2608.22152（arXiv 非專屬授權） |
| AgenticFlict: A Large-Scale Dataset of Merge Conflicts in AI Coding Agent Pull Requests on GitHub | arXiv:2604.03551 | 中（相鄰） | §5、§7.2 | 代理 PR 對 base 的 textual 衝突資料集（27.67%）；v1 點名過，2.0 要說明為什麼不直接用 | `pdf/2604.03551_AgenticFlict.pdf`（CC BY 4.0） |
| CooperBench: Why Coding Agents Cannot be Your Teammates Yet | arXiv:2601.13295 | 高（相鄰） | §1、§7.1、§7.2 | 區分空間協調與語意協調；「重複實作並覆蓋細節」占失敗的 33.2%，可支撐 C1′ 的動機，也界定 ATM 不保證語意相容 | `pdf/2601.13295_CooperBench.pdf`（CC BY-SA 4.0） |
| CodeCRDT: Observation-Driven Coordination for Multi-Agent LLM Code Generation | arXiv:2510.18893 | 中（相鄰） | §7.2 | CRDT 共享狀態路線的前作；摘要報告 5–10% 語意衝突，AgentRoom 拿它當比較對象 | `pdf/2510.18893_CodeCRDT.pdf`（CC BY 4.0） |
| Effective Strategies for Asynchronous Software Engineering Agents（CAID） | arXiv:2603.21489 | 高（相鄰） | §1、§7.2 | §4.1 直接比較「靠指令配合」的 soft isolation 和 worktree 實體隔離，結論是指令層隔離不夠，支撐「強制寫入路徑」的設計軸 | 只給連結：https://arxiv.org/abs/2603.21489（arXiv 非專屬授權） |
| The Collaboration Gap: Exploration and Benchmarking of Open-World Agentic Cooperation | arXiv:2511.02687 | 中（相鄰） | §7.2 | 和 Collaboration Tax 一起代表「對話層協調成本」；只讀了摘要 | 只給連結：https://arxiv.org/abs/2511.02687（arXiv 非專屬授權） |
| Spec-Driven Development for Agentic Software Engineering: Harnessing Human-Agent Teamwork | arXiv:2609.00252 | 中（只用於定位） | §7.2 | 概念分析，主張規格是人與代理之間的合約，可對照 v1 的 Task Contract 與 G1；作者自述依據灰色文獻、尚未驗證 | 只給連結：https://arxiv.org/abs/2609.00252（arXiv 非專屬授權） |
| Apodex 1.1: Scaling Agentic Intelligence for Complex Work | arXiv:2608.23283 | 中（機制上的鄰居） | §7.1、§7.2 | AgentOS 1.1 §3.3.4 的單一發布者 lease、事前強制的路徑清單、fail-closed 與 baseline 對帳，和 steward、CAS、G3 很接近；機制沒有單獨評估 | 只給連結：https://arxiv.org/abs/2608.23283（arXiv 非專屬授權） |
| How AI Coding Agents Resolve Merge Conflicts: An Empirical Study（Campos Junior & Murta, SBES 2026） | SBES 2026 | 高 | §1、§5、§7.2 | AIDev 代理 PR 內部 merge 有 29.5% 衝突（14,960/50,700），衝突 merge 96.1% 由人類 commit；PR 層級 3.4%（全部）／59.1%（僅含內部 merge 的 PR） | 只給連結：https://cbsoft.sbc.org.br/2026/data/papers/sbes/How%20AI%20Coding%20Agents%20Resolve%20Merge%20Conflicts%20An%20Empirical%20Study.pdf（PDF 內未見授權聲明，不轉載） |
| Why Do Multi-Agent LLM Systems Fail? | arXiv:2503.13657 | 低（相鄰） | §7.2 | 多代理失敗分類（14 種模式、3 類），可在相關工作一句帶過；不涉及寫入 | `pdf/2503.13657_MAST.pdf`（CC BY-NC-ND 4.0） |

## 沒有收錄的論文

下列論文在主文裡評為低相關，所以不放進這個資料夾，BibTeX 仍在主文 §13：DDBench（arXiv:2608.14863）、ClawArena-Team（arXiv:2606.31174）、ACES（arXiv:2608.20614）、Code Review Agents（arXiv:2604.03196）。SDD 與 Apodex 1.1 原本評為低，第二輪讀到相關章節後改評為中，已移入上表。

The Agentic Team Report 是附有來源的科技新聞網站，研究轉述大多可追到原文，但它是二手報導，所以不收錄，改收它引用的原始論文，理由見主文 §9。

## 讀了多少

ATM v1、第 3 篇、AgentRoom、AgentRadio 與 Collaboration Tax 讀了正文與限制。arXiv:2607.04697 讀了摘要、三層衝突的定義與結果段落。CooperBench 讀了摘要、第 1 節、第 5 節的分析與附錄 E。CAID 讀了 v1 的第 1、2、4 節。SDD 讀了摘要、導論、§4.2 與 §5.6。Apodex 1.1 讀了摘要、導論中的相關段落、§2.3 與 §3.3.2–3.3.4。AgenticFlict 讀了摘要和與網站主張有關的段落。CodeCRDT、Collaboration Gap 與 MAST 只讀了摘要。引用只讀過摘要的論文時，只能用來定位，或轉述摘要裡寫明的結果。

## 其他檔案

`related-papers-2026-10-15.md` 是主文的副本，和 `/workspace/reports/atm-paper2/` 裡的版本相同（2026-10-15 第二輪修訂後複製）。

## PR 衝突證據（2026-10-15 追加）

見 `pr-conflict-evidence.md`（與 `/workspace/reports/atm-paper2/` 版本相同）。新增 BibTeX：camposjunior2026agentresolve、brun2011proactive、ghiotto2020nature、brindescu2020mergequality、vale2022challenges。AgenticFlict 與 2607.04697 原本已有條目（ogenrwot2026agenticflict、xu2026agentprconflicts）。經典文獻（Brun、Ghiotto、Brindescu、Vale）屬出版社版權，只給 DOI，不放 PDF。BibTeX 只填讀過的 PDF 或 DOI 頁上確認過的欄位，沒確認的寫在 note。

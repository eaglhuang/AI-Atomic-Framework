---
title_zh: "ATM 同檔多代理提案的確定性合成與受治理提交"
title_en_tentative: "Deterministic Composition and Governed Commit of Same-File Multi-Agent Proposals in ATM"
subtitle: "proposal 可平行準備；合成以批次、對同一 immutable base 進行；canonical commit 經單一受控寫入路徑完成"
positioning: "ATM v1（arXiv:2607.00041）的續篇；systems-implementation＋實證論文；三項貢獻 C1 受治理合成提交協定／C2 可檢驗保留性契約／C3 安全與進度成本實證。歷史缺口修復定位為『對 v1 承諾的端到端驗證』，不列為新演算法貢獻"
version_date: 2026-10-07
revision: "吸收可行性審閱（ATM_PAPER_V2_FEASIBILITY_REVIEW，2026-10-07）後之修訂稿；修訂前版本備份於 ATM_PAPER_V2_DRAFT_zh_pre_review.md；吸收對照見 ATM_PAPER_V2_REVIEW_ABSORB_NOTES.md"
version_anchors: "v1 framework v0.9.0-alpha.1（tag object 0b31aa86 ≠ peeled source commit a897f144）；歷史問題基準 v0.1.17 commit 8dd6a1c6；本次 main 快照 3b0f7660（審閱核對 2026-10-07 11:49 UTC＝19:49 Asia/Taipei）；PR #198 已於 2026-10-07 合併為 main 5692474f（r2 更新；candidate final pin，待審核，非 final）；最終 frozen commit 尚未定；r3 更新 2026-10-08：steward 跨 process 修正 PR #213 合併為 main bea35380（merge）／4d7c9ed6（feature），作為 r3 驗證 pin，5692474f 結果保留；r4 更新 2026-10-08：steward 完成率最佳化 PR #214 合併為 main 2118bc66（merge）／b5729456（feature），作為 r4 驗證 pin，5692474f、bea35380 結果保留；r5 更新 2026-10-08：PR #216 合併為 main 37847584（merge）／5e39ee12（feature），核心層建議鎖、持鎖下孤兒 temp 清理、每目標 apply 佇列，作為 r5 驗證 pin（queue on／off 兩臂），前三個 pin 同場重跑"
harness: "atm-bench 0.3.0-latency（steward 臂與強基線臂待 M2/M3 接線）"
status: "草稿／非正式投稿（DRAFT — NOT FOR SUBMISSION）；主結果〔待 M2/M4〕；舊數字一律為作者報告值"
primary_axis: "同基底確定性合成＋受治理提交（Composer＋中立 steward）"
issue: "#196（https://github.com/eaglhuang/AI-Atomic-Framework/issues/196）"
supersedes: "（1）舊稿『熱檔提案、冷檔排隊』備份為 ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md；（2）審閱前之 Composer＋steward 稿備份為 ATM_PAPER_V2_DRAFT_zh_pre_review.md"
sources: "ATM_PAPER_V2_FEASIBILITY_REVIEW.md（修稿／實驗設計規範）、COMPOSER_STEWARD_IMPL_PLAN.md、runs/composer-probe/probe.out、PAPER_V2_KEY_TABLES.md（T1–T11）、HOT_FILE_LATENCY.md、refs/arxiv-2607.00041.txt（ATM v1 全文）"
---

# ATM 同檔多代理提案的確定性合成與受治理提交

**英文暫定標題**：Deterministic Composition and Governed Commit of Same-File Multi-Agent Proposals in ATM

**一句定位**：多個代理可以**平行準備** proposal，但 canonical 檔只經由**單一受控提交路徑**改變。本文研究 ATM 單一治理域內，對同一 immutable base 的同檔 proposal 如何以批次合成、驗證並受治理地提交——保留可相容的修改、對不相容或過期的提案回傳可對帳的結果——並量化這種安全性相對於鎖定、樂觀 CAS 重試與 Git 三方合併所付出的進度成本。本文**不**宣稱 canonical 檔同時接受多個 writer，也不宣稱任意程式語意正確。

> ⚠ **草稿／非正式投稿**。版本日期 2026-10-07（Asia/Taipei）。
> ⚠ **主結果尚無數據**。本稿的主張一律以「目標主張／待實測」框呈現，結果欄位標〔待 M2/M4〕；在凍結版本與可重現事件紀錄完成前，**不得**當作結果引用。
> ⚠ **舊數字均為作者報告值**：本稿引用的既有 run 數字（Oct 6 core@0.1.2 與 v0.1.17）由作者 harness 產生；外部審閱未取得原始事件與終態工件，無法驗算。正式稿前須自 run 級原始整數重算。

**證據標記**：〔作者報告值〕＝來自本 box 既有 run／彙整檔、未經獨立重算；🟢／🟡＝彙整包原分級（🟢 可用、🟡 有 caveat）；〔待 M2/M4〕＝主結果尚無數據；〔審閱核對 2026-10-07〕＝外部審閱聲稱已核對公開版本狀態，本稿轉述、作者尚需自行確認；〔待核對〕＝尚未逐頁對照原文；「來源未提供」＝本 box 無此數字。數字抄自 `PAPER_V2_KEY_TABLES.md`、`HOT_FILE_LATENCY.md`、`COMPOSER_STEWARD_IMPL_PLAN.md` 與 `runs/composer-probe/probe.out`，未重算（標「推算」者為彙整包以來源數字相除）。

---

## 摘要

多個程式代理對同一檔案提出修改時，**寫入准入**與**最終整合**是兩種不同的正確性責任。本文研究單一治理域內，對同一基底的 patch 如何經過合成、驗證與受控提交，保留可相容的修改，並對不相容或過期的提案回傳可對帳的結果。我們以 ATM 既有的 composer 與 steward 路徑為案例，區分**歷史實作缺口**、**協定假設**與**尚待驗證的安全性質**。

作為動機，我們報告兩組既有觀察。其一是故障注入負面對照：在作者的 atm-bench 熱檔高壓情境中，writer 採用 ATM 准入但刻意省略合成與提交協定、以舊 base 整檔覆寫時，已提交更新的遺失率約 55–65%〔作者報告值〕；這說明缺少該層的後果，而非完整 ATM 或其他正確並行控制方法的能力界線。其二是針對歷史基準 v0.1.17（commit `8dd6a1c6`）的唯讀探針：其文字合成實作為循序套用，同檔不重疊但上方插入一行即可使套用失敗且結果依輸入排序而異；重疊衝突以例外而非結構化拒絕收據結束；提交入口未比對提案者與 steward 角色。這些是對 v1 已承諾機制缺乏端到端驗證的歷史缺口；審閱核對之 main 快照 `3b0f7660` 尚未含修正；修正 PR #198 已於 2026-10-07 合併為 `5692474f`（本文實驗所用 pin，candidate final，待審核），其契約與本稿草案的差異仍待核定（§2.6）。

我們提出一個具明確 proposal、batch、base、steward 與 commit 語意的**受治理合成提交協定**，並在單一檔案、合作式 writer 與無歧義 patch 子集合的限制下，給出**合成決定性**與**編輯保留性**的證明義務。評估設計以 per-file lock 序列化、樂觀 CAS 重試與 Git 三方合併為正確強基線，另含移除准入的 bare composer 消融，同時量測正確完成率、可處理範圍（eligible coverage）、拒絕、尾端延遲、重提成本與多 process 故障。主要結果須在凍結版本與可重現事件紀錄完成後填入〔待 M2/M4〕；在此之前，本文不主張實驗已證明零遺失更新或任意語意正確。

**關鍵詞**：多代理程式生成、遺失更新、確定性合成、受治理提交、中立 steward、寫入前准入、可重現基準

---

## 1. 問題與範圍

### 1.1 問題：准入之後，誰對最終整合負責

當多個代理同時修改同一個檔案，「不衝突」有兩層意思。第一層是**准入層**：兩份意圖在語意 atom、有界區域、共享面與讀寫依賴上不重疊，可以被允許同時進行。第二層是**提交層**：兩份實際產生的 patch 真的進入 canonical 檔時，每一份被接受的編輯恰好生效一次、沒有一方覆蓋另一方、結果與 proposal 抵達順序無關，而被拒絕者不留下任何副作用。

ATM v1 把第一層做成一條可重播的准入詞彙（`parallel-safe`、`needs-physical-split`、`SERIAL`、`blocked-*`；v1 §3.4、Table 4），並把第二層**交給**確定性 composer 與中立 steward（v1 §3.2、§3.4 Algorithm 1 safety note、§3.5）。「准入不等於提交安全」是一條有用的系統診斷原則，但並非本文首創的一般性定律；本文的工作是把 v1 對第二層的承諾寫成可檢驗的協定與契約，並以公平基線量測其代價。

**名詞釐清**：本文所說的「平行」只指 proposal 的**準備**可以平行。合成以**批次**進行；canonical commit 由**單一受控寫入路徑**完成（圖 1〔待繪〕）。舊稿「真正平行合併」一詞容易被誤讀為 canonical 檔同時接受多個 writer，本稿不再使用。

### 1.2 範圍與威脅模型

最低可行範圍限定為：

- **單機、單一治理域**（沿用 v1 §3.7 的單域定位），單一目標檔；多檔提交僅作為限制與未來工作。
- **合作式程序**：所有 writer 都經由 broker／steward 路徑；不處理惡意 root、直接繞過 broker 的程序、惡意身份偽造或分散式網路分割。
- **可信 steward 與可信檔案系統**。
- **受限 patch 子集合**：文字型 unified diff，支援等長替換、插入、刪除與多 hunk；rename、binary、mode、CRLF 差異、無尾端換行等不支援語法須**明確拒絕**（§4.2）。

在此範圍內，本文**不能**宣稱多代理 sandbox、OS 層權限隔離、crash／斷電耐久性或任意程式語意正確（§3.5、§7.1）。若要主張較強的權限治理，需另加 OS 帳號／容器權限、actor 與 process 身份綁定、canonical 路徑寫入限制，以及 symlink、hardlink、路徑跳脫、TOCTOU 測試——這些不在本文範圍。

### 1.3 研究問題

- **RQ1（保留性與正確拒絕）**：在明定的 patch 子集合與故障模型下，方法是否保持所有已提交的有效編輯，並正確拒絕不相容提案？
- **RQ2（相對強基線的安全進度）**：相對 per-file lock、optimistic CAS retry 與 Git 三方合併，能安全完成多少工作，付出多少延遲、重試及拒絕成本？
- **RQ3（轉折條件）**：哪些 patch 結構、hotness、batch window 與 process 數造成效能或 coverage 的轉折？
- **RQ4（治理可驗證的層級）**：治理收據與寫入入口能驗證到哪一層？哪些保證仍依賴合作式程序或 OS 權限？

RQ 依此順序為主要 RQ 的預先排序；消融與探索性結果另標（§5.6）。

### 1.4 貢獻

| ID | 貢獻 | 內容 | 成立所需（本稿狀態） |
|---|---|---|---|
| **C1** | **受治理的合成提交協定** | 明定 proposal、batch、base、steward 與 commit 的責任與結果；狀態機、batch closure、拒絕與重提語意、收據終態 | 形式化狀態機、信任邊界、與 v1 的精確差異（§3）；**規格草案，待作者核定** |
| **C2** | **可檢驗的保留性契約** | 對受限 patch 集合：決定性輸出（composition determinism）、每個接受編輯恰好生效一次、未編輯片段不變、拒絕前無副作用；**不**宣稱任意語意正確 | 完整假設、命題與證明義務、獨立 oracle、邊界測試（§4）；**證明與測試待 M1** |
| **C3** | **安全與進度成本的實證** | 相對強基線量測 coverage、correct completion、tail latency、retry／reject 成本與跨 process 成本 | 同一 frozen commit、公平強基線、獨立 workload seeds、CI 與 artifact（§5–§6）；**〔待 M2/M4〕** |

**歷史缺口修復不列為新貢獻**。v0.1.17 的四項缺口——（a）行數位移導致套用失敗且結果依排序而異、（b）`permutationStable` 寫死為 `true`、（c）合成失敗缺結構化 blocked 收據、（d）提交入口未比對提案者與 steward 角色——是重要的實作修復，但它們是 v1 已承諾、先前缺乏端到端驗證的機制（§2）。本文把它們寫成「對 v1 承諾的端到端驗證」的起點，並以 C1–C2 說明本篇新增了哪些可泛化的知識：明確的提交協定、可證偽的保留性契約，以及公平基線下的成本取捨。

若最終結果只顯示「修復 v1 已承諾的機制」，而相對 Git 三方合併或鎖定方案的實務差異不明顯，本文應改投修正說明、重現研究或實務經驗報告；此決策點列於 M5（§5.7）。

### 1.5 本稿目前能以資料支撐的範圍

- **動機（作者報告值）**：故障注入負面對照（stale／raw overwrite）與理想 sync 參考的對比（§2.3）。
- **歷史缺口（質性、可重跑）**：綁 v0.1.17 的五情境探針（§2.4）。
- **背景（作者報告值）**：冷熱分級准入成本、冷檔排隊成本、跨 process CAS／apply 互斥負面對照——降為附錄 A，除非它們直接回答 RQ1–RQ4。
- **提交層正確性與完成率（作者自行執行、未獨立重現；§6 表 R3–R5）**：同一 E4 重播配置（75 runs、2,610 intents）同時段重跑四個版本：基準 `5692474f` 6／75 runs 遺失（合計 6 個效果）、完成 58.1%；`bea35380` 0 遺失、58.8%；`2118bc66` 0 遺失、66.2%，但跨 PID namespace 與偽造 owner 情境會遺失（各 10／10）；`37847584` queue on／off 0 遺失、65.8%／65.3%，前述反例情境 0 遺失。皆為觀察，未做顯著性或非劣性檢定；Phase 3 450-run 主矩陣未執行。
- **主結果**：全部〔待 M2/M4〕。

---

## 2. v1 承諾與歷史診斷

### 2.1 v1 對提交層的承諾

ATM v1（Huang，arXiv:2607.00041v1，2026-06-29，cs.SE）的貢獻是帶 virtual-atom 後備的七層寫入前准入閘門、規格到證據的治理基底，以及以 adapter 合約為界的原子化抽象（v1 §1.3）。與本文直接相關的承諾有三：

1. **角色分離**：代理只能提出 proposal；即使兩份 proposal 可組合，仍由中立 steward 執行受治理寫入；中立 steward 是唯一正式套用權威（v1 §3.2）。
2. **同檔不相交 → 組合，不是直接寫**：同檔有界不相交編輯路由到 `needs-physical-split`，由確定性 composer 與中立 steward 產生單一受治理的套用路徑（v1 §3.4，Algorithm 1 safety note；Table 4）。
3. **套用時位移由 composer／steward／CAS 吸收**：v1 §3.5 區分准入時的區域判斷與套用時的行數位移，「套用時產生的行數偏移必須由確定性 composer、中立 steward 與 CAS base-hash 重驗共同吸收」，並以 POS2 現場案例為此同檔寫入鏈的正向證據。

v1 的評估以確定性情境、現場案例（POS2／B-12／BLOCK）、外部採用者研究與 OperationalBench 為主，自述「不支持相對其他並行控制系統的廣泛優越性」（v1 摘要）。v1 **沒有**對「多份真實 patch 經 steward 合成後是否保留全部非衝突變更、是否與順序無關」做系統性量測。

### 2.2 版本分層

歷史 source、現行 main、候選 PR 與量測 artifact 是不同對象；CI 綠燈、PR 合併與小型 fixture 都不等於論文主實驗完成。本稿各表一律標明實際綁定哪一層。

**表 V1　版本錨點與可支持範圍**

| 對象 | 定位 | 本稿如何使用 |
|---|---|---|
| v1 framework | `v0.9.0-alpha.1`；**tag object** `0b31aa86`，peeled **source commit** `a897f144`〔審閱核對 2026-10-07〕 | v1 範圍與承諾的錨點。舊稿把 `0b31aa86` 當作 commit，已更正。後來版本的缺陷不能直接倒推至此版 |
| 歷史問題基準 | tag `v0.1.17`，commit `8dd6a1c6`（`packages/*/package.json` 顯示 0.1.2，以 tag 為準） | 探針（§2.4）與多數背景數字的綁定版本；文字 composer 為 sequential reduce、`permutationStable` 固定 `true` |
| 本次 main 快照 | commit `3b0f7660`，狀態截至 2026-10-07 11:49 UTC（19:49 Asia/Taipei）〔審閱核對 2026-10-07〕 | 已含 FileHeat（PR #197）與 native hot parking（PR #199）；text steward 路徑與 v0.1.17 為同一 blob，**尚未**含 #198 修正 |
| 修正候選 | PR #198，head `65e8aab3`〔審閱核對 2026-10-07〕；**r2 更新：已於 2026-10-07 合併為 main `5692474f7db70ab52a7a71c8af4867609e7e4b43`**（本文 harness 實驗 pin；candidate final，待審核） | 有 immutable-base 合成與新檢查，但四項契約與本稿草案不同（§2.6）；**不是** final frozen artifact；E4 顯示其 steward apply 為單 process 假設（§6 表 R3） |
| 提交層驗證版本（r3–r5） | `bea35380`、`2118bc66`、`37847584`（皆為 main 上的 merge commit；未 tag、未 publish）；完整 SHA、PR、合併時間與 CI 見附錄 E、F | §4.11 與 §6 表 R3–R5 的版本；皆**不是** final frozen artifact |
| 既有與最終實驗 | 舊數字橫跨 Oct 6（core@0.1.2，HEAD `ed317820`）與 v0.1.17；final SHA 尚未定 | 舊數字一律標作者報告值；所有主比較須在同一最終 frozen commit 上重跑全部臂 |

兩條版本號（v0.9.0-alpha.1 與 v0.1.x）的對應關係來源未提供〔待核對〕。

**狀態一句話**：歷史基準有已知缺口，main 尚未含修正，候選契約待核定，主結果仍待測。

### 2.3 動機：故障注入負面對照（作者報告值）

在 atm-bench 中以真 ATM broker 決策驅動熱檔高壓情境（`overlap=high`、hot_ratio 1.0、8 agents、trials 50、每 rep 354 offered intents），比較兩種 writer：

- **sync writer（理想參考）**：admission 之後，在 apply 當下同步 read-modify-write——等同一個理想化的即時 rebase；它是 harness 正確性參考，**不**代表真實合併的上界。
- **stale writer（ATM admission only／raw overwrite）**：admission 之後先讀 base，hold 結束後把 base＋自己的 edit 整檔寫回——即採用 ATM 准入決策，但**刻意省略** composer／steward 合成與提交協定。

**表 M1　熱檔 stale vs sync 對照（〔作者報告值〕；h1-a8 引自 T6、`HOT_FILE_LATENCY.md`；其餘情境 Oct 6）**

| 情境 | control lost 率 | stale lost 率（native／loop） | sync lost |
|---|---|---|---|
| h1-a8（Oct 6，core@0.1.2） | 71.5% | 64.9%／65.2% | 0 |
| h1-a8（v0.1.17） | 71.5% | 65.0%／63.6% | 0 |
| h1-a6（Oct 6） | 63.9% | 55.5%／54.4% | 0（native／loop） |
| h08-a8（Oct 6） | 68.0% | 64.6%／56.0% | 0（native／loop） |

**解讀與 caveat**：

1. stale／raw overwrite 是**故障注入負面對照**：它故意省略應有的合成與提交協定，只能說明「缺少該層」的後果，**不是** ATM 能力界線的結論，也不構成完整 ATM 與其他正確並行控制方法的公平比較。主比較須相對正確強基線（§5.2）。
2. 舊版 harness 與舊稿的所有「0 lost」都綁 sync writer，從未驅動真正的 `composeBrokerProposals`／steward apply；它量到的是理想 rebase 的正確性，而非 ATM 提交路徑的正確性。
3. 「同一組准入決策」措辭需收斂：sync 與 stale 臂使用相同 seed 與相同准入演算法設定，但 writer 速度、lease 釋放與 retry 會回饋到後續決策，**實際准入序列未必相同**（例：h1-a8 native composer_merge 210/rep vs nativestale 206/rep、reject 84 vs 88）。若要聲稱「同一准入決策」，須另做固定 decision／batch trace replay〔待 M3〕。
4. **分母（A4 已核）**：h1-a8 nativestale「172.7（64.9%）」在原表欄位標為「lost/rep（佔 commit）」；64.9% = **lost／commits**，3 reps **ratio-of-sums** `518/798`（mean-of-ratios ≈ 64.90%，幾乎相同）。顯示 172.7 = mean lost `(169+170+179)/3`。外部審閱 `172.7/354≈48.79%` 為 **lost／offered**，**不替換** 64.9%。原始整數：`T6_R1_DENOMINATOR_AUDIT.md`、`runs/hot-file/t6_r1_raw_counts.json`。不同版本、分母與 aggregation 不得接成單一效能提升百分比。
5. 路由壓力（背景）：h1-a8 native 每 rep 的已提交 intents 中，[admit, release] 區間在同一 path#region 上重疊的 pairs 約 156 對，全部為 composer_merge＋composer_merge〔作者報告值，`HOT_FILE_LATENCY.md` §1.1〕。**156 pairs 不等於 156 個 intents 或 rejected cases**，不得直接推為 blocked 率。

### 2.4 歷史探針（綁 v0.1.17 `8dd6a1c6`）

**方法**：唯讀探針在 `/tmp` 建拋棄式 git repo，只 import v0.1.17 core 原始碼，不修改 ATM 樹（`runs/composer-probe/probe.mts`；Node v24.21.0；`ATM=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17 node probe.mts`）。每個情境為兩份 `PatchProposal`、同一個 10 行檔、同一 baseCommit／fileBeforeHash，依序呼叫 compose 與 steward apply，記錄 verdict、例外與最終檔是否保留 A／B 的變更。探針輸出未隨稿附給外部審閱；正式稿須把 `probe.mts`、`probe.out` 與輸入 fixture 放入 artifact（附錄 C）。

**表 P1　v0.1.17 compose／steward apply 探針（`runs/composer-probe/probe.out`；歷史基準，非現行 main、非 #198）**

| # | 情境 | compose verdict／applyMethod | apply 結果 | 保留 A／B |
|---|---|---|---|---|
| 1 | 不重疊，兩邊等長替換（第 2、8 行） | `parallel-safe`／`patch-apply` | `applied` | ✅／✅ |
| 2 | 不重疊，排在前面的 patch 在上方且插入 1 行 | `parallel-safe`／`patch-apply` | **throw** `UnifiedPatchApplicationError: patch context mismatch at line 8: expected "line8", found "line7"` | ❌／❌ |
| 3 | 同 #2 的 patch，但 anchor 讓下方 patch 先排 | `parallel-safe`／`patch-apply` | `applied` | ✅／✅ |
| 4 | 重疊（兩邊都改第 5 行） | `needs-steward`／`steward-authored-final-patch` | **throw** `…context mismatch at line 5: expected "line5", found "A_EDIT"`（非 blocked 收據） | ❌／❌（檔案未變） |
| 5 | `stewardId='agentA'`（即提案者本人） | `parallel-safe` | **`applied`** | — |

### 2.5 歷史缺口的解讀

1. **順序依賴**：#2 與 #3 只差排序，結果就不同。根因是 `steward-transactional-apply.ts:148` 的文字路徑實為 `proposals.reduce((c,p)=>applyUnifiedPatch(c,p.patch), before)`——對**中間檔**循序套用，而非對同一 immutable base 解析；排序鍵為 `targetFile → firstAnchorKey（字串）→ proposalId`（`merge-plan.ts:26-55`），不是檔內位置。這正是 v1 §3.5 所說「准入時不相交、套用時位移」的情況，而 v0.1.17 未吸收它。`serializabilityProof.permutationStable: true`（v0.1.17 欄位名；更名見 §4.5）為寫死值（`:116-121`），不構成任何證明。
2. **拒絕前無副作用，但不可觀測**：#4 未部分寫入（canonical 檔未變），但以例外中斷；CLI／harness 拿不到 `verdict:'blocked'` 與衝突明細，提案者無從據以 re-propose。
3. **角色未比對**：#5 中提案者本人以 steward 身分完成 apply。`checkStewardPermission` 只在 `arbitrateStewardRequest`（`steward.ts:316`）被呼叫；`applyStewardPlan`／`executeBrokerScopedWrite`／CLI `broker steward apply` 均未比對；CLI 可任意帶 `--steward-id`。
4. **`needs-steward` 被放行**：`planStewardApply` 只擋 blocked／human-required（`steward.ts:416-419`），`needs-steward` 進入 apply，但沒有「steward 撰寫最終 patch」的實作。
5. **測試盲點的範圍**：`validate-broker-compose.ts` 只測 compose verdict；`validate-broker-steward.ts` 只測單一 proposal apply（IMPL_PLAN §2.3）。既有多作者 `MutationRequest`（`composeTransactionalMutations`）測試已存在；盲點應限定為**同檔 text `PatchProposal` 多 proposal 真 apply** 路徑。

本節只描述歷史基準 v0.1.17；不構成對現行 main 或 PR #198 的判定（見 §2.6），也不構成「已修正」的主張。

### 2.6 現況分層：main、候選修正與相關功能（〔審閱核對 2026-10-07〕）

- **main `3b0f7660`**：text steward 路徑與 v0.1.17 為同一 blob，探針揭露的缺口在該快照上**尚未**修正（依審閱比對；作者需自行確認）。r2 更新：#198 已合併為 `5692474f`，B1–B8 探針於該 pin 重跑（`runs/b5-b8/`）。
- **候選 PR #198（未合併，head `65e8aab3`）**：含 immutable-base 合成與新檢查，但與本稿草案有四項契約差異，**須先選定契約再寫性質**：

| 項目 | 本稿原草案 | #198 候選 | 待決 |
|---|---|---|---|
| context | 任一 context 重疊即拒（保守） | 允許兩份編輯只共享**未修改**的 context | 選定後須量化 false rejection（§4.3） |
| needs-steward | 無 steward final patch 即 blocked | 允許可確定性合成的 text／JSON-pointer 情形通過；此路由標籤不等於真衝突分母 | 真衝突分母須由獨立政策定義（§5.4） |
| permutation | 實際跑 permutation（N≤k 全排列） | n≤4 全排列；n>4 為 rotations＋reversal，共 n+1 次 | 有界檢查不是一般證明（§4.5） |
| identity | `stewardId ∉ actorId` 且 kind=neutral | 僅比對去空白的 actor／steward 標籤；空 steward ID 無該項錯誤；direct API 無 neutral kind 參數 | 只能稱角色一致性檢查（§3.5、§4.7） |

- **FileHeat（#184 所涉）**：已由 **PR #197 合併**；預設 static，hybrid／learned 為 opt-in，**不能**寫成完整 EMA 多訊號模型。
- **Native hot parking（#181 所涉）**：已由 **PR #199 合併**；release／expiry 只給予重新驗證資格，**不會**直接授權舊 patch。審閱稱 #199 合併後的五項 CI 於 11:53:20 UTC（19:53:20 Asia/Taipei）全部通過；CI 綠燈不等於論文實驗完成。
- **issue 狀態 ≠ PR 狀態**：#181、#184 issue 仍 open，不代表相關 PR 未合併。
- **舊 harness 觀察的時間語境**：舊稿「core 無 park／harness 觀察不到 park」「#184 僅設計未 merge」等敘述**綁 v0.1.17／Oct 6 版本**，對 main 已不成立。舊 polling-wait benchmark（nqwait 臂以輪詢 activeIntent file-blocker＋re-eval 實現等待）**不能**回填為 native ticket／resume 的實測。

### 2.7 歷史缺口修復清單（對 v1 承諾的端到端驗證；#196）

下列項目是**修復**，用來讓 C1–C3 能被量測；修正方向為建議，契約以作者核定版本為準（§2.6）。

| ID | 層 | 歷史缺口（v0.1.17） | 修正方向（建議，非定案） | 對應 |
|---|---|---|---|---|
| P0-1 | core | 循序 reduce；位移致失敗、結果依排序 | 對同一 base 解析；選定相容性規則；依 base 位置構造輸出 | C2 §4.4 |
| P0-2 | core | 合成失敗以 throw 結束 | 捕捉 → `ok:false, verdict:'blocked'`＋reason code＋proposalId；拒絕前無副作用 | C1 §3.6 |
| P0-3 | core | `needs-steward` 放行但無最終 patch | 依選定契約：不可確定性合成者即 blocked（`steward-final-patch-required`） | C1 |
| P0-4 | core＋CLI | 提案者可自我 apply | 所有寫入入口做角色一致性檢查；違反 `invalid-steward-identity` | C1 §3.5 |
| P0-5 | harness | atm-bench 未驅動真 compose／steward；0 lost 綁 sync writer | 新增 steward 臂與強基線臂（§5.2） | C3 |
| P0-6 | 測試 | 無同檔 text 多 proposal 真 apply 驗收 | S1–S5 擴充（§4.9）＋property／metamorphic tests | C2 |

---

## 3. 協定與信任模型（C1）

本節是 C1 的規格草案。狀態、欄位與終態語意為本文提議，須由作者與 #198 最終契約對齊後凍結〔待 M0〕。

### 3.1 參與者與責任

| 參與者 | 責任 | 不負責 |
|---|---|---|
| proposer（代理） | 基於某個 base digest 產生 proposal（logical operation ID、actor、patch、anchors／atomRefs） | 寫入 canonical 檔 |
| broker | 准入：路由至 direct／compose／queue／park／blocked（v1 詞彙） | 合成與提交 |
| batch closer | 依明定規則封閉一個 batch（成員集合＋base digest） | 判定相容性 |
| composer | 在 base 上解析所有編輯、檢查相容性、產生唯一候選輸出或拒絕 | 寫入 |
| validator | 依政策驗證候選輸出（語法、scope、語意驗證收據） | 寫入 |
| steward（中立） | 在受互斥保護的區間內重驗 canonical digest、替換、發出提交收據 | 撰寫或修改編輯內容（P2-1 之外） |

### 3.2 狀態機

**表 C1　logical operation 狀態與必要記錄**

| 狀態 | 含義 | 可計為 committed |
|---|---|---|
| proposed | 提案產生；保留 logical operation ID、base digest 與 patch digest | 否 |
| eligible／blocked | 經 scope、base、identity、syntax 與衝突檢查後的結果 | 否 |
| batched → composed | 以 batch ID 封存成員與 base，產生唯一候選輸出 | 否 |
| validated | 完成所要求的驗證；記錄 validator 版本與結果 | 否 |
| **committed** | 在受互斥保護的 compare-and-replace 完成，並取得提交收據 | **是** |
| aborted／retryable | 記錄原因；保持原檔，或進入明定恢復流程 | 否 |
| reproposed／exhausted | 同一 logical operation 在新 base 重提，或超出重試預算 | 否 |

規則：

- **准入不等於提交成功**。每個 logical operation 最多計一次有效完成；重試另計 attempts。
- 取消、超時與未處理項**不能**從分母消失（§5.4）。
- `blocked` 只表示**提交前**拒絕且 canonical 未變。

### 3.3 Batch closure、late joiner 與重提

- **closure 規則**須明定：時間窗、數量閾值或 holder release 三者之一（或組合），以及由誰排程。v0.1.17 只有手動 CLI，沒有在准入之後自動收集 proposal 的機制〔IMPL_PLAN §2.1〕。
- **late joiner**：batch 封閉後到達、仍基於同一 base 的 proposal，須明定進入下一 batch、或因 base 已前進而轉為 retryable。
- **重提**：前一 batch 提交後 canonical digest 改變，後到的 proposal 會遇到 `file-hash-drift`／metadata mismatch；須定義「退回 → 在新 base 重新產生 patch → 重新 compose」，並量 attempts／rounds 與 deadline。
- native hot parking（PR #199）的 release／expiry 只給予**重新驗證資格**，不授權舊 patch；與本節重提語意一致，但其與 batch closure 的交互作用〔待 M2 定義〕。

### 3.4 提交界線

只有在**同一互斥區間內**重新驗證 canonical digest 並完成替換，單檔提交才有機會被視為一個可線性化操作。若比對與寫入之間可被其他 writer 插入，就仍有 TOCTOU 風險；proposal 端攜帶的 hash 本身不會消除此風險。v0.1.17 的 `applyTransactionalStewardPlan` 已檢查 writerRole、digest、scope 與 base hash（stale → blocked），跨 process 情境另需 per-file apply lock（附錄 A.4 的負面對照顯示 apply-lock off 時 composer_merge 路徑會遺失更新〔作者報告值〕）。

### 3.5 信任模型：主張與必要前提

**表 C2　主張、必要前提與本文可接受措辭**

| 主張 | 必要前提或證據 | 本文可接受措辭 |
|---|---|---|
| proposer 無法自我 apply | 可信的 actor 身份綁定；所有寫入入口均檢查；不存在可繞行路徑 | 若僅字串比對（v0.1.17 修正方向與 #198 皆是），稱**角色一致性檢查**，不稱身份保證 |
| proposer 無法直接寫 canonical | OS 權限或 capability 阻止所有未授權寫入；syscall／filesystem 監測只提供觀測證據 | 「**在已監測路徑中未觀測到** proposer 直接寫入」，附監測途徑與覆蓋率；**不**稱「無法寫入」 |
| stale base 不會提交 | 鎖保護 digest 重驗到 replacement；所有合作 writer 遵守 | 「在合作式 writer 與鎖協定下防止 stale commit」 |
| 例外不留下部分更新 | 列舉失敗點、驗證 rollback 完成、收據與檔案狀態一致 | 「例外處理的**補償**保證」 |
| 單檔 crash atomicity | 原子替換原語與平台語意；kill／斷電測試、journal 恢復規則 | 未測前**不主張**；測後限「已測故障模型內保持舊或新版本」 |
| 多檔原子性與耐久性 | 跨檔提交機制、讀者可見性、fsync 與 recovery protocol | 列為限制，不以 rollback 推論 |

process kill 不等於斷電；未驗證 fsync 與檔案系統故障模型前，不主張斷電耐久性。恢復測試設計可參考 SQLite atomic commit 的方法，但不移植其保證。

### 3.6 收據終態

收據應描述**真實終態**：

| 收據 | 意義 |
|---|---|
| `committed` | 互斥區間內 digest 重驗通過並完成替換；附 output digest |
| `blocked` | 提交前拒絕，canonical 未變；附 reason code（如 `compose-context-mismatch`、`steward-final-patch-required`、`invalid-steward-identity`、`file-hash-drift`）與衝突 proposalId |
| `rolled-back` | 曾進入寫入，補償成功、原檔還原 |
| `recovery-required` | 終態待修復（例如 rollback 自身失敗）；**不得**仍回 `blocked` |

收據遺失但寫入成功時，須以 logical operation ID 與 digest 對帳，避免重試造成重複更新。這把 v1 §3.4「blocked 是 containment，而非刪除提案者工作」的語意落到可被 CLI／harness 觀測的層級。

### 3.7 最低事件欄位

`run_id`、`logical_id`、`attempt_id`、`batch_id`、base／patch／output digest、actor／pid、reason code、單調時間戳、ATM／harness／oracle SHA。跨 process 計時須明定可比較的 timebase。舊 harness 的事件欄位（`steward_verdict`、`blocked_reason`、`repropose_rounds`、`proposer_direct_writes`）併入上列，`proposer_direct_writes` 改為附監測覆蓋率的 write authority 指標（§5.4）。

---

## 4. 合成性質與實作（C2）

### 4.1 既有路徑（v0.1.17 `8dd6a1c6`，程式碼層事實）

以下引自 `COMPOSER_STEWARD_IMPL_PLAN.md` §2.1（行號以 v0.1.17 本機樹為準；`compose.ts` 與 `steward-transactional-apply.ts` 在 v0.1.17 與 Oct 6 HEAD `ed317820` 兩樹相同；審閱稱 main `3b0f7660` 的 text steward 亦為同一 blob〔審閱核對 2026-10-07〕）。

| 階段 | 元件 | v0.1.17 行為 |
|---|---|---|
| 准入 → compose | `evaluate-broker-admission.ts:48-49`；`decision.ts:228`、`decision/proposal-overlap.ts:96` | `deterministic-composer`／`neutral-steward` lane → disposition `compose`（`composer-routed`）。准入只決定「要走 compose」；無自動 batch closure |
| compose | `composeBrokerProposals`（`compose.ts:34`） | 排序 → CID 衝突回 `ok:false, blocked-cid-conflict`；baseCommit／fileBeforeHash 不一致、anchor 重疊、hunk 範圍重疊回 `ok:true, needs-steward`；否則 `parallel-safe` |
| 排序 | `merge-plan.ts:26-55` | `targetFile → firstAnchorKey（字串）→ proposalId`，不是檔內位置；`parsePatchHunkRanges` 只讀 `@@ -a,b` 標頭 |
| applyMethod | `merge-plan.ts:75-78` | `parallel-safe → patch-apply`；其他 → `steward-authored-final-patch`（無程式真正產生此 patch） |
| plan | `planStewardApply`（`steward.ts:133`） | schema、blocked、human-required、scope lock、stale-base-commit／file-hash-drift；`needs-steward` 可通過 |
| apply | `applyStewardPlan`（`steward.ts:161`） | `buildPatchProposalComposition` → 語意驗證收據 → `applyTransactionalStewardPlan(writerRole:'neutral-steward')`，寫 evidence |
| 文字合成 | `steward-transactional-apply.ts:143-173` | 名為 "against immutable base"，實為對中間檔循序 reduce（`:148`）；`serializabilityProof.permutationStable: true` 寫死（`:116-121`） |
| 寫入 | `steward-transactional-apply.ts:246-389` | writerRole、digest、scope、base hash（stale → blocked）→ temp → canonical；失敗時 rollback（補償語意見 §4.8） |
| 嚴格套用 | `applyUnifiedPatch`（`unified-patch.ts:79`） | context 不符即 throw `UnifiedPatchApplicationError`（`ATM_UNIFIED_PATCH_CONTEXT_MISMATCH`） |
| 角色 | `checkStewardPermission` | 只在 `arbitrateStewardRequest`（`steward.ts:316`）被呼叫；其餘寫入入口未比對 |

另有一條結構化 composer（`transactional-composer.ts:68 composeTransactionalMutations`；text-range adapter 只支援 `.md/.txt`），吃 `MutationRequest`，具 canMerge／skipped／returnedQueueRequestIds 語意且已有多作者測試；兩條路徑的統一列為 P2-3。

### 4.2 Patch 模型：changed span、context span 與 insertion gap

**更正**：舊稿稱「compose 的 `@@ -a,b` 範圍檢查未涵蓋 context 行」，措辭不精確。依 GNU diffutils 的 unified format 定義，hunk 標頭 `@@ -l,s +l,s @@` 的 **old range 已包含 context 行與刪除行**。因此以 old range 判重疊，其實是以「含 context 的區間」判斷，它既無法區分「真的被改的行」與「只是被引用的 context」，也無法表示純插入的位置。ATM `parsePatchHunkRanges` 的實際行為（含 count 省略、count=0 的處理）〔待核對 parser 實作〕。

本文對每個 hunk 在 base `B` 上分開三種區間（以半開區間 `[a, b)` 表示被消耗的原始行）：

| 區間 | 定義 | 用途 |
|---|---|---|
| **changed span** | 被刪除或替換的原始行（`-` 行） | 判定真寫入衝突 |
| **context span** | hunk 中未改動、用來定位的原始行（空白前綴行） | 判定定位依賴；依契約決定是否可共享 |
| **insertion gap** | 純插入點，位於兩行之間；old length 可為 0 | 判定插入順序歧義 |

規則：

- **同一 gap 的兩個插入**若沒有明定順序，**必須拒絕**；不能因兩者的 changed span 交集為空就判為不衝突。
- 相鄰端點、檔首、檔尾、重複內容與多 hunk 必須有唯一定位規則；不支援的語法明確拒絕。
- 解析器必須驗證 context 內容、old／new counts、合法路徑與支援的檔案格式。

### 4.3 相容性規則：兩個候選契約

| 契約 | 規則 | 優點 | 代價 |
|---|---|---|---|
| **保守（原草案）** | 兩 hunk 的 changed span 與 context span 任一交疊即不相容；同 gap 雙插入不相容 | 凡被接受者，每份 hunk 的 context 在 B 上的驗證都不被他人改動；假設簡單 | 部分語意可合併的相鄰編輯被誤拒；須量化 false rejection |
| **精確（#198 候選）** | changed span 不交疊；允許只共享**未修改**的 context；同 gap 雙插入不相容 | coverage 較高 | 須明確說明解析在 B 上完成而非在中間檔重新驗證；需獨立 oracle 判定應允許／應拒絕 |

本稿**尚未**在兩者間定案（待作者決定，見吸收對照）；§4.4 的命題對兩者皆適用，只要「相容」依所選規則定義。消融 §5.6 比較兩者的安全性、false rejection 與 coverage。

### 4.4 單檔同基底合成命題（證明義務；證明待 M1）

**命題（單檔、同基底）**：設所有有效編輯皆唯一對齊於同一 base `B`；其 changed span、所選契約要求保護的 context 與 insertion gap 依明定規則兩兩相容。若 composer 先在 `B` 上解析所有編輯，再依唯一的基底位置規則輸出未改動片段與替換片段，則：

1. **決定性**：輸出只由 `B` 與編輯集合決定，不依賴 proposal 輸入順序；
2. **保留性**：每個被接受編輯的效果恰好實現一次（含刪除效果）；
3. **frame property**：未被任何編輯觸及的片段 byte 等值保持不變。

**證明拆成三個引理**：

- **L1 唯一解析**：每個 hunk 對應的 base 區間或 gap 唯一，且 context 與長度檢查已通過。
- **L2 無歧義分割**：相容編輯把 `B` 切成不交疊、可排序的保留片段與替換位置；所有插入的邊界規則一致。
- **L3 輸出不變性**：輸出串接只取決於唯一排序後的集合，故重排輸入不改變 bytes；由片段構造得到保留性與 frame property。

**命題不涵蓋**：語意無衝突、liveness、身份可信、crash durability、跨檔 invariant。

**拒絕前無副作用**：在 composer 回傳不相容或解析錯誤時，steward 不進入寫入階段，canonical digest 不變；此性質由 §3.6 收據與 S2 測試檢查，而非由命題推出。

### 4.5 Composition determinism ≠ serializability

**更名**：舊實作與舊稿的 `serializabilityProof.permutationStable` 應更名為 **composition determinism**（合成決定性；建議欄位名如 `compositionDeterminism`，實際命名由作者決定）。

- 排列不變性是**合成函式**的性質。資料庫意義的可序列化關注所有已提交交易的讀寫觀測是否等價於某一序列；讀取集合、跨檔依賴與衝突圖未定義前，不應以 serializability 命名。
- **排列測試不是證明**。小集合全排列可作回歸測試；大集合隨機排列可找反例。#198 候選的「n≤4 全排列、n>4 為 rotations＋reversal 共 n+1 次」是**有界檢查**，不是一般證明。
- n! 枚舉不必放進 production hot path：可用確定的正規化構造（§4.4）保證決定性，在測試時再驗證排列不變性。欄位若保留，應記錄實際檢查的排列數與方法，而非布林常數。

### 4.6 Fail-closed：結構化 blocked 收據

- **合成錯誤 → blocked**：在 `buildPatchProposalComposition` 捕捉解析／context 錯誤；回 `ok:false, verdict:'blocked'`＋reason code＋衝突 proposalId；不部分寫入。
- **不可確定性合成之 `needs-steward` → blocked**（`steward-final-patch-required`）；真正由 steward 解衝突屬 P2-1。依 #198 契約，可確定性合成的 text／JSON-pointer 情形可能放行；`needs-steward` 路由標籤因此**不等於**真衝突分母。
- 收據終態依 §3.6；rollback 失敗須回 `recovery-required`。

### 4.7 角色一致性檢查（原稱 identity gate）

所有寫入入口（core `applyStewardPlan`、`executeBrokerScopedWrite`、CLI `broker steward apply`）一律比對 `stewardId` 與 proposals 的 `actorId`；違反即 `blocked`＋`invalid-steward-identity`，檔案不變。

- 若此比對僅基於字串標籤（v0.1.17 修正方向與 #198 候選皆是），它是**角色一致性檢查**，可被冒用的字串繞過，不是身份保證或 OS 隔離。
- #198 候選的邊界〔審閱核對 2026-10-07〕：僅比對去空白的 actor／steward 標籤；空 steward ID 無該項錯誤；direct API 無 neutral kind 參數。是否補上空 ID 拒絕與 kind 檢查，待作者決定。
- CLI 在無 runtime handshake 時走 `directApplyResult` 是否也應要求 handshake／identity，列為 P1-7〔待核對〕。
- 「proposer 零直接寫入」只能作為**監測路徑觀測**（§3.5、§5.4）。

### 4.8 寫入：拆開四種保證

舊稿把「temp 寫入＋失敗 rollback」稱為交易式寫入並視為原子交易，措辭過強。本文拆成：

| 保證 | v0.1.17 已有 | 本文主張範圍 |
|---|---|---|
| 例外補償 | 失敗 rollback（`failAfterWrites` 回歸測試 S5） | 已測失敗點內「例外不留部分更新」；須列舉失敗點並驗證收據與檔案一致 |
| 單檔替換 | temp → canonical | 替換原語的平台語意〔待核對〕；未測 kill／斷電前**不稱 crash atomicity** |
| crash recovery | 來源未提供 | 不主張；故障矩陣列 kill、寫入失敗、rollback 失敗、收據遺失（§5.3） |
| 多檔可見性 | rollback 還原所有檔 | 不主張多檔原子性或讀者可見性；列為限制 |

### 4.9 驗收場景（M1；S1–S5 保留並擴充）

| ID | 場景 | 期望 | v0.1.17 歷史基準 |
|---|---|---|---|
| **S1a** | 同檔、不重疊、兩個等長替換 | 合成並 committed；A、B 皆在，其餘 byte 不變 | ✅（探針 #1） |
| **S1b** | 同檔、不重疊、上方插入或刪除行；兩種輸入排序各跑一次 | 兩種排序皆 committed、A、B 皆保留、**輸出 byte hash 相同** | ❌（探針 #2 throw；#3 成功 → 順序依賴） |
| **S2** | 同檔、真 overlap（changed span 交疊） | blocked 收據＋conflict 明細＋proposalId；canonical hash 不變；不 throw | ❌（探針 #4：檔案未變，但 throw） |
| **S3** | `stewardId` 等於任一 `actorId`（API 與 CLI 各一次；另加空 ID） | `blocked`＋`invalid-steward-identity`；檔案不變 | ❌（探針 #5：`applied`） |
| S4 | canonical 檔在 compose 之後被改 | `file-hash-drift` → blocked，可重提 | 現有行為（回歸） |
| S5 | 多檔部分失敗（`failAfterWrites`） | `rolled-back`，所有檔還原 | 現有行為（回歸） |
| S1c（新） | 同 gap 雙插入 | blocked（插入順序歧義） | 〔待 M1〕 |
| S1d（新） | context 重疊但 changed span 不交疊 | 依所選契約：保守→blocked；精確→committed 且與獨立 oracle 一致 | 〔待 M1〕 |
| S1e（新） | 檔首／檔尾、相鄰端點、重複 context、多 hunk、無尾端換行 | 唯一定位或明確拒絕 | 〔待 M1〕 |
| S5b（新） | rollback 自身失敗、收據遺失 | `recovery-required`；以 operation ID＋digest 對帳，不重複提交 | 〔待 M1〕 |

另加 **metamorphic／property tests**：重排 proposal 不變、每個 proposal 只計一次、無關片段 byte 等值、拒絕前後 hash 一致、明定政策下重複提交的 idempotency。

### 4.10 與准入路由的關係（背景）

- **冷熱分級准入**決定「誰要走 compose」：熱檔 proposal-first 下，無其他 writer → `provisional-write-lease`；同檔已有非 provisional holder → `composer-routed`；同 region 撞 provisional holder → `true-conflict`。
- **冷檔 serial queue（#180）**處理同 atom 必須序列化的情況；**native hot parking（PR #199，main 已合併）**處理熱檔 late joiner 的重新驗證。
- **合成提交協定**處理同檔不同 region 的 proposal——本文主軸。
- 交互作用：在熱檔情境下，v0.1.17 core 會把**同 region** 的後續 writer 也路由到 composer（`HOT_FILE_LATENCY.md` §1.1）。修正 P0-2／P0-3 後，這些同區撞車會從「在 sync writer 下看起來 0 lost」變成可觀測的 blocked。這是設計還是 bug、是否應在准入層改為 queue／park，列為 P1-4，需作者確認〔待核對〕；論文會同時報正確性與重試成本，而不以壓低 blocked 率為目標。

---

### 4.11 提交層最佳化：區域重定、有界重試、核心層建議鎖、孤兒暫存清理與 apply 佇列（DRAFT，不主張勝出）

本節描述現行設計（ATM main `37847584`）與各元件能否單獨消融；元件逐版引入的順序與每一版修掉的反例見 §6 表 R6，過程紀錄與程式碼差異見附錄 E、F。

| 元件 | 設計 | 能否單獨關閉（r5 消融方式） |
|---|---|---|
| (a) 區域重定 re-compose | 行號合成失敗（`compose-context-mismatch`）時，若提案帶區域身分（line anchor hint `L<line>:<region>`、symbol content anchor，或 patch 內唯一的 `</region:…>` 結尾標籤），在目前檔案的該區域內以提案的舊列序列重新定位並套用。找不到區域→`compose-context-mismatch`；同批兩份提案同區域、或錨定列已被改→`steward-final-patch-required`（不寫入）。有區域身分的提案不再因計畫階段的 `file-hash-drift` 直接擋下；沒有區域身分者仍以 `file-hash-drift` fail-closed。錨點是 region 標記＋列內容，不是 CID | 否（無開關）；以 pin 對照（`bea35380`→`2118bc66`）代替 |
| (b) 未上鎖早期 stale 改走 re-compose | 早期 stale 不直接 `blocked`，進入與鎖內 base 不符相同的重試迴圈 | 否；`maxRecomposeAttempts=0` 會同時關掉 (c) |
| (c) 有界重試＋退避 | `maxRecomposeAttempts` 4（共 5 次）、`recomposeBackoffMs` 4（第 k 次重試前等 4k ms）、`recomposeJitterMs` 3；用盡時理由為 `re-compose attempts exhausted after N of M: …` | 可：環境變數 `ATM_STEWARD_RECOMPOSE_POLICY`（JSON）；r5 臂 qr0（0 次）、qr1（1 次、無退避） |
| (d1) repo 範圍鎖位置 | `<repo>/.atm/runtime/steward-commit-locks/<sha256(realpath)>/`；不同 TMPDIR 共用同一把鎖 | 部分：`ATM_STEWARD_COMMIT_LOCK_ROOT` 可把各 process 指到不同目錄（即不共享鎖）；r5 未用此設定（無「關閉檔案鎖」開關，屬設計選擇） |
| (d2) 核心層建議鎖 | 鎖為該目錄下 `lock.sqlite` 的 `BEGIN IMMEDIATE`（Linux 為 fcntl 記錄鎖）。鎖跟著開啟的檔案描述子，持有者死亡（含 SIGKILL）由核心釋放；同一檔案系統上不同 PID namespace 的 process 看到同一把鎖。`owner` 檔只記 pid 與啟動時間供診斷，**不再**用 pid 存活判斷回收。拿不到鎖就等到 `lockWaitMs`（2,000 ms），然後 `recovery-required:`，不搶鎖、不覆寫 | 否；以 pin 對照（`2118bc66` 以 pid／start token 判斷）代替 |
| (d3) 孤兒暫存清理 | 目標目錄中的 `.<name>.*.atm-tmp` 只在**握有該目標的排他鎖時**刪除（commit 取得鎖後、比對 base 前）；獨立清理入口 `cleanupOrphanCanonicalTemps` 以 0 等待嘗試取鎖，拿不到就一個都不刪並回報 `skippedLiveHolder` | 否；以 pin 對照代替 |
| (d4) 每目標 apply 佇列 | `applyStewardPlan` 在合成之前先在 `.atm/runtime/broker-steward-apply-queue/<sha256>/` 取得 FIFO 隊伍票（每位等待者持有一個以 `BEGIN IMMEDIATE` 鎖住的 presence 檔，隊伍頭死亡由核心鎖偵測），使競爭中的 apply 排隊合成，而非同時合成再 re-compose。正確性仍只靠 (d2) 的檔案鎖與 base-hash 比對；佇列建不起來或等隊伍頭超過 `ATM_STEWARD_APPLY_QUEUE_WAIT_MS`（預設 10,000 ms）即退回只有檔案鎖的路徑 | 可：`ATM_STEWARD_APPLY_QUEUE=on|off`；r5 臂 q（on，預設）與 nq（off） |

**測量上的限制**：(1) seam 與 before-precheck 兩種 barrier 會讓先到的 process 停在合成之後；佇列開啟時，該 process 握著隊伍頭，另一方只能等滿 10 秒再退回檔案鎖。因此 r5 在這兩種 barrier 對 `37847584` 以 `ATM_STEWARD_APPLY_QUEUE=off` 執行（記錄於每個 run 的 `atm_env` 與 GENERATION.md），佇列開啟只做探索性 5 次。(2) 除 (c)、(d4) 外各元件無開關，貢獻只能以 pin 對照呈現，混有同一版的其他變更。

**結果摘要**（詳見 §6 表 R3–R5；完成與遺失分開列）：同一 E4 重播配置下，`37847584` queue on／off 完成 65.8%／65.3%、0／75 runs 遺失、0 損壞；`2118bc66` 66.2%、0 遺失。(d2) 使跨 PID namespace（兩方向）與偽造 owner 情境由 `2118bc66` 的 20／20、10／10 遺失變為 0；(d3) 使 rename 前被殺留下的孤兒 temp 由 10／10 留存變為 0，且只在持鎖時刪除、活著寫入者的 temp 30／30 未被刪；(d4) 開啟時 E4 中 re-compose 不再觸發，完成率與關閉時相近（差異在同設定變動範圍內），代價是佇列等待與偶發的 SQLITE_BUSY 例外（8 個 intents，fail-closed）。

## 5. 評估方法（C3；計畫中）

本節為預先登記的評估設計，**均未執行**。規模數字是建議值，正式 seed 數與 repetitions 由 pilot（M3）調整。

### 5.1 RQ 與量測對應

| RQ | 主要指標 | 主要比較 |
|---|---|---|
| RQ1 | lost among committed、unsafe acceptance、false rejection、frame violations、receipt completeness | 完整 ATM vs 獨立 oracle；保守 vs 精確契約 |
| RQ2 | correct completion／offered、eligible coverage、goodput、p50/p95/p99/max 端到端延遲、attempts、eligible missing | 完整 ATM vs lock、CAS retry、Git three-way、bare composer |
| RQ3 | 上列指標對 patch 形狀、hot ratio、batch window、process 數的轉折 | 定向 sweep |
| RQ4 | write authority（附監測覆蓋率）、收據對帳率、角色檢查繞行測試 | 合作式 vs 刻意繞行的故障注入 |

### 5.2 實驗臂

control、stale 與 sync 保留為**診斷臂**；主效果相對至少兩種正確且可運作的強基線量測，否則只能證明安全方法優於故意不安全的整檔覆寫。

**表 E1　實驗臂**

| 類別 | 實驗臂 | 實作與角色 | 用途 | 狀態 |
|---|---|---|---|---|
| 診斷 | raw overwrite（control） | 無協調；舊 base 整檔覆寫 | 故障注入下界，不作正確性競爭者 | 既有〔作者報告值〕 |
| 診斷 | ATM admission only（stale） | 相同准入演算法與設定，省略 composer／steward | 隔離缺少提交協定的後果 | 既有〔作者報告值〕 |
| 診斷 | ideal sync | apply 當下同步 read-modify-write；列出理想化假設 | harness 正確性參考，**不**冒稱真實合併上界 | 既有〔作者報告值〕 |
| 主基線 | per-file lock | 鎖內讀最新 base、產生或重建變更、驗證並寫回 | 保守且正確的序列化基線 | 〔待 M2〕 |
| 主基線 | optimistic CAS retry | 由 snapshot 產生變更；CAS 失敗即重新產生或 rebase；重試全計入 | 一般 OCC 基線（Kung & Robinson 1981） | 〔待 M2〕 |
| 主基線 | Git three-way | 相同 base 與相同 patches 經 `git merge-file`；採同樣驗證與鎖定提交 | 既有合併能力與衝突偵測 | 〔待 M2；是否立即實作待作者決定〕 |
| 消融 | bare composer | 相同 immutable composer 與 guarded apply，移除 broker 准入 | 隔離合成收益與 ATM 路由治理的成本或增益 | 〔待 M2〕 |
| **方法** | **完整 ATM（composer＋steward）** | 真實 proposal API、batch closure、steward commit 與 retry | 完整方法；所有結果綁同一 frozen commit | 〔待 M2〕 |

**公平性控制**：

- `git merge-file` 是雙側三方合併；n-way 必須披露 fold 順序並測順序敏感性；不以 ours／theirs／union 選項掩蓋衝突。
- OCC 的 validation 與 write 必須共用不可分割的受保護提交區間。
- 相同 logical tasks、base fixtures、到達時間、patch 內容與依賴；優先使用**預先產生的 patch trace**，避免模型隨機性掩蓋合成差異。
- 所有正確基線使用相同 correctness oracle、timeout、retry budget、驗證要求與 durability 設定；不得只給 ATM 額外快取或較寬鬆的衝突政策。
- 若 Git 能合併 context 重疊案例而 ATM 拒絕，分開列**政策差異**與**執行失敗**，並報 eligible coverage；不把不同接受集合壓成單一成功率。
- 以固定到達負載與固定工作量各測一次；並行度、CPU／I/O 配額與 lock granularity 一致；記錄 warmup、執行順序與環境。

### 5.3 工作負載與邊界案例

先區分**文字相容**、**context 假衝突**、**真實寫入衝突**與**語意依賴**；高 hot ratio 與高 overlap 無法單獨代表所有風險。

**表 E2　預先登記的測試維度**

| 維度 | 最低必測 | 擴大實驗 |
|---|---|---|
| patch 形狀 | 等長替換、插入、刪除、多 hunk | rename、binary、mode、CRLF、無尾端換行（不支援者驗證拒絕） |
| 相對位置 | 上方插刪＋下方修改；首尾與相鄰邊界 | 重複 context、空檔、同 gap 純插入、零長區間 |
| 衝突關係 | 不重疊；context 重疊但變更不交疊；真 overlap | 跨 symbol 語意相依、跨檔 invariant、共同讀依賴 |
| 時間與基底 | 同 base；compose 後變更；late joiner | 混合 base、慢 writer、舊 proposal 重播、重複 delivery |
| 併發與熱度 | 1、2、4、8 workers；cold 與全 hot | 16、32 workers；hot ratio 0／0.5／0.8／1.0；偏斜分佈 |
| compose window | 0、短、中三檔；記實際 batch size | timer／count closure、負載自適應；對延遲 SLO |
| 執行環境 | 單 process async；2、4、8 processes | 多核心；多機僅在擴大協定範圍時加入 |
| 故障注入 | context mismatch、stale CAS、validator reject | lock timeout、kill、寫入失敗、rollback 失敗、收據遺失 |

**可知道正解的子集**：人工合成 workload 的每個 logical edit 帶不可重複的語意標識與基底座標；oracle 由**獨立參考實作**產生完整 expected output。context 重疊案例由獨立參考實作或人工規格判定應允許／應拒絕，避免受測 composer 同時充當裁判。另加入數個真實 repository、不同檔案類型（文件、設定、程式）的 patch traces；真 LLM 生成的 patch 屬外部效度補強，於 deterministic trace 主結果完成後另評。

### 5.4 Oracle 與指標分母（先於結果表）

**marker 不足以當唯一裁判**：舊 oracle（committed intent 的 marker 須出現在最終 worktree）會漏掉重複插入、鄰近內容破壞、錯位或語意錯誤；marker 不在也可能是後續合法刪除。最低 oracle 比較**完整 bytes**（或 AST／規格要求），再核對每個操作效果、frame property、唯一性與提交收據。

**表 E3　指標定義**

| 指標 | 分子／分母或量測點 |
|---|---|
| offered／attempted | offered＝唯一 logical operations；attempted 含所有 retry attempts；兩者分開 |
| eligible coverage | 依**預先登記的獨立政策**可處理之 operations／offered；不得以受測方法自己的接受結果循環定義 |
| commit rate | 唯一 committed operations／offered；另報 committed／eligible |
| correct completion | 通過保留、精確輸出與必要語意檢查的唯一 operations／offered |
| lost among committed | 已 acknowledged commit、且未被後續合法操作取代的應存效果中，終態遺失數／應存效果數 |
| eligible missing | 到 deadline 仍未正確完成的 eligible operations／eligible（含 blocked、超時、重試耗盡） |
| unsafe acceptance | 應拒絕卻提交的案例／獨立 oracle 判定應拒絕的案例 |
| false rejection | 依指定政策本可安全合成卻被拒的案例／該政策允許案例 |
| receipt completeness | 具完整可對帳收據的終端 attempts／全部終端 attempts（系統 crash 也列入） |
| goodput／tail latency | 正確完成 logical operations／wall seconds；端到端含排隊、window、retry、驗證與 commit |
| write authority | 已監測 I/O 的 proposer 直接寫入次數；附監測途徑與覆蓋率，不以零事件取代權限證明 |

**Oracle（r2 更新 2026-10-08）**：correct completion 與 lost 由 oracle v2（`c4-fullbytes-frame-v2`）判定——以不可變 base＋已提交操作由 oracle 自有 reference applier 產生期望全 bytes，並檢查 region 結構與 frame（未授權 bytes 必須逐位元不變）；合法後續刪除／取代判 superseded 而非 lost。6 類契約正負例全過，r1 presence oracle 在其中 4 例判錯（鄰近原文被改、缺 region 標籤、合法刪除、合法取代）。以 v2 重評 r1 既有 E1–E5、C4、D1–D5 raw：**0 個判定改變**；r2 E4 重播中 1 個撕裂檔只有 v2 能抓到。

**reject-all 可揭露**：拒絕全部提案也能得到 zero lost。主表因此必須同時報 offered、eligible、committed、correct、blocked、retry exhausted 與 unresolved，以及 goodput 與延遲。分母為零的格子標「不適用」，**不可**填 0% 當成安全成果。所有率標明 ratio of sums 或 mean of per-run ratios；不同版本、分母與 aggregation 不得接成單一提升百分比。

### 5.5 Seeds、推論單位與統計

- **workload seed 與 scheduler seed 分開**。舊稿「所有情境 `seed=42`、×3」只是同一 workload 的三次交錯重跑，**不是**三個獨立 workload。每個情境先產生多個獨立 workload seeds，再在各 seed 下重跑數個 scheduler seeds；各臂使用**配對**的 traces。
- **推論單位**為 workload（或 repository cluster），不把同一 run 內數百個相關 intents 當獨立樣本來縮窄 CI。主分析報 paired difference／ratio 的 95% CI；必要時用階層 bootstrap，另展示各 run。
- **零事件的解讀**：N 個獨立同分佈機會觀察到零次失敗時，一側 95% 二項上界為 `1 − 0.05^(1/N)`，N 大時約 `3/N`。支持「<1%」約需 299 個獨立零失敗樣本、「<0.1%」約 2,995、「<0.01%」約 29,956；不是 3 次重跑可以支持，且不能直接把同一 process 中高度相關的 intents 數當 N。全零 cluster 的普通 bootstrap 可能退化為 [0,0]，不能據此聲稱無風險。形式化命題（§4.4）處理其明定模型中的所有有效輸入；實驗上界只處理抽樣到的環境，兩者不可互相替代。
- **延遲**：報 p50、p95、p99、max、timeout 與完成率；不只算成功者延遲。354 個樣本的 p99 尾端約只有 3.54 個點，須揭露樣本量與分位數定義；不可平均各 run 的 p95／p99 後稱 pooled quantile。分段報 queue、compose window、validation、lock wait、write、retry；完成集合不同時另報 fixed-workload makespan。
- 先以少量 seed 做 pilot 估計變異，之後固定主要結果、最小實務效果、停止規則與種子集合。

### 5.6 消融（主要 RQ 之外，另標）

| 比較 | 測量重點 | 使用限制 |
|---|---|---|
| 完整方法 vs 舊循序套用（v0.1.17） | 行數位移、輸入排列與成功範圍 | 舊方法可能錯誤，只作機制診斷 |
| broker on vs off（＝bare composer） | 固定 composer 與提交路徑，測准入的淨增益與成本 | 避免把裸合併器收益全歸給 ATM |
| 保守 context vs 精確編輯範圍契約 | 安全性、false rejection、coverage | 精確策略需先有規格與獨立 oracle |
| compose window／batch size | 吞吐、tail latency、stale 與重提率 | 含 0 window 或可比序列基線 |
| 有無 retry／不同 retry budget | correct completion、liveness、額外 work | no retry 是受限臂，不能只報成功者 |
| 有無 registry CAS 與 apply lock | 殘留 lease、TOCTOU、lost effects | 明標 fault injection，與主比較隔離 |
| 有無驗證與角色檢查 | validator 成本、拒絕原因、監測到的寫入 | 移除安全機制的臂不作可部署推薦 |

### 5.7 分階段計畫與停止條件

本稿採用審閱的 M0–M5 分階段（取代 IMPL_PLAN 原 M0–M3 的論文級里程碑；IMPL_PLAN 的 M1 core 修正對應此處 M1，M2 harness 接線對應此處 M2，原 M3 論文級證據拆為此處 M3 pilot 與 M4 主結果）。

| 階段 | 工作與輸出 | 通過條件 |
|---|---|---|
| **M0 規格與校正** | 凍結版本錨點；選定相容性契約；列支援 patch、狀態機、信任模型、oracle 與分母；自 run 級整數重算舊表 | 所有主張有範圍與可測反例；基線與原始資料可定位 |
| **M1 單檔正確性** | S1–S5 加插刪、context、gap、重複 ID、stale base 與錯誤收據；小型枚舉與 property tests；完成 §4.4 證明 | 被接受者完整輸出正確；被拒者未改檔；失敗不被收據掩蓋 |
| **M2 Harness 真接線** | 完整 compose → steward commit；batch、retry、receipt；強基線臂；與獨立 oracle 對帳 | 每個 intent 追到終態；每筆時間可分解；無遺失事件紀錄 |
| **M3 配對 pilot** | 5 主臂（lock、CAS retry、Git、bare composer、完整 ATM）＋3 診斷臂；fixed decision／batch trace replay | 重算表與原始檔一致；找出變異與瓶頸；**不以 pilot 宣稱勝出** |
| **M4 最小主結果** | 預先固定 workload seeds 與 repetitions；單 process 與多 process | 同時報 correctness、coverage、goodput、tail latency 與 CI |
| **M5 重現與決策** | 全新環境重跑；原稿、artifact、版本與 figures 對帳 | 一個入口重建主要表；據結果決定完整論文或經驗報告 |

**建議最小主矩陣（未執行）**：3 workloads（cold／低競爭、hot 且不相交、hot 混合衝突）× 2 拓撲（1 process × 8 workers、8 processes × 1 worker）× 5 主臂 × 10 workload seeds × 3 次重啟＝900 runs；3 診斷臂只跑單 process＝270 runs；合計 1,170。每 run 1,000 offered logical operations，retry 另計。另有 24 類 correctness families × 10 輸入 × API／CLI 雙入口＝480 scenario jobs；故障測試 8 cutpoints × 3 機制 × 10 seeds × 單／多檔＝480 fault runs。三種 jobs 不同質，不加成同一統計樣本數。

**停止規則**：任何 arm 出現資料破壞、oracle 不一致或收據對不上時，不繼續產生效能結論；先保存失敗工件、界定根因與受影響版本，修正後重新凍結 commit，重跑受影響的全部對照臂。

---

## 6. 結果與 tradeoff（預留；〔待 M2/M4〕）

本節只有表格骨架。診斷臂列出的舊數字為**作者報告值**、使用舊 marker oracle 與舊分母、綁 Oct 6 core@0.1.2，**不可**與未來主臂數字直接比較；正式稿須在同一 frozen commit 上以 §5.4 的定義重跑全部臂。

**表 R1　正確性與完成結果（每情境；〔待 M2/M4〕）**

| 情境 | 臂 | offered | eligible | committed | correct | blocked | retry exhausted | unresolved | lost among committed | unsafe acc. | false rej. | receipt compl. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-a8 | control（診斷） | 354/rep〔作者報告值〕 | 不適用 | 354/rep〔作者報告值〕 | 〔待重算〕（舊 marker oracle pass/offered 28.5%〔作者報告值〕） | — | — | — | 253/rep（71.5%）〔作者報告值，舊 marker oracle〕 | 不適用 | 不適用 | 不適用 |
| h1-a8 | stale／native（診斷） | 354/rep〔作者報告值〕 | 不適用 | 266/rep〔作者報告值〕 | 〔待重算〕（舊 oracle pass/offered 26.4%〔作者報告值〕） | 准入 reject 88/rep〔作者報告值〕 | — | — | 172.7/rep（64.9%，分母＝committed；ratio-of-sums 518/798）〔作者報告值；A4 已核〕 | 不適用 | 不適用 | 不適用 |
| h1-a8 | sync（診斷） | 354/rep〔作者報告值〕 | 不適用 | 270/rep〔作者報告值〕 | 〔待重算〕（舊 oracle pass/offered 76.3%〔作者報告值〕） | 准入 reject 84/rep〔作者報告值〕 | — | — | 0〔作者報告值；理想 rebase〕 | 不適用 | 不適用 | 不適用 |
| 〔M4 workloads〕 | per-file lock | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| 〔M4 workloads〕 | CAS retry | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| 〔M4 workloads〕 | Git three-way | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| 〔M4 workloads〕 | bare composer | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| 〔M4 workloads〕 | **完整 ATM** | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |

（舊 R1 的 h1-a8 control「253（71.5%）」與 stale「172.7（64.9%）」保留原始計數與原始百分比；64.9%＝lost／commits（A4：ratio-of-sums 518/798），**不改**為以 354 為分母的 48.79%。committed 欄取自 `HOT_FILE_LATENCY.md` TL;DR；「correct」欄括號內為舊 marker oracle 的「有效成功率（oracle pass／intents）」，不等於 §5.4 的 correct completion。詳 `T6_R1_DENOMINATOR_AUDIT.md`。）

**表 R2　成本與進度（〔待 M2/M4〕）**

| 臂 | goodput（correct/s） | 端到端 p50/p95/p99/max | 分段：queue／window／validation／lock wait／write／retry | attempts／offered | fixed-workload makespan |
|---|---|---|---|---|---|
| sync（診斷） | 〔待重算〕 | 〔待重算〕（舊表 wall 2549 ms＝1.01× control、overhead mean/p95 4.21/6.75 ms〔作者報告值〕） | — | — | — |
| per-file lock | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| CAS retry | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| Git three-way | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| bare composer | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |
| **完整 ATM** | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 | 〔待 M2/M4〕 |

**表 R3　跨 process 提交層的版本演進（同一工作負載、同一時段重跑；E4 重播每版 75 runs、2,610 intents；harness 側鎖 off）**

每列只列：情境、前一版在該情境的失敗（含次數），以及本版在**同一配置**下的結果。完成與遺失分開列，不合併成單一指標，也不以完成率抵銷遺失。所有數字為作者自行執行、未獨立重現；版本差異與過程見附錄 E、F。

| 版本 | 本版修掉的情境（前一版失敗 → 本版同配置結果） | 本版之後被找到的反例 | E4 重播完成 | 失敗 runs | 遺失效果 |
|---|---|---|---|---|---|
| `5692474f`（基準） | — | 多 process steward 的 check-then-write：E4 重播 6／75 runs 遺失（合計 6 個效果）；seam barrier 40／40 次後寫者覆蓋先寫者 | 1,515／2,610（58.1%） | 6／75 | 6 |
| `bea35380` | 跨 process 提交鎖＋鎖內 base 比對＋tmp/rename：E4 重播 6／75 → 0／75 runs 遺失；seam barrier 40／40 → 0／40 | 不同 TMPDIR 的兩個 process 各用各的鎖：10／10 次遺失 1 個效果（r4 F4） | 1,534／2,610（58.8%） | 0／75 | 0 |
| `2118bc66` | 鎖改放 repo 內（不同 TMPDIR 共用）：10／10 → 0／10 遺失；區域重定、早期 stale 改 re-compose、有界重試：`file-hash-drift` blocked 768 → 0 | 持鎖者與競爭者在不同 PID namespace：兩方向各 10／10 次活著的持鎖者被判死、鎖被搶，遺失 1 個效果；偽造 owner 檔（死 pid 或錯 start token）而真持有者仍在：10／10 次被搶、遺失；rename 前被 SIGKILL 留下孤兒 temp 10／10 | 1,727／2,610（66.2%） | 0／75 | 0 |
| `37847584`（queue on，預設） | 核心層建議鎖：跨 PID namespace 兩方向 20／20 → 0／20 遺失（namespace 分離經確認 20／20）；偽造 owner 10／10 → 0／10；孤兒 temp 10／10 留存 → 0／10，且只在持鎖下刪除；活著寫入者的 temp 30／30 未被清理入口或下一個寫入者刪除 | 未發現遺失或損壞。另見可用性缺陷：apply 佇列開啟資料庫時偶發 SQLITE_BUSY 例外，8 個 intents 未完成（fail-closed，未寫入） | 1,716／2,610（65.8%） | 0／75 | 0 |
| `37847584`（queue off） | 同上（跨 namespace 20／20 → 0／20；偽造 owner 10／10 → 0／10；孤兒 temp 10／10 → 0／10；活 temp 30／30 未刪） | 未發現遺失或損壞；佇列例外不適用 | 1,705／2,610（65.3%） | 0／75 | 0 |

**表 R4　E4 重播主結果（r5；每臂 75 runs＝p2／seed 17 共 35 次＋p{2,4,8}×seed{11,17,23}×5；Wilson 95% 區間為描述性，intent 在 run 內不獨立，區間偏窄）**

| 臂 | 完成／intents | 完成 95% CI | 失敗 runs | 失敗 runs 95% CI | 遺失效果 | blocked（其中 hash-drift） | 例外未完成 | 損壞檔 | re-compose 事件／成功 |
|---|---|---|---|---|---:|---|---:|---:|---|
| `5692474f` | 1,515／2,610（58.1%） | 0.561–0.599 | 6／75 | 0.037–0.164 | 6 | 1,089（795） | 0 | 0 | 0／0 |
| `bea35380` | 1,534／2,610（58.8%） | 0.569–0.607 | 0／75 | 0–0.049 | 0 | 1,076（768） | 0 | 0 | 19／2 |
| `2118bc66` | 1,727／2,610（66.2%） | 0.643–0.680 | 0／75 | 0–0.049 | 0 | 883（0） | 0 | 0 | 103／29 |
| `37847584` queue on | 1,716／2,610（65.8%） | 0.639–0.675 | 0／75 | 0–0.049 | 0 | 894（0） | 3 | 0 | 0／0 |
| `37847584` queue off | 1,705／2,610（65.3%） | 0.635–0.671 | 0／75 | 0–0.049 | 0 | 905（0） | 0 | 0 | 105／35 |
| queue on＋maxRecompose 0 | 1,719／2,610（65.9%） | 0.640–0.677 | 0／75 | 0–0.049 | 0 | 891（0） | 2 | 0 | 0／0 |
| queue on＋maxRecompose 1 | 1,746／2,610（66.9%） | 0.651–0.687 | 0／75 | 0–0.049 | 0 | 864（0） | 2 | 0 | 0／0 |
| † queue off（同時段參照） | 1,759／2,610（67.4%） | 0.656–0.692 | 0／75 | 0–0.049 | 0 | 851（0） | 0 | 0 | 110／33 |
| † queue off＋maxRecompose 0 | 1,679／2,610（64.3%） | 0.625–0.661 | 0／75 | 0–0.049 | 0 | 931（0；其中 re-compose 用盡 109） | 0 | 0 | 96／0 |
| † queue off＋maxRecompose 1（無退避） | 1,723／2,610（66.0%） | 0.642–0.678 | 0／75 | 0–0.049 | 0 | 887（0） | 0 | 0 | 89／22 |

說明：剩餘 blocked 全部是 `steward-final-patch-required`（同批同區域、錨定列已改、或宣告列重疊；fail-closed，不寫入）以及上表「例外未完成」。前七列（含兩個預先登錄的消融臂）在同一時段逐 rep 交錯執行（17:44–17:54 CST）；後三列（†）為事後加跑（18:25–18:29 CST），與前七列不同時段。逐 run 配對（描述性）：queue on 對 `2118bc66` 較高 28、相同 15、較低 32 對（合計 −11）；queue off 對 queue on 較高 28、相同 13、較低 34 對（合計 −11）；`2118bc66` 對 `bea35380` 53／13／9（合計 +193）。

**re-compose 消融**：預先登錄的兩臂（queue on＋maxRecompose 0／1）無區分力：queue on 時 apply 先排隊再合成，E4 重播中 re-compose 從未觸發（三臂各 0 次），三臂走同一路徑，完成差異（1,716／1,719／1,746）屬同一設定的變動範圍。事後加跑 queue off 三臂（†，同一配置與 seeds、彼此同時段交錯）：預設 1,759（67.4%）、maxRecompose 0 為 1,679（64.3%；109 個 intents 以 re-compose 用盡結束）、maxRecompose 1（無退避）為 1,723（66.0%）；三臂皆 0 遺失、0 損壞。相對同時段預設的逐 run 配對：maxRecompose 0 較高／相同／較低 19／21／35 對（合計 −80），maxRecompose 1 為 28／13／34（合計 −36）。同一個 queue off 預設設定在兩個時段分別得 1,705 與 1,759（差 54 個 intents），這是本配置時段間變動的參考幅度；本表所有臂間差異都應對照此幅度閱讀，不作優劣解讀。

**表 R5　確定性 barrier 與故障情境（r5；兩 process；n＝每 variant 次數）**

| 情境 | 舊版結果 | `37847584` queue on | `37847584` queue off |
|---|---|---|---|
| seam barrier（兩方在合成後、提交前對齊；同區域／不同區域各 20） | `5692474f` 40／40 遺失；`bea35380`、`2118bc66` 0／40 | 探索性 5＋5：0 遺失（佇列使另一方等 10 s 後退回檔案鎖） | 0／40 遺失；同區域 20／20 fail-closed、不同區域 20／20 兩者皆落地 |
| stale-proposal barrier（各 20×2） | `bea35380`、`2118bc66` 0／40 | 0／40 | 0／40 |
| before-precheck barrier（各 20×2） | `2118bc66` 0／40 | 未跑（同 seam 理由） | 0／40 |
| 跨 PID namespace（真實 `unshare`；持鎖者在 host／在 namespace 各 10） | `2118bc66` 20／20 遺失 | 0／20 遺失；競爭者排隊後落地，兩者皆在 | 0／20 遺失；競爭者約 2.1 s 後 `recovery-required` |
| 偽造 owner 檔、真持有者存活（死 pid／錯 start token 各 5） | `2118bc66` 10／10 遺失 | 0／10 | 0／10（`recovery-required`） |
| 持鎖者在 rename 前被 SIGKILL（10） | `2118bc66` 0 遺失，但孤兒 temp 10／10 留存 | 0 遺失；孤兒 temp 10／10 由下一個持鎖者在取得鎖之後刪除，殘留 0 | 同左 |
| 活著寫入者的 temp（寫入者停在 rename 前 4.5 s；清理入口＋第二寫入者；3 種 namespace 配置各 10） | — | 30／30 temp 未被刪；清理入口 30／30 回報 `skippedLiveHolder`；0 遺失 | 同左 |
| 持鎖者 SIGKILL（取得鎖後）、偽造 owner（4 種）、活持有者逾時、不同 TMPDIR（4 種）、重試用盡（6 種） | — | 0 遺失、0 損壞 | 0 遺失、0 損壞 |
| 佇列等待逾時退回檔案鎖（等 300 ms；持有者 3.0／1.2 s） | — | 0／20 遺失；分別 `recovery-required`／落地 | 不適用 |
| E5 注入（context mismatch、stale CAS、apply 中被殺、rollback 成功／失敗、收據遺失；各 2） | 四個 pin（`5692474f`、`bea35380`、`2118bc66`、`37847584` on／off 五臂）皆 12／12 通過 | 12／12 | 12／12 |

**queue on 與 queue off（`37847584`，描述性）**：E4 重播完成 1,716 對 1,705（逐 run 配對較高／相同／較低 34／13／28 對，合計 +11）；遺失皆 0；queue on 時 re-compose 0 次，queue off 時 105 次、成功 35 次；E4 重播 wall mean 664 對 661 ms。單 process 回歸（steward，3 workloads×3 seeds×2 reps）queue off 比 on 每 intent 平均快 4.5 ms（−4.8%），apply 段快 4.5 ms（−9.7%）。故障情境中兩者皆 0 遺失，差在等待者的結局：queue on 排隊後落地，queue off 等 2 s 後 `recovery-required`。queue on 另有上述 SQLITE_BUSY 例外（E4 重播 7 個、完整 cells 1 個 intents，皆在 queue on 臂）。

**其他同場結果**：E4 完整 cells（r1 同 seeds，各 3 runs）：`37847584` queue on／off 在 p2／p4／p8 與兩種故障 cell 皆 0 遺失、0 損壞；單 process cell 94／106（`2118bc66` 102／106、`bea35380` 106／106；差異來自批次分組不同使同批重疊列增加，皆 fail-closed，n＝3）。單 process 回歸（`2118bc66`→`37847584` queue on）：五臂完成與遺失不變（steward 234／234、bare composer 224／234）；steward 每 intent total_ms 平均 87.6→93.7 ms（+6.9%），同 pin 兩 rep 間差 ±1.5 ms。

**CI（另列，非本文實驗）**：`37847584` 合併前 feature head 的 Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆 green（2026-10-08 17:14–17:28 CST）；merge commit 上四項亦皆 green（17:30–17:45 CST）。框架自帶的跨 namespace 測試在 CI 結束碼為 0，但 CI 記錄無法證明 `unshare` 情境真的互鎖（無 user namespace 時該測試印出 skip 並以成功結束）；本文的跨 namespace 結果只來自上表的本機重跑。

**可主張**：在上述 E4 重播、barrier 與故障情境配置下，`37847584`（queue on 與 off）未觀察到遺失效果或損壞檔，包括 `2118bc66` 會遺失的跨 PID namespace 與偽造 owner 情境；孤兒 temp 只在持鎖時刪除、活著寫入者的 temp 未被刪除。**不可主張**：零遺失已被證明；跨主機或網路檔案系統適用（只測同一 Linux 檔案系統）；佇列提高完成率（本次 queue on／off 差異在同設定變動範圍內）；任何優劣或非劣結論（未做顯著性或非劣性檢定）。Phase 3 450-run 主矩陣仍**未執行**；強基線、M1–M4 待補項不變。


**預定圖表**：

- 圖 1　責任與狀態流程：平行 proposal、batch closure、同基底合成、驗證、受控 commit、reject 與 re-propose；標出可信元件邊界〔待繪〕。
- 圖 2　最小反例：上方插入＋下方修改（探針 #2/#3），加同 gap、context 假衝突與 stale base 四例〔待繪〕。
- 圖 3　correct goodput 對 p95 latency 的 tradeoff；各點附 coverage 與 CI〔待 M4〕。
- 圖 4　completion outcomes 堆疊與 delay decomposition，讓 reject-all 與重試成本無處隱藏〔待 M4〕。

**預期的誠實揭露**：修正 P0-2／P0-3 後，熱檔同區撞車將大量轉為 blocked，commit rate 可能下降。這是要揭露的結果：論文同時報正確性（lost、unsafe acceptance、收據）與進度成本（blocked、eligible missing、attempts、tail latency）。若結果顯示完整 ATM 與正確強基線同等安全但成本較高，論文仍可呈現治理收據與責任分離的價值，前提是該價值被定義並量測（RQ4）。

---

## 7. 限制與相關工作

### 7.1 限制

**主張強度**

- **可主張（作者報告值、帶 caveat）**：在故障注入負面對照中，省略合成與提交協定時遺失率約 55–65%，與無協調 control 同量級；舊版所有「0 lost」綁理想 sync writer。
- **可描述但非結果**：v0.1.17 歷史基準的四類缺口（探針，質性、可重跑；artifact 待附）。
- **提交層驗證的強度上限**（§4.11、§6 表 R3–R5）：所有 runs、barrier 與故障情境皆為作者在單一 Linux 主機、單一檔案系統上自行執行，未獨立重現；「0 遺失」是有限次數的觀察，不是證明；Wilson 區間把 intent 視為獨立，實際區間應更寬。harness 的提案格式恰好帶區域身分，區域重定的完成率效果不能外推到無區域身分的提案。跨 PID namespace 只測同機 `unshare`，未測跨主機、網路檔案系統或容器 runtime。`37847584` 的 apply 佇列有偶發 SQLITE_BUSY 例外（fail-closed，8 個 intents 未完成）。CI 只跑框架測試，不重跑本文實驗，且不能證明 CI 上跨 namespace 測試真的互鎖。Phase 3 450-run 主矩陣仍未執行。
- **不可主張（待 M1–M4）**：全域無遺失更新、100% fail-closed、零越權寫入、合成的延遲成本、相對強基線的優劣；排列穩定等同可序列化；抽樣排列構成證明；角色字串構成 OS 隔離；多檔 rollback 等同 crash atomicity。

**設計限制**

- **契約保守性**：保守 context 規則會誤拒部分語意可合併的相鄰編輯；精確規則需獨立 oracle。細化至 symbol／AST-anchored 合成並接 Derived Atoms（CID v2、occupy-both、stale→file-level；v0.1.17 測試通過但無性能數據，T11 🟡）列為 P2-2。措辭沿用 v1 §6.1：adapter-guided，而非 AST-first——**不是**「ATM 不用 AST」。
- **語意衝突不在範圍**：文字相容不代表語意獨立（v1 §3.7 亦自我限定）。v0.1.17 語意驗證收據自簽且 `ok:true` 寫死（`steward-transactional-apply.ts:233-244`），需接 `post-compose-semantic-validation-policy.ts`／proposal validators（P1-1）。
- **不可合成即拒絕**：不做 LLM／人工解衝突（P2-1）；steward-authored final patch 只定義 fail-closed 介面與審核收據需求。
- **同區路由語意未定**（P1-4）。
- **兩條 composer 路徑**（`PatchProposal` vs `MutationRequest`）尚未統一（P2-3）。
- **信任模型**：合作式程序、可信 steward 與檔案系統；不主張 sandbox 或 OS 隔離（§1.2、§3.5）。
- **耐久性**：未測 kill／斷電與 fsync；不主張 crash atomicity 或多檔原子性（§4.8）。

**外部效度**

- 舊數字中，除 mp 臂外，agents 為單 process 內 async worker，共用 event loop；hold 為 20–60 ms 模擬，非真 LLM 秒級思考。
- 單一 fixture（`atm-bench-fixture-v1-ts`）、單機；跨機 registry 未測（符合 v1 單域定位）。
- 舊數字多為同一 seed（42）的 ×3 重跑，屬 scheduler 變異而非獨立 workload；未報 CI。
- 舊數字跨 core@0.1.2（Oct 6）與 v0.1.17；與 main `3b0f7660`（含 FileHeat、native hot parking）的行為差異未量測。

### 7.2 相關工作

**ATM v1**：寫入前准入與角色分離（§2.1）。本文是其提交層的協定化與端到端驗證。

**Claim Plane**：Nikolaev 的 Claim Plane（arXiv:2607.21909v1，*Enforceable Change Intents and Dynamic Scope for Parallel Coding Agents*）與其 confirmatory follow-up（arXiv:2608.00947v1，*Reliability Gains and the Limits of Selective Concurrency for Parallel Coding Agents*）〔書目依審閱轉述，待作者核對原文〕。Claim Plane 以宣告的資源／區域權限為核心，佔位採 contingent → JIT promote；依審閱，其內容**亦含 immutable patch integration**，因此**不能**簡化為「只做准入」。舊稿「Claim Plane 處理誰何時取得寫入權限、與本文屬不同層次」的定位須改寫為：兩者在同基底 patch 整合上有交集，差異在於〔待核對原文後比較：保證範圍、失敗政策、評估方法〕。關於其樣本規模、效能報告與公開時序的說法〔待核對原文〕，正式稿前不以肯定句出現；本文不與 Claim Plane 同表硬比效能。

**三方合併**：`git merge-file` 對共同 base 的雙側三方合併、衝突標記與 exit status 是本文最直接的既有能力基線（§5.2）。差異在於本文的合成只在 broker 准入之後發生、輸入已經過 CID／region 過濾、失敗時**拒絕**並回收據而非輸出衝突標記；n-way 時 Git 需 fold，本文為同基底一次構造。

**樂觀並行控制**：Kung & Robinson（1981，ACM TODS 6(2)）的 OCC 是 CAS retry 基線的理論出處；本文的 base digest 重驗＋互斥替換即為單檔 OCC 的 validation／write 階段（§3.4）。

**OT／CRDT**：Ellis & Gibbs（1989，SIGMOD）的 operational transformation 與 Shapiro 等（2011，SSS）的 CRDT 處理的是不同的操作／複本模型（持續協同編輯、最終收斂）。本文的同基底合成與 OT 的位置轉換技術上相近，但保證與失敗政策不同（本文不可合成即拒絕、不追求自動收斂）；宜比較保證與失敗政策，不做跨模型效能排名。

**v1 所引相鄰工作**：沿用 v1 的「協調粒度 × 介入點」組織（v1 §1.1、§2）：字元級／版本控制基底（CodeCRDT、EvoGit、AgentGit）；檔案／工作流治理（CodeTeam、SEMAP、MPAC）與代理並行控制（CoAgent、S-Bus、ATCC）；交易式工具效果（Atomix、Cordon）；事後 merge 衝突壓力（AgenticFlict）。完整書目〔待補全文對照〕。

**方法學參考**：Kalibera & Jones（2013）分層變異與量測設計；NIST exact binomial bounds 與 percentiles 定義；SQLite atomic commit 的 crash 測試方法（僅方法參考，非 ATM 保證）。

### 7.3 未來工作（依影響排序）

0. **（paper 2.0 必含，非延後項）** §4.11 提交層：r5 已驗證核心層建議鎖、持鎖下的孤兒 temp 清理與 apply 佇列（表 R3–R5）。仍待：apply 佇列開啟資料庫時的 SQLITE_BUSY 例外（應改為重試或退回檔案鎖並釋放 presence）；跨主機／網路檔案系統的鎖語意；以 CID 而非 region 標記錨定的 re-compose；無區域身分提案的完成率；佇列 on 時 seam／before-precheck barrier 的 10 s 等待；Phase 3 450-run 主矩陣與強基線。
1. 完成 M0–M1：選定契約、完成 §4.4 證明與 S1–S5 擴充測試；核定是否採 #198 契約。
2. M2–M4：真接線、強基線臂、配對 pilot 與最小主結果。
3. Batch closure 與重提協定的正式定義與成本量測（P1-2、P1-3），以及與 native hot parking（PR #199）的整合。
4. 語意驗證接線（P1-1）與 `BROKER_GUIDE.md`「Compose & steward apply」一節（P1-6）——v0.1.17 程式碼行為比文件描述弱（BROKER_GUIDE `:86`、`:123`）。
5. Steward-authored final patch（人或 LLM 解衝突）及其審核收據（P2-1）。
6. Symbol／AST-anchored 合成，接 Derived Atoms 的 atom 邊界（P2-2）。
7. 較強的權限治理：OS 帳號／容器權限、actor–process 綁定、canonical 路徑寫入限制與 symlink／hardlink／TOCTOU 測試。
8. 耐久性：kill／斷電、fsync、journal 恢復；多檔提交協定。
9. 耐久 serial ticket 端到端（`enqueueSerialIntent`＋eligible resume＋官方 position），使 #180 由 partial 推進到 full。
10. FileHeat（PR #197）的 hybrid／learned 模式評估——不得寫成完整 EMA 多訊號模型。
11. 規模：單 JSON registry 瓶頸、kill-9 stale-lock 回收、跨機（P2-4）；真 LLM／多 vendor 並行。

---

## 8. 結論

ATM v1 把寫入前准入立為一級治理問題，並把准入之後的同檔整合交給確定性 composer 與中立 steward。本文把這一半寫成一個受治理的合成提交協定（C1）與一份可檢驗的保留性契約（C2）：proposal 可平行準備，合成以批次對同一 immutable base 進行，canonical commit 經單一受控路徑完成，不可合成或過期的提案以描述真實終態的收據退回。

既有證據只足以支撐動機與歷史診斷：故障注入負面對照顯示，省略該層時遺失率與無協調同量級〔作者報告值〕；歷史基準 v0.1.17 的唯讀探針揭露循序套用造成的順序依賴、例外中斷與角色未比對。這些是對 v1 承諾的端到端驗證缺口，而不是新演算法。歷史基準有已知缺口，main 尚未含修正，候選契約待核定，主結果仍待測。

本文的實證貢獻（C3）——相對 lock、CAS retry 與 Git 三方合併，完整 ATM 能安全完成多少工作、付出多少延遲與重試成本——在本稿中仍是預先登記的設計〔待 M2/M4〕。若最終結果顯示同等安全但成本較高，論文仍可呈現治理收據與責任分離的價值；若相對強基線無實務差異，則應改為修正說明或經驗報告。

---

## 附錄 A：背景結果（冷熱准入、冷檔排隊、每筆成本、跨 process）

本附錄保留舊稿的支撐數字，**全部為作者報告值**，作為背景而非主結果；它們不直接回答 RQ1–RQ4，除非在 M4 以新定義重跑。所有「0 lost」均綁 **sync writer（理想 rebase）** 與舊 marker oracle。版本綁定：core@0.1.2（Oct 6）或 v0.1.17；**不代表** main `3b0f7660`（已含 FileHeat 與 native hot parking）。

### A.1 熱檔准入（T6 🟢，帶 caveat）

**表 A1　熱檔 h1-a8（trials 50、354 offered intents/rep、×3，同 seed）：Oct 6（core@0.1.2）vs v0.1.17〔作者報告值〕**

| 臂 | 指標 | Oct 6 | v0.1.17 |
|---|---|---|---|
| control | wall；lost 率 | 2522；71.5% | 2521；71.5% |
| native（sync） | wall（vs ctrl）；reject/rep；lost；成功率 | 2549（1.01×）；84（23.7%）；0；76.3% | 2557；86.7；0；75.5% |
| loop（harness overlay，sync） | wall；reject；lost；成功率 | 2908（1.15×）；0；0；100% | 3037；0；0；100% |
| nativestale | lost 率（分母＝committed） | 64.9% | 65.0% |
| loopstale | lost 率（分母＝committed） | 65.2% | 63.6% |

其他情境（Oct 6）：h1-a6 stale 55.5%／54.4%（native／loop）、h08-a8 64.6%／56.0%；control 63.9%、68.0%。h1-a8 native 決策分佈 composer_merge 210、hot_provisional 60、reject 84。

**Caveat**：loop 臂的 100% 成功歸功於 harness 的 hot-retry overlay；在 core@0.1.2／v0.1.17 上 core 無原生 park（原生 reject 17–24%）。此觀察**綁舊版本**；main 已合併 native hot parking（PR #199）〔審閱核對 2026-10-07〕，舊 overlay 數字不可回填為 native parking 的實測。

### A.2 冷檔 serial queue（T1–T3 🟢，#180 partial）

**表 A2　冷檔同檔（trials 60、`overlap=cold-same-file`、×3；matrix 2026-10-07 11:33:20–11:35:49 Asia/Taipei）〔作者報告值〕**

| 臂 | agents | wall（vs ctrl） | wait p50/p95/max (ms) | commits／pass／lost（每 rep） |
|---|---|---|---|---|
| control | 8 | 3024.78（1×） | — | 441／62／379 |
| nqwait | 8 | 6208.2（2.05×） | 62/259/350 | 441／441／0 |
| control | 16 | 3027.87（1×） | — | 879／64／815 |
| nqwait | 16 | 9416.48（3.11×） | 105/343/637 | 879／879／0 |
| nqwait 單檔（×1） | 16 | 40368.98（13.32×） | 679/759/794 | 879／879／0 |

control lost 率（推算）85.9%（a8）、92.7%（a16）。**Caveat**：#180 為 partial pass——harness 以輪詢 activeIntent file-blocker＋re-eval 實現等待，**未**呼叫 `enqueueSerialIntent`、未驗證耐久 FIFO ticket；`queue_position` 在 nqwait 臂為常數 1；0 lost 綁 sync writer。此 polling-wait 結果**不能**回填為 native ticket／resume 的實測。Oct 6 overlay 數字（2.03×／3.16×／13.2×，T4）僅為同量級對照（🟡）；V017 loop 臂數字不引用（🔴 T5）。

**與主軸的關係**：排隊以序列化換正確性，代價隨競爭從約 2× 升到最壞 13×〔作者報告值〕；這是 per-file lock 基線成本的粗略參考，但正式比較須以 §5.2 的 lock 臂在同一 frozen commit 重測。

### A.3 每筆准入成本與規模（T7、T9 🟢）

| 情境 | wall（vs ctrl） | overhead mean/p95 (ms) | lost |
|---|---|---|---|
| paced ×5（6 agents、168 intents/rep） | 1.03× | 5.21／7.14 | — |
| S3 1000 trials（7244 intents），sp | 1.001× | 4.77／6.45 | 0（ctrl 41.5%） |
| S3，8 procs | 1.001× | 9.35／20.9 | 0 |
| unpaced ×5（最壞上界，🟡） | 9.14× | 4.29／6.03 | — |

paced 拆解：latency_ms 2.92（p95 4.34）、apply_ms 2.2（p95 3.55）。**核對註記**：overhead mean 5.21 ms 與 2.92＋2.2＝5.12 ms 不完全相等，可能有未列 stage；且 overhead 含 apply_ms，故「約 5 ms／intent」不能稱為純准入成本〔待 M0 核對分段定義〕。unpaced 反映單 JSON registry＋fail-fast lock 的序列化瓶頸。以上為 core@0.1.2 數字。

### A.4 跨 process：CAS 與 apply 互斥（T8 🟢，負面對照）

| 情境／臂（core@0.1.2） | lost/rep | registry 殘留 | overhead mean/p95 |
|---|---|---|---|
| B control 8 procs | 201（71.3%） | — | 0.44／0.62 |
| B ATM 8 procs（CAS） | 0 | 0,0,0 | 8.69／21.63 |
| ⚠ B naive registry 8 procs | 0 | 37, 26, 32（殭屍 lease） | 14.6／36.3 |
| ⚠ B apply-lock off 8 procs | 2（1.0%） | 0,0,0 | 8.68／21.3 |

apply-lock off 的 1.0% lost 全部來自跨 process 的 composer_merge〔作者報告值〕：即使在 sync writer 下，合併路徑的寫入互斥一旦缺席就會丟更新。此為故障注入，與主比較隔離（§5.6）。

---

## 附錄 B：v1 承諾、歷史實現、候選版本與本文貢獻

| v1 承諾 | v1 位置 | 歷史基準 v0.1.17 `8dd6a1c6` | main `3b0f7660`〔審閱核對〕 | 候選 PR #198 `65e8aab3`（未合併） | 本文 |
|---|---|---|---|---|---|
| 同檔有界不相交 → composer＋中立 steward，不直接寫 | §3.4 Alg. 1 safety note；Table 4 | 路徑存在；compose 判定正確（探針 #1–#3 皆 `parallel-safe`） | 同 v0.1.17 | — | 保留；C1 協定化 |
| 套用時位移由 composer／steward／CAS 吸收 | §3.5 | **未吸收**：探針 #2 throw、#3 成功（順序依賴） | text steward 同 blob，未修 | immutable-base 合成；context 契約與本稿不同 | C2 命題＋契約選擇 |
| blocked 是 containment，保留意圖 | §3.4 | 重疊時檔案未變，但 throw、無收據（探針 #4） | 未修 | 新檢查〔細節待核對〕 | §3.6 收據終態 |
| 中立 steward 為唯一正式套用權威 | §3.2 | 提案者可自我 apply（探針 #5） | 未修 | 僅比對去空白標籤；空 ID 無錯；無 kind 參數 | 角色一致性檢查；RQ4 |
| CAS base-hash 重驗 | §3.5 第 6 層 | 寫入已檢查 base hash；rollback 良好 | 同 | — | §3.4 提交界線；S4／S5 回歸 |
| POS2 為同檔寫入鏈正向現場案例 | §3.5、§4.5 | 單例現場證據 | — | — | 系統性量測〔待 M2/M4〕 |
| SERIAL：queue or serialize | Table 4 | 冷檔原生 `queue`（#180 partial） | — | — | 背景（附錄 A.2） |
| Late-joiner park／re-arbitration | §3.5 | 舊 harness 路徑觀察不到 park | native hot parking 已由 PR #199 合併 | — | 與 batch closure 整合待 M2 |

v1 錨點：`v0.9.0-alpha.1` 的 tag object `0b31aa86`，peeled source commit `a897f144`；後來版本的缺陷不倒推至此版。

## 附錄 C：Artifact、重現與待補實驗封包

**已有（box 本機）**

- 歷史基準：tag v0.1.17，commit `8dd6a1c6`（`/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`）；Oct 6 baseline HEAD `ed317820`。
- 探針：`runs/composer-probe/probe.mts`、`probe.out`（Node v24.21.0；唯讀 import，不改 ATM 樹）。
- 支撐 runs：`runs/hot-file/`、`runs/v017/`、`runs/v017-q180/`、`runs/compare/`、`runs/multiprocess/`、`runs/scale/`。
- Issue：#196（2026-10-07 開）。本稿撰寫時未修改 ATM monorepo、未開 PR、未 push／publish。

**待補的可核驗實驗封包（投稿前）**

| 資料 | 最低內容 |
|---|---|
| 版本 manifest | ATM 與 harness 完整 SHA、Git dirty 狀態、lockfile、Node／OS／硬體；每個 run ID 的設定 |
| 原始事件與終態 | 逐 proposal／attempt／batch／commit 事件；base 與 patch digest；最後檔案；失敗與 timeout 也保留 |
| 可執行入口 | `probe.mts`、產生器、獨立 oracle、彙整腳本與一鍵重建主表命令 |
| 舊表來源 | `PAPER_V2_KEY_TABLES`、`HOT_FILE_LATENCY`、composer probe 輸出，以及 T6／R1 每 run 的分子分母 |
| 重現清單 | workload／scheduler seed pairs、運行順序、warmup、timeout／retry、Git flags、expected fixtures 與 raw checksums |

## 附錄 D：本稿刻意降調處一覽

| 處 | 降調方式 |
|---|---|
| 題名 | 「真正平行合併」改為「確定性合成與受治理提交」；proposal 平行、commit 單一路徑 |
| 貢獻 | 收斂為 C1–C3；四項歷史缺口修復不列為新演算法 |
| 主結果 | 一律〔待 M2/M4〕；不寫已證明零 lost |
| stale／raw overwrite | 故障注入負面對照，非 ATM 能力界線；主比較改為強基線 |
| 既有「0 lost」 | 綁 sync writer 與舊 marker oracle；作者報告值 |
| 「同一組准入決策」 | 改為相同 seed 與設定；實際序列未必相同，需 trace replay |
| `permutationStable` | 寫死值，非證明；更名 composition determinism；排列測試≠可序列化 |
| `@@` old range | 依 GNU 更正為含 context＋刪除行；分 changed／context／gap |
| identity gate | 改稱角色一致性檢查；零直接寫入＝監測路徑觀測 |
| temp／rollback | 拆成例外補償／單檔替換／crash／多檔可見性；不稱 crash atomicity |
| 「全部尚未修好」 | 改為版本分層句（§2.2） |
| #184／park | 改為 PR #197／#199 已合併的分層敘述；舊 polling-wait 不回填 |
| R1 分母 | 保留 64.9%（分母 committed，A4 已核 ratio-of-sums）；不改 48.79% |
| seed 42 ×3 | 改稱 scheduler 變異；推論單位為獨立 workload |
| 約 5 ms／intent | 標註含 apply_ms 且分段不相加 |
| 156 pairs | 不等於 intents 或 blocked 數 |
| Claim Plane | 同引 2607.21909 與 2608.00947；不簡化為只做准入；〔待核對原文〕 |
| Derived Atoms | 僅 future work |

---

## 附錄 E：提交層驗證回合紀錄（r2–r4 原文；過程、版本、PR 與鑑識）

本附錄保存 r2–r4 各回合寫在 §6 的原文（含 PR 編號、鑑識過程、各回合措辭協議），內容未改，只從正文移出；正文 §6 依「只陳述結果」的原則改寫。r5 過程紀錄見附錄 F。各回合不可變封包見 `research/paper-v2/generations/`（EVIDENCE_INDEX）。原文中提到的「表 R3／R3b／R4」即本附錄的表 E-R3／E-R3b／E-R4；原文中的「§4.11」指 E.4 所存的 r4 版 4.11。

**表 E-R3　跨 process 與故障注入（DRAFT；r2 更新 2026-10-08：E4 反例成立，依 §5.7 停止規則撤回 MP 正確性結論）**

E4（2／4／8 processes，各 3 seeds）r1 主臂中 **p2／workload seed 17／scheduler seed 1017 一格 correct=20、lost=1、blocked=13**。r2 鑑識（`runs/r2-e4-forensics/E4_FORENSICS.md`）確認這**不是** oracle 或計數假象，而是真實的跨 process 正確性失敗：

1. E4 拓撲中每個 OS process 各有一個「中立 steward」，而 harness 的 `--apply-lock on` **未包住** steward compose＋apply（兩個 worker 的 apply-lock spins 皆為 0）；論文「單一 steward 寫入者」前提在此拓撲被違反。r1 標成「CAS＋apply-lock on」的 MP 主臂與「apply-lock off」故障臂，對 steward 路徑實際上相同。
2. ATM pin 的 transactional apply 為 check-then-write（stale check、重讀、`writeFileSync` 之間無跨 process 鎖或原子 CAS；寫入非 tmp＋rename）。逐位元證據：後寫 process 的收據 beforeHash＝base＋i0、afterHash＝base＋i6，i0 被以舊 base 合成的內容覆蓋；另一重播中兩個 process 幾乎同時寫入造成撕裂檔（檔尾多 1 byte），v2 oracle 以 frame 檢查抓到。
3. 每個 process 自己的 batch 計數器使 15 個 MP cells 中 14 個出現跨 process 同名 batch id，steward 收據檔互相覆蓋——**收據完整性在 r1 E4 不成立**。

| 設定（r2 重播，同 workload hash） | runs | 失敗 runs（lost／frame／duplicate>0） | lost 效果 | 撕裂／frame 違規檔 | 帶競態特徵 runs |
|------|-----:|-----:|-----:|-----:|-----:|
| r1 設定（steward 未加跨 process 鎖） | 75 | 4 | 6 | 1 | 4（4/4 失敗皆有） |
| r2 候選緩解（harness 側 steward compose＋apply 跨 process 鎖） | 75 | 0 | 0 | 0 | 0 |

可主張：在 r1 E4 設定下，多 process steward **會**遺失已 ack 的效果（發生率低但非零；精確格 35 次重播中 2 次失敗）。不可主張：多 process 零遺失；緩解已被證明（75 次 0 失敗只是觀察，非證明）。緩解另有成本：平均 wall p2 572→609 ms、p8 687→907 ms〔作者報告值〕。正確修復需二選一並配契約測試：(a) 部署契約限定每個 canonical root 僅一個 steward 寫入者；(b) ATM 提供跨 process 原子 CAS／鎖，且收據 beforeHash≠合成 base 時 fail-closed。receipt completeness、registry 殘留與 cutpoint 矩陣仍〔待 M4〕。

**表 E-R3b　r3 更新（2026-10-08；措辭依作者與外部審閱者協議修訂 2026-10-08 13:51）：ATM PR #213（merge `bea35380`）修正後的驗證（DRAFT；上方 r1／r2 反例文字保留為歷史，不刪改；不主張勝出）**

**資料來源與獨立性**：r3 共 483 個 run（E4 重播 225、r1 E4 cells 重跑 45、單 process 回歸 180、單 process E4 雜訊補測 30、smoke 3）全部由**作者自行執行**（同一台機器，2026-10-08 10:45–10:55 Asia/Taipei），**尚未經獨立重現**。raw、腳本與 SHA256 見 evidence generation r3。

**CI（另列，不是論文實驗）**：PR #213 head `4d7c9ed6` 的 4 個 GitHub Actions 檢查（ATM Dogfood、Product CI、neutrality-scan、sandbox-gate）與 merge `bea35380` 的 6 個 check runs 全部 success（2026-10-08 10:27–11:49 Asia/Taipei）；PR 自述本機 `npm test` 13 個 validator、0 失敗。CI 只跑框架自身測試，**不**重跑本文任何實驗，不能作為 E4／barrier 結果的佐證。

修正內容（依 PR 與程式碼閱讀）：`applyTransactionalStewardPlan` 在鎖外合成與驗證；每個目標檔一把跨 process 鎖（`<os.tmpdir>/atm-steward-commit-locks/<sha256(realpath)>`，pid 檔記錄擁有者），鎖內只做「重讀＋與合成 base 比對 hash＋同目錄 temp 寫入＋rename」；base 不符回 `re-compose` 且不寫入；`applyStewardPlan` 內最多重合成一次，仍無法提交則公開結果為 `blocked`（公開 enum 仍為 `applied`｜`blocked`）。驗證全程 harness 側 `--steward-apply-lock` **關閉**（主比較：檢驗 ATM 本身），另以開啟作次要臂；兩個 ATM pin 並存、互不覆寫（`runs/r3-validation/PINS.json`）。

(1) 確定性 barrier 交錯測試（`test/barrier_interleave.mjs`，harness 層 node:fs 攔截，不改 ATM 原始碼）：兩個 process 對同一 base 合成後，都停在「unlocked 檢查之後、第一個 canonical 變更 syscall 之前」；leader 先完成提交，follower 才放行。每案 20 次，每次最多可能遺失 1 個效果（leader 的效果）。

| 案例 | ATM pin | window 命中 | 遺失效果（合計，20 次） | follower 結果 | 最終 bytes |
|---|---|---:|---:|---|---|
| 同 region | 5692474f | 20/20 | **20**（每次 1 個） | `applied`，覆寫 leader | 只剩 follower 的效果 |
| 同 region | bea35380 | 20/20 | 0 | 1 次 commit 嘗試→re-compose→重合成 `compose-context-mismatch`→`blocked` | 逐位元＝只含 leader 效果 |
| leader 改下方、follower 改上方 | 5692474f | 20/20 | **20**（每次 1 個） | `applied`，覆寫 leader | 只剩 follower 的效果 |
| leader 改下方、follower 改上方 | bea35380 | 20/20 | 0 | 2 次 commit 嘗試（re-compose 後成功）`applied` | 逐位元＝兩個效果皆在 |

(2) E4 重播（與 r2 鑑識同配置、同 seeds 與次數：每臂 75 runs，含 p2／s17 共 35 次；三臂逐 run 交錯執行，同時段同機器），以 oracle v2（全 bytes＋frame／structure）評分。下表各欄分開列，不合併成單一「成功率」：

| 臂 | ATM pin | harness steward 鎖 | 完成 intents／總 intents | 失敗 runs／總 runs | 遺失效果（合計） | blocked intents | 損壞檔 | re-compose 事件（batch） | wall ms mean／p95 |
|---|---|---|---|---|---:|---:|---:|---:|---|
| old（同時段對照） | 5692474f | off | 1,519／2,610（58.2%） | 8／75 | 12 | 1,079 | 0 | — | 591.9／713.9 |
| **fix（主比較）** | bea35380 | off | **1,524／2,610（58.4%）** | **0／75** | **0** | 1,086 | 0 | 18 | 594.8／717.8 |
| fixlock（次要） | bea35380 | on | 1,592／2,610（61.0%） | 0／75 | 0 | 1,018 | 0 | 0 | 688.3／972.7 |

讀法：每臂「完成＋遺失＋blocked＝總 intents」（old：1,519＋12＋1,079＝2,610；fix：1,524＋0＋1,086＝2,610）。old 臂 75 次重播中有 8 次 run 失敗，合計遺失 12 個效果（不是 12 次失敗）；fix 臂為 0 次失敗、0 個遺失效果。完成數 old 1,519 對 fix 1,524：**在這次觀察中完成數沒有下降**，但兩者都只有約 58%，其餘約 42% 以 `blocked` 結束；因此**不可**寫成「全部成功」，也**不可**寫成「已在統計上證明不劣於（non-inferior）舊版」——本回合未做非劣性檢定或 CI。

分組：p2／s17 35 次：old 2／35 runs 失敗、合計遺失 3 個效果、完成 752／1,190；fix 0／35、0、758／1,190。p8 格 15 次：old 4／15 runs 失敗、合計遺失 4 個效果、完成 274／530；fix 0／15、0、278／530。r1 E4 18 個完整 cells 於兩個 pin 重跑：old 只有 `fault_naive` p8 s23 一格遺失 1 個效果（1／18 cells 失敗）；fix 0／18、0 個遺失、損壞 0；fixlock（9 個主臂格）0／9。單 process E4 兩 pin 各 18 次：完成皆 592／636、遺失 0（每 seed 分布重疊，差異屬排程雜訊）。

(3) blocked intents 依最終理由（分列；全部計為非完成，goodput 只計完成）：

| 最終理由 | old（5692474f） | fix（bea35380） | fixlock |
|---|---:|---:|---:|
| `file-hash-drift`（提案 base 已過期） | 782 | 779 | 805 |
| `steward-final-patch-required` | 229 | 218 | 213 |
| 未上鎖的早期 stale 檢查（bea35380 仍直接回 `blocked`，**不**觸發 re-compose） | 66 | 70 | 0 |
| re-compose 後重合成失敗（`compose-context-mismatch`） | — | 15 | 0 |
| 其他 `compose-context-mismatch` | 2 | 4 | 0 |
| **blocked 合計** | **1,079** | **1,086** | **1,018** |

re-compose 另列：fix 臂 18 次 re-compose 事件中**只有 3 次**後續成功提交（這 3 個已計入上表「完成」），15 次後續仍 `blocked`（計入上表）。公開理由以 `re-compose:`／`recovery-required:` 開頭者 0 次（harness 的 proposal 是行號／context 錨定的 patch，重合成多半以 context 不符結束，而非再次 base 不符）。鎖競爭輪詢合計 9 次，無 lock timeout。

(4) 成本（照實陳述）：多 process 重播 fix 相對 old，wall mean +0.5%（591.9→594.8 ms）、p95 +3.9 ms；每 intent total_ms mean 93.9→95.0 ms、p95 210.7→220.0 ms。harness 鎖再疊加成本明顯：fixlock wall mean 688.3 ms、p8 平均 894.7 ms（fix 645.6 ms）。單 process 回歸（E2 子集：3 workloads × 5 arms × 3 seeds × 2 reps）：15 組正確性計數兩 pin **完全相同**；steward 臂每 intent total_ms mean +0.23 ms（+0.3%）、p50 +0.98 ms、p95 −6.55 ms，在同 pin rep 間雜訊（最大 7.7 ms）之內；bare composer（同用 `applyStewardPlan`）mean +2.95 ms（+1.8%）、p95 +9.5 ms、apply_ms mean +2.44 ms，三個 workload 方向一致（+1.4～2.5%）且超過其同 pin rep 間雜訊（約 0.3 ms），視為可量測成本；未改動程式路徑的 file lock／OCC／Git 三方 |Δmean| ≤ 0.4%，作雜訊下限。執行順序固定 old 先、fix 後，順序偏差未排除。

(5) **明確未做**（不得在正文暗示已涵蓋）：
- Phase 3 的 450-run 主矩陣：**未執行**（r3 的 483 個 run 是 PR #213 的驗證回合，不是主矩陣）。
- 故障情境：lock timeout（等待超過 `lockWaitMs`）、持鎖 process 被 kill、跨容器／不同 tmp 目錄／網路檔案系統、`recovery-required` 路徑（含 pid 回收）——**全部未測**；r3 期間這些路徑觸發 0 次，不代表其行為正確。
- 斷電耐久性（未 fsync，與舊版相同）、非 ATM 外部寫入者、harness re-propose（仍為 stub）：未處理。

可主張：在 r2 的 E4 重播設定與確定性 barrier 交錯下，bea35380 未觀察到遺失效果或損壞檔，且不依賴 harness 側鎖；barrier 測試把 5692474f 的 lost update 以確定性方式重現（每案 20 次、每次遺失 1 個效果），bea35380 為 0。不可主張：多 process 零遺失已被證明（75 次觀察與兩種強制交錯不是證明）；修正提高或維持完成率已被統計證明（1,524 對 1,519 只是一次觀察，兩者約 58%）；re-compose 能可靠挽回提案（18 次中 3 次）；任何勝出。依 §5.7，r2 撤回的 MP 正確性結論**不**自動恢復；r3 只補上「修正後在相同設定下未再觀察到」與一個可重跑的確定性反例測試。另：新 pin 的收據 `beforeHash` 改為合成 base，harness 的 `interleave_suspect` 特徵在 fix 臂出現 4 次假陽性，oracle v2 確認均無遺失。完成率偏低的對策與其 r4 驗證見 §4.11 與表 R4。

**表 E-R4　r4 更新（2026-10-08）：ATM PR #214（merge `2118bc66`）steward 完成率最佳化的驗證（DRAFT；上方 r1–r3 文字保留為歷史；不主張勝出）**

**資料來源與獨立性**：r4 共 693 個 run（E4 重播 450＝6 臂 × 75、r1 E4 cells 63、單 process 回歸 180），另 barrier 240 次（seam 120、stale-proposal 80、before-precheck 40；另有 40 次 before-precheck v1 因 leader 未等待 follower 進入檢查點而作廢，保留於 raw 並標示 superseded）與故障情境 245 次（2118bc66 135、bea35380 110），全部由**作者自行執行**（同一台機器，2026-10-08 14:37–14:58 Asia/Taipei），**尚未經獨立重現**。三個 ATM pin 並存、唯讀，run 後核對 core 樹 hash 不變（`runs/r4-validation/PINS.json`）。PR #214 自述的 14-run 結果（287／488→325／488、0 lost）本文未重跑其確切 grid，只在 75-run 設定下觀察到同方向。

**CI（另列，不是論文實驗）**：PR #214 feature `b5729456` 的 4 個 GitHub Actions 檢查（14:17–14:26）與 merge `2118bc66` 的 4 個檢查（Product CI、ATM Dogfood、neutrality-scan、sandbox-gate；14:27–14:39 Asia/Taipei）全部 success；PR 自述本機 `npm test` 13／13、`validate-broker-steward`／`validate-broker-cowrite` 通過。CI 只跑框架自身測試，**不**重跑本文任何實驗。

(1) E4 重播（r3 同配置與 seeds：每臂 75 runs，含 p2／s17 共 35 次；所有臂逐 run 交錯、同時段同機器；oracle v2 評分）。各欄分開列，不合併成單一成功率：

| 臂 | ATM pin | harness 鎖 | 完成 intents／總 intents | 失敗 runs／總 runs | 遺失效果（合計） | blocked intents | 損壞檔 | re-compose 事件／成功 | wall ms mean／p95 | 每 intent total_ms mean／p95 |
|---|---|---|---|---|---:|---:|---:|---|---|---|
| old（修正前對照） | 5692474f | off | 1,580／2,610（60.5%） | 5／75 | 6 | 1,024 | 0 | — | 594.7／718.7 | 93.2／210.2 |
| fix（PR #213） | bea35380 | off | 1,553／2,610（59.5%） | 0／75 | 0 | 1,057 | 0 | 16／2 | 583.9／722.4 | 93.6／211.6 |
| **opt（主；PR #214）** | 2118bc66 | off | **1,748／2,610（67.0%）** | **0／75** | **0** | 862 | 0 | 91／24 | 597.1／738.7 | 96.0／221.7 |
| optlock（次要） | 2118bc66 | on | 1,841／2,610（70.5%） | 0／75 | 0 | 769 | 0 | 0／0 | 712.0／1,002.3 | 115.5／307.5 |

讀法：每臂完成＋遺失＋blocked＝2,610（old：1,580＋6＋1,024）。old 臂 75 次重播中 5 次 run 失敗，合計遺失 6 個效果（r3 同配置為 8 次、12 個；同一反例的另一次觀察）；fix 與 opt 皆 0 次失敗、0 個遺失效果。完成數 opt 1,748 對 fix 1,553：**在這次觀察中較高**；逐 run 配對（同 seed／配置／rep）75 對中 55 對較高、6 對相同、14 對較低，每 run 平均 +2.6（描述性，**不是**顯著性檢定）。同一 fix 臂在 r3 為 1,524、r4 為 1,553，場次間差約 29 個 intents（約 1.1 個百分點），可作為雜訊量級參考。opt 仍約 33% 以 `blocked` 結束，**不可**寫成全部成功，也**不可**寫成已在統計上證明較佳或不劣。

分組：p2／s17 35 次：old 3／35 runs 失敗、合計遺失 3 個效果、完成 771／1,190；fix 0／35、0、766／1,190；opt 0／35、0、794／1,190。p8 格 15 次：old 1／15、遺失 1、296／530；fix 0／15、0、293／530；opt 0／15、0、358／530。r1 E4 18 個 cells（不含 SP 共 15 個 MP cells）：old 2／15 cells 失敗（`fault_naive` p8、`fault_nolock` p8 各遺失 1 個效果），完成 309／530；fix 0／15、0、286／530；opt 0／15、0、372／530；optlock（9 格）0／9、0、223／318。單 process E4 三 pin 各 3 次皆 98／106、遺失 0。

(2) blocked intents 依最終理由（分列；全部計為非完成）：

| 最終理由 | old 5692474f | fix bea35380 | opt 2118bc66 | optlock |
|---|---:|---:|---:|---:|
| `file-hash-drift`（提案 base 已過期，計畫階段） | 742 | 785 | 0 | 0 |
| 未上鎖早期 stale 檢查 | 62 | 68 | 0 | 0 |
| re-compose 後重合成失敗（`compose-context-mismatch`） | — | 16 | 0 | 0 |
| 其他 `compose-context-mismatch` | 5 | 7 | 0 | 0 |
| `steward-final-patch-required`：同批次行號合成重疊 | 215 | 181 | 181 | 219 |
| `steward-final-patch-required`：區域錨定列已被改（區域重定拒絕） | — | — | 479 | 474 |
| 同上，發生於 re-compose 之後 | — | — | 81 | 0 |
| `steward-final-patch-required`：同批兩份提案同區域（區域重定拒絕） | — | — | 121 | 76 |
| `re-compose attempts exhausted`／`recovery-required:` | 0／0 | 0／0 | 0／0 | 0／0 |
| **blocked 合計** | **1,024** | **1,057** | **862** | **769** |

re-compose：opt 91 次事件中 24 次後續成功提交（26 個 intents，已計入完成），67 次後續仍 blocked（81 個 intents）；fix 16 次中 2 次成功。每 batch 嘗試次數分布（batches）：fix 0 次 720、1 次 1,457、2 次 2；opt 0 次 512、1 次 1,659、2 次 24（「0 次」＝在計畫／合成階段即 blocked，未進入 transactional apply）。**沒有任何 batch 用到第 3 次以上嘗試**。

(3) 消融（同場次交錯；只有 (c) 可經公開輸入關閉）：

| 臂 | 設定 | 完成／總 intents | 失敗 runs | 遺失效果 | blocked（其中重試用盡） | re-compose 事件／成功 | wall ms mean／p95 |
|---|---|---|---:|---:|---|---|---|
| opt | 2118bc66 預設（重試 4、退避 4 ms、jitter 3 ms） | 1,748（67.0%） | 0／75 | 0 | 862（0） | 91／24 | 597.1／738.7 |
| optr1 | 重試 1、退避 0、jitter 0 | 1,752（67.1%） | 0／75 | 0 | 858（1） | 104／33 | 601.3／718.2 |
| optr0 | 重試 0（(b) 的 re-compose 直接結束） | 1,718（65.8%） | 0／75 | 0 | 892（99） | 85／0 | 605.3／743.5 |
| fix | bea35380（無 (a)–(d)） | 1,553（59.5%） | 0／75 | 0 | 1,057（—） | 16／2 | 583.9／722.4 |

逐 run 配對（描述性）：optr0 對 opt 30 高／12 同／33 低（合計 −30）；optr1 對 opt 33／14／28（＋4）；optr0 對 fix 53／8／14（＋165）。解讀（只限此工作負載）：重試相對不重試約多 30 個完成，與場次間雜訊（約 29）同量級；多於 1 次的重試與退避未觀察到作用。fix→opt 的差距大部分在 optr0 已出現，推測主要來自 (a)＋(b)（含計畫階段的區域重定），但 (a)、(b) 無法分離，(d) 推測不影響完成率——均為推論，非量測。

(4) 確定性 barrier（每案 20 次；harness 層 node:fs 攔截與 ATM 轉送的 `commitHooks.beforePrecheck` 測試接縫；不改 ATM 原始碼）：

| 模式／案例 | 5692474f | bea35380 | 2118bc66 |
|---|---|---|---|
| seam（兩者停在第一個 canonical 變更 syscall 前；= r3）同 region | window 20／20；每次遺失 1 個效果（合計 20） | 0；follower re-compose 後 `compose-context-mismatch`→blocked；逐位元＝只含 leader | 0；follower re-compose 後 `steward-final-patch-required`（區域已改）→blocked；逐位元＝只含 leader |
| seam，上下分離 | 合計遺失 20 | 0；re-compose 後 applied，兩效果皆在 | 0；re-compose 後 applied，兩效果皆在 |
| stale-proposal（follower 提案建於 base B，leader 提交後才 apply；測 (a)）同 region | 未測 | 0；`file-hash-drift` blocked | 0；`steward-final-patch-required` blocked |
| stale-proposal，上下分離 | 未測 | 0；`file-hash-drift` blocked（follower 效果未落地） | 0；applied，兩效果皆在（full bytes 20／20） |
| before-precheck（follower 停在 ATM 合成後、未上鎖檢查前，leader 此時提交；測 (b)）同 region | 不可測（無此接縫） | 不可測（不轉送 hook） | 0；早期 stale→re-compose→`steward-final-patch-required` blocked（20／20） |
| before-precheck，上下分離 | 不可測 | 不可測 | 0；re-compose 後 applied，兩效果皆在（20／20） |

(5) 故障情境（harness 層；2118bc66 主、bea35380 對照；5692474f 無提交鎖，不適用）：

| 情境 | 2118bc66 | bea35380 |
|---|---|---|
| F1 持鎖者取得鎖後即被 SIGKILL（10 次） | 下一個 process 回收鎖並 applied 10／10；0 遺失；無殘留 | 同左 |
| F1 持鎖者在 temp 已寫、rename 前被 SIGKILL（10 次） | applied 10／10、0 遺失；**孤兒 temp 檔殘留 10／10** | 同左（殘留 10／10） |
| F2 偽造 owner：pid 存活但 start token 不符（模擬 pid 重用；5 次） | 回收並 applied 5／5（約 89 ms） | 無法辨識，2,000 ms 後 `recovery-required` 5／5（安全但 blocked） |
| F2 pid 存活且 start token 吻合／舊格式 v1 存活 pid（各 5 次） | `recovery-required` 5／5（約 2,090 ms）／同 | 同左 |
| F2 pid 已死（5 次） | 回收並 applied 5／5 | 同左 |
| F3 存活持鎖者持有 3,500 ms（> lockWaitMs 2,000；10 次） | 競爭者 `recovery-required`（2,085–2,096 ms）、不寫入；持鎖者 applied；0 遺失 | 同左 |
| F4 兩 process 不同 TMPDIR、共用工作樹（各 10 次 × 同／異 region） | 共用 repo 鎖，未同時進入；同 region→`steward-final-patch-required`，異 region→兩者 applied；0 遺失 | **兩者皆進入各自的鎖，遺失 1 個效果 10／10（兩種 region 皆然）**；同 TMPDIR 時 0 |
| F5 重試用盡（`beforePrecheck` 接縫每次在合成後寫入競爭變更；各 5 次） | 一直干擾→`re-compose attempts exhausted after 5 of 5`、不寫入（apply 137–143 ms，含約 40 ms 退避）；干擾 2／4 次→第 3／5 次 applied；maxRecompose 0→`after 1 of 1`；0 遺失 | 不可測（不轉送 hook） |
| F6 不同 PID namespace（`unshare -Urpf --mount-proc`；同工作樹、同 tmp；各 10 次）：持鎖者在 host、競爭者在 namespace | **回收存活者的鎖，遺失 1 個效果 10／10** | **遺失 10／10** |
| F6 持鎖者在 namespace、競爭者在 host | **回收存活者的鎖，遺失 1 個效果 10／10** | `recovery-required` 10／10，0 遺失 |

(6) 成本：多 process 重播 opt 相對 fix，wall mean +2.3%（583.9→597.1 ms）、p95 +16.2 ms；每 intent total_ms mean +2.6%（93.6→96.0 ms）、p95 211.6→221.7 ms。harness 鎖再疊加：optlock wall mean 712.0 ms、p8 950.3 ms。單 process 回歸（E2 子集：3 workloads × 5 arms × 3 seeds × 2 reps；bea35380→2118bc66）：15 組正確性計數**完全相同**；steward 臂每 intent total_ms mean 79.1→81.0 ms（+2.4%；hot_conflict +0.6%、hot_disjoint +4.1%、cold +3.4%），同 pin rep 間雜訊最大約 5 ms，hot_disjoint／cold 的差（+3.2／+2.0 ms）與雜訊同量級；apply_ms mean hot_disjoint +2.04 ms（+4.8%）、cold +0.78 ms、hot_conflict −0.2 ms；bare composer 合計 +0.5%；未改動路徑的 file lock／OCC／Git 三方 |Δmean| ≤ 1.8%。執行順序固定 fix 先、opt 後，順序偏差未排除。

(7) **明確未做**：Phase 3 450-run 主矩陣（**未執行**）；真實容器（只以 `unshare` 測 PID namespace；未測獨立 mount namespace、overlay／網路檔案系統、跨主機）；斷電耐久性（仍無 fsync）；非 ATM 外部寫入者；多檔提交中途被殺；broker 序列化 apply 佇列（未實作）；CID 錨定的 re-compose（未實作）；孤兒 temp 檔清理；獨立重現。

可主張：在 r3 的 E4 重播設定（同 seeds）、三種確定性 barrier 模式與故障情境 F1–F5 下，2118bc66 未觀察到遺失效果或損壞檔；同時段完成數高於 bea35380 與 5692474f，剩餘 blocked 全為 fail-closed 的 `steward-final-patch-required`；不同 TMPDIR 共用鎖、存活持鎖逾時→`recovery-required`、重試用盡→`blocked` 已有可重跑的確定性測試。不可主張：完成率提升已被統計證明或可外推到其他工作負載（harness 提案恰好帶 `L<line>:<region>`，(a) 對無區域身分的提案不生效）；全部成功；多 process 零遺失已被證明；(c) 的多次重試與退避帶來可量測收益；(d) 支援跨容器或跨 PID namespace（F6 反例）；broker 序列化 apply 佇列存在；任何勝出。依 §5.7，r2 撤回的 MP 正確性結論**不**自動恢復；F6 另構成跨 PID namespace 部署下的新反例。

### E.4　原 §4.11（r4 版本，未改）

**原 4.11** Steward 完成率最佳化（ATM PR #214，merge `2118bc66`；r4 驗證；DRAFT，不主張勝出）

**動機**：r3（§6 表 R3b）顯示 PR #213 後在 E4 設定下未再觀察到遺失效果，但完成率只有約 58%，blocked intents 1,086／2,610；其中 `file-hash-drift` 779、未上鎖早期 stale 檢查 70，re-compose 18 次只成功 3 次。作者要求下列四項全部納入論文 2.0，並以 r4 分開報告最佳化前後的完成與遺失（兩者不合併成單一指標，也不以完成率提升抵銷任何遺失）。

**實作與狀態**（依 PR #214 與程式碼閱讀；完整 diff `runs/r4-validation/ATM_CORE_DIFF_bea35380..2118bc66.patch`）：

| 項目 | 實際設計 | 狀態 | r4 能否單獨關閉 |
|---|---|---|---|
| (a) 區域重定 re-compose | 行號合成失敗（`compose-context-mismatch`）時，若每份提案帶區域身分（line anchor hint `L<line>:<region>`、symbol content anchor，或 patch 內唯一的 `</region:…>` 結尾標籤），就在目前檔案的該區域內以提案的舊列序列重新定位並套用。找不到區域→`compose-context-mismatch`；同批兩份提案同區域、或錨定列已被改→`steward-final-patch-required`（不寫入）。計畫階段的 `file-hash-drift` 對有區域身分的提案不再直接擋下，交給區域重定；**沒有**區域身分的提案仍以 `file-hash-drift` fail-closed。註：錨點是 region 標記＋列內容，**不是** CID；原規劃「CID／region」只實作了 region 部分 | 已實作 | 否：無設定開關；關閉需改 ATM 程式碼或改 harness 提案格式（後者會改變工作負載） |
| (b) 未上鎖早期 stale 檢查改走 re-compose | 早期 stale 不再直接 `blocked`，改回 transactional `re-compose`，進入與鎖內 base 不符相同的重試迴圈 | 已實作 | 否：無開關；`maxRecomposeAttempts=0` 會讓它直接結束，但同時關掉 (c)，無法分離 |
| (c) 有上限的重試＋退避 | `stewardCanonicalCommitPolicy`：`maxRecomposeAttempts` 4（共 5 次）、`recomposeBackoffMs` 4（第 k 次重試前等 4k ms）、`recomposeJitterMs` 3；用盡時公開理由為 `re-compose attempts exhausted after N of M: …` | 已實作 | 可：`applyStewardPlan` 的公開輸入 `recomposePolicy`（非 CLI 旗標） |
| (d1) repo 範圍鎖位置 | 預設 `<repo>/.atm/runtime/steward-commit-locks/<sha256(realpath)>`；不同 TMPDIR 共用同一把鎖 | 已實作 | 否：`applyStewardPlan` 不轉送 `commitLockRoot`；以 pin 間對照代替（bea35380 為 `os.tmpdir()` 鎖） |
| (d2) 過期持鎖者處理 | owner 檔 v2（pid、`/proc/<pid>/stat` start token、nonce）；pid 已死，或 pid 存活但 start token 不符，即回收；存活且吻合者超過 `lockWaitMs`（2,000 ms）→`recovery-required:` | 已實作；**跨 PID namespace 有反例**（見下） | 否 |
| (d3) broker 序列化 apply 佇列 | — | **未實作（延後）**。PR 作者明言 broker 佇列仍只處理邏輯衝突；steward apply 不經 broker 序列化。本文不得暗示其存在 | — |

**測試**：(1) ATM 自帶（PR #214 自述，本文未重跑）：同 region barrier、上下分離、hash drift 與早期 stale 皆重合成、torn write、持鎖者被殺、pid 重用、存活持鎖逾時、不同 TMPDIR 共鎖、重試用盡；本機 `npm test` 13／13。(2) 本文 harness（r4，作者自行執行，未獨立重現）：E4 重播 6 臂 × 75 runs（含消融）、r1 E4 cells、三種確定性 barrier 模式（seam／stale-proposal／before-precheck）、故障情境 F1–F6、單 process 回歸；結果見 §6 表 R4。

**r4 結果摘要**（詳見表 R4；完成與遺失分開列）：

- E4 重播主臂（2118bc66、harness 鎖 off）：完成 1,748／2,610（67.0%），失敗 runs 0／75，遺失效果 0，blocked 862，損壞檔 0。同時段 bea35380：1,553／2,610（59.5%）、0／75、0、1,057；5692474f：1,580／2,610（60.5%）、5／75 runs 失敗、合計遺失 6 個效果、1,024。
- 完成數在此次觀察中較高（逐 run 配對 75 對：55 對較高、6 對相同、14 對較低；描述性，不是顯著性檢定），但仍約 33% 的 intents 以 `blocked` 結束，剩餘 blocked 全部是 `steward-final-patch-required`（同區域重疊或錨定列已改，fail-closed）。不可寫成全部成功，也未做顯著性或非劣性檢定。
- 各項貢獻：`file-hash-drift` 785→0、未上鎖 stale 68→0（(a)(b) 生效）；re-compose 事件 91 次中 24 次成功（bea35380 16 次中 2 次）。(c) 的第 3–5 次嘗試與退避在 E4 中**從未觸發**（每 batch 最多 2 次嘗試）：maxRecompose 0／1（無退避）／4（預設）分別完成 1,718／1,752／1,748。
- 故障情境：(d1) 不同 TMPDIR 共用鎖：2118bc66 0 遺失（bea35380 每次遺失 1 個效果，10／10）。**(d2) 反例**：持鎖者與競爭者位於不同 PID namespace（`unshare -Urpf --mount-proc`，同一工作樹與同一 tmp，模擬跨容器共用工作樹）時，2118bc66 兩個方向都把**存活**的持鎖者判為過期並回收，各 10／10 次遺失 1 個已 ack 效果；bea35380 在「持鎖者在 namespace 內」方向則以 `recovery-required` 安全擋下（0 遺失），新加的 start-token 檢查使這個方向變差。原因：存活判斷用的是呼叫者所在 namespace 的 `kill(pid, 0)` 與 `/proc/<pid>/stat`，另一 namespace 的 pid 在此不存在（ESRCH）或對到無關程序（start token 不同）。依 §5.7 這是反例：**不得**主張 (d) 支援跨容器或跨 PID namespace。
- 另：持鎖者在「temp 已寫、rename 前」被 SIGKILL 時，目標目錄留下孤兒 `.<name>.<pid>.<rand>.atm-tmp`（兩個 pin 皆 10／10），下一個持有者不清理；canonical 檔未受損、無遺失。

**驗收原則**（先於資料固定，維持）：任何一項最佳化在 r4 出現遺失效果或損壞檔，依 §5.7 記為反例，不以完成率提升抵銷。E4 重播與 barrier 中 0；故障情境 F6 不為 0（上述反例）。


## 附錄 F：r5 驗證過程紀錄（版本、harness、偏離、鑑識；正文只引用結果）

**F.1 受測版本與 CI**

| 對象 | 內容 |
|---|---|
| 新 pin | ATM main `37847584e24afc08ea58cfe380bb5b1220fbe335`（PR #216 merge；parents `44a9ee19`、`5e39ee12`；created 2026-10-08 17:14、merged 17:30 CST by cursor[bot]；未 tag、未 publish）。GitHub commit tarball 142,081,077 bytes，sha256 `e17a90ddceaf3c70d580c96e31f14cf8251d5a664985c1eb494f0d8db8045e3d`，內嵌 commit 相符；`packages/core/src` tree sha256 `05d048db…`（437 檔） |
| 對照 pin | `5692474f`、`bea35380`、`2118bc66`（同 r4 安裝；core tree hash 與 r3／r4 紀錄一致）。四個 pin 在 r5 前後 core tree 與 broker 關鍵檔 hash 不變；pin 樹內未產生 runtime 鎖或佇列目錄 |
| core 差異（2118bc66→37847584） | `steward.ts`、`steward-commit-guard.ts`（改）；`steward-kernel-lock.ts`、`steward-apply-queue.ts`（新）；完整 diff `runs/r5-validation/ATM_CORE_DIFF_2118bc66..37847584.patch`，測試與 script 差異 `ATM_TESTS_DIFF_2118bc66..37847584.patch` |
| CI（另列，非本文實驗） | feature head `5e39ee12`：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate green（17:14–17:28 CST）；merge `37847584`：四項 green（17:30–17:45 CST）。CI 中跨 namespace 測試結束碼 0，但記錄無法證明 `unshare` 情境真的互鎖 |
| PR 自述數字（非本文量測） | 14-run 格子 488 intents：2118bc66 326、queue on 319、queue off 327，lost 皆 0；本文不引用為結果 |

**F.2 harness 變更（r4→r5；`harness/R5_CHANGES.patch`）**：(1) 37847584 的鎖目錄以遞迴 mkdir 建立，r4 的 mkdir 計數器恆為 0，改以 owner 檔寫入次數計鎖取得（`atm_commit_owner_writes`；barrier 分類用兩者最大值）；(2) 每個 batch 記錄實際生效的 `ATM_STEWARD_*` 環境變數（`atm_env`），分析時逐 run 檢查與臂設定一致（`env_mismatch` 為空）；(3) 新故障腳本 `test/r5_fault_scenarios.mjs`：每個子程序記錄 `/proc/self/ns/pid`、namespace 內 pid、owner 寫入時間、刪除非自己建立之 temp 的時點與當時已寫 owner 次數；新增 F2b（真持有者停在 rename 前＋偽造 owner）、O2（活著寫入者的 temp；清理入口呼叫 ATM `cleanupOrphanCanonicalTemps`）、F7（佇列逾時退回）；(4) `analysis/r5_compare.py`（Wilson、逐 run 配對、例外分類）。

**F.3 執行與時間**：主批次 17:40:09–18:12:05 CST（barrier 20 reps×22 案例＋探索性 5×2、E4 重播 525、完整 cells 87、單 process 回歸 198、E5 10 次注入＋30 cells、故障情境 380＋50 次），`rc` 全為 0；事後加跑 225 runs 18:24:59–18:29:30 CST。正式分析 `runs/r5-analysis/r5-2026-10-08/`（raw 唯讀檢查通過；r5 cells 0 個 verdict 改變、0 unscored、pin／env 不符皆為空）。

**F.4 偏離與事件**（全文見 `runs/r5-validation/DEVIATIONS.md`）：代理工作階段於主批次結束後中斷，未產生不完整批次；分析腳本 v1 的 env 檢查誤判 git_three_way cells（v2 修正、v1 輸出移至 `superseded-r5-2026-10-08-v1/` 不引用）；re-compose 消融臂因 queue on 時 re-compose 不觸發而無區分力，事後加跑 queue off 三臂（標 †）；seam／before-precheck barrier 在 37847584 以 queue off 執行（queue on 只做探索性 5 reps）。

**F.5 跨 PID namespace 的「確實執行」證據**：每次 F6 與 O2 跨 namespace variant 皆由 `unshare -Urpf --mount-proc`（util-linux 2.41.5）啟動一方；子程序讀 `/proc/self/ns/pid` 與 host（`pid:[4026532320]`）不同、namespace 內 pid＝1；`ns_split_confirmed` 在 37847584 qon／qoff 與 2118bc66 對照共 60／60 次 F6、40／40 次 O2 跨 namespace variant 為真，沒有 skip 路徑。2118bc66 的 20 次 F6 中兩方在同一時間都位於鎖內（`both_inside_lock`）20／20；37847584 為 0／40。

**F.6 孤兒 temp 清理時機的證據**：F1（rename 前 SIGKILL）中，37847584 下一個寫入者刪除孤兒 temp 的時點都在它寫入 owner 檔（即取得核心鎖）之後（20／20，`owner_writes_so_far`≥1），最終殘留 0；2118bc66 不刪（殘留 10／10）。O2 中寫入者停在 rename 前 4.5 s，清理入口 30／30 次回報 `skippedLiveHolder` 且 temp 仍在，第二寫入者等鎖逾時後 `recovery-required`、temp 仍在（30／30）。

**F.7 鑑識：apply 佇列的 SQLITE_BUSY 例外**：queue on 臂 8 個 intents（E4 重播 q 3、qr0 2、qr1 2；完整 cells q 1）以 `ERR_SQLITE_ERROR: database is locked` 結束。`steward-apply-queue.ts` 的 `joinOne()` 在 presence DB 已持有 `BEGIN IMMEDIATE` 後、於 try 區塊外開啟 `queue.sqlite`；第一個語句 `PRAGMA synchronous = OFF`（第 252 行）在其他 process 提交時可得 SQLITE_BUSY；`isQueueUnavailable()` 只接受檔案系統錯誤碼，故例外傳出 `applyStewardPlan`，未退回檔案鎖路徑，且 presence 檔洩漏（每個受影響 run 留 1 個）。獨立重現（8 processes×300 次）2,400 次中 4 次拋出、留下 4 個 presence 檔（`runs/r5-validation/forensics/sqlite-busy/`）。未寫入、無遺失或損壞，依 §5.7 不是反例；列為可用性缺陷。

**F.8 從正文移出的 r3／r4 段落**

**原 §1.5（r3、r4 項）**（r4 版本，未改）：

- **跨 process steward 修正驗證（r3，作者自行執行 483 runs，未獨立重現）**：PR #213（`bea35380`）後，E4 重播 75 runs 失敗 0／75、遺失效果 0（修正前 5692474f：失敗 8／75、合計遺失 12 個效果）；完成 1,524／2,610 對修正前 1,519／2,610，兩者約 58%，不可解讀為全部成功或已證明不劣；故障情境與 Phase 3 未做（§6 表 R3b）。完成率最佳化見 §4.11 與表 R4（r4）。
- **steward 完成率最佳化驗證（r4，作者自行執行 693 runs＋barrier／故障情境，未獨立重現）**：PR #214（`2118bc66`）在 r3 同配置 E4 重播中失敗 0／75、遺失效果 0、損壞 0；完成 1,748／2,610（67.0%），同時段 bea35380 1,553／2,610（59.5%）、5692474f 1,580／2,610（60.5%；失敗 5／75、合計遺失 6 個效果）。完成數在此次觀察中較高，但仍約 33% 以 `blocked` 結束：不可寫成全部成功，亦未做顯著性或非劣性檢定。**反例**：持鎖者與競爭者位於不同 PID namespace（同一工作樹，模擬跨容器）時，2118bc66 會回收存活持鎖者的鎖並遺失已 ack 效果（兩個方向各 10／10）；依 §5.7 不得主張 (d) 支援跨容器。broker 序列化 apply 佇列未實作。Phase 3 450-run 未做（§4.11、§6 表 R4）。

**原 表 V1（r3、r4 列）**（r4 版本，未改）：

| steward 跨 process 修正（r3） | PR #213 merge `bea35380d7f381f998c9930fa95f01b999c7f208`（feature `4d7c9ed6287173f6f704e8d0a0d8a99683776bff`；base main `53e6fdb0`；merged 2026-10-08 10:38 Asia/Taipei）；未 tag、未 publish | r3 驗證 pin（§6 表 R3b）。harness 載入的 `packages/core` 相對 5692474f 只差 3 檔（`steward.ts`、`steward-transactional-apply.ts`、新增 `steward-commit-guard.ts`）；其餘差異在 cli／tests／docs，harness 不載入。仍**不是** final frozen artifact |
| steward 完成率最佳化（r4） | PR #214 merge `2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`（feature `b5729456bc14d9bf4c8acfce7be320fec691fee2`；base main `8b3622b7`；merged 2026-10-08 14:27 Asia/Taipei）；未 tag、未 publish | r4 驗證 pin（§4.11、§6 表 R4）。harness 載入的 `packages/core` 相對 bea35380 改 5 檔（`steward.ts`、`steward-transactional-apply.ts`、`steward-commit-guard.ts`、`steward-base-composer.ts`、`steward-input-validation.ts`）並新增 `steward-region-rebase.ts`；其餘差異（`research/`、docs、CHANGELOG、scripts、tests）harness 不載入。仍**不是** final frozen artifact |

**原 §7.1（r3、r4 強度上限）**（r4 版本，未改）：

- **r3 驗證的強度上限**（§6 表 R3b）：483 runs 全為作者自行執行、未獨立重現；PR #213 後 E4 重播失敗 0／75、遺失效果 0（修正前 8／75、合計遺失 12 個效果）只是觀察；完成 1,524／2,610 與修正前 1,519／2,610 皆約 58%，不是全部成功，也未做非劣性檢定。CI（框架測試）不重跑本文實驗。Phase 3 450-run 主矩陣與故障情境（lock timeout、持鎖者被 kill、跨容器、`recovery-required`）**未做**。
- **r4 驗證的強度上限**（§4.11、§6 表 R4）：693 runs 與 barrier／故障情境全為作者自行執行、未獨立重現。2118bc66 在 E4 重播失敗 0／75、遺失效果 0，完成 1,748／2,610（67.0%）對同時段 bea35380 1,553／2,610：只是一次觀察，未做顯著性或非劣性檢定，且 harness 提案格式恰好帶區域身分，(a) 的效果不能外推到無區域身分的提案。故障情境 F6（不同 PID namespace）出現遺失（兩個方向各 10／10）：跨容器部署下 (d) 的過期持鎖者回收**不安全**。broker 序列化 apply 佇列未實作。Phase 3 450-run 主矩陣仍**未做**。

**原 §7.3 第 0 項**（r4 版本，未改）：

0. **（paper 2.0 必含，非延後項）** §4.11 steward 完成率最佳化：r4 驗證已完成（2026-10-08，表 R4；DRAFT）。仍待：跨 PID namespace／跨容器的持鎖者存活判斷（F6 反例；例如不以 pid 存活推斷過期、改用 lease 續約或 broker 序列化 apply）、broker 序列化 apply 佇列（(d3) 未實作）、孤兒 temp 檔清理、CID 錨定 re-compose、獨立重現；之後才是 Phase 3 450-run 主矩陣。

---

## 參考文獻

[1] Eagl Huang. *ATM: CID-Brokered Pre-Write Admission for Multi-Agent Code Co-Synthesis — A Specification-Grounded Governance Substrate for Software Agents*. arXiv:2607.00041v1 [cs.SE], 2026-06-29.（本稿引用：摘要、§1.1、§1.3、§1.4、§2、§3.2、§3.4 Algorithm 1 safety note、Table 4、§3.5、§3.7、§4.5、§6.1；全文 `refs/arxiv-2607.00041.txt`；逐頁頁碼〔待補全文對照〕）
[2] AI-Atomic-Framework v1 framework annotated tag `v0.9.0-alpha.1`：tag object `0b31aa8683b44b3a78206132a0bf90a0fde73d1c`；peeled commit `a897f144c84b66bb39f4f783c67e48ef75b7db78`〔審閱核對 2026-10-07〕。
[3] AI-Atomic-Framework 歷史基準 tag `v0.1.17`，commit `8dd6a1c6d169bf0421a55d3954a0a299b0bd582b`；issue #196。https://github.com/eaglhuang/AI-Atomic-Framework
[4] AI-Atomic-Framework main 快照 commit `3b0f7660b6673ba6c7570ee31fa776c0fac89bb5`（狀態截至 2026-10-07 11:49 UTC）〔審閱核對〕。
[5] AI-Atomic-Framework PR #198，head `65e8aab36f79c335d542151133e931f7dd71e7c0`：候選同基底 composer 與輸入檢查〔審閱核對〕；r2 更新：2026-10-07 合併為 `5692474f7db70ab52a7a71c8af4867609e7e4b43`（本文實驗 pin，唯讀）。
[6] AI-Atomic-Framework PR #197：FileHeat（已合併；預設 static，hybrid／learned opt-in）〔審閱核對〕。
[7] AI-Atomic-Framework PR #199：native hot parking（已合併；ticket 與 resume 流程）〔審閱核對〕。
[8] Git 官方文件：`git merge-file`（共同 base 三方合併、衝突與 exit status）。
[9] H. T. Kung, J. T. Robinson. On Optimistic Methods for Concurrency Control. *ACM TODS* 6(2):213–226, 1981.
[10] NIST/SEMATECH. Exact binomial confidence bounds.（零事件上界方法）
[11] T. Kalibera, R. Jones. Rigorous Benchmarking in Reasonable Time. 2013.
[12] NIST/SEMATECH. Percentiles.（分位數定義）
[13] Maxim Nikolaev. Claim Plane: Enforceable Change Intents and Dynamic Scope for Parallel Coding Agents. arXiv:2607.21909v1, 2026.〔書目依審閱轉述，待核對原文〕
[14] Maxim Nikolaev. Reliability Gains and the Limits of Selective Concurrency for Parallel Coding Agents. arXiv:2608.00947v1, 2026（Claim Plane confirmatory follow-up）.〔書目依審閱轉述，待核對原文〕
[15] C. A. Ellis, S. J. Gibbs. Concurrency Control in Groupware Systems. *SIGMOD* 1989, 399–407.
[16] M. Shapiro, N. Preguiça, C. Baquero, M. Zawirski. Conflict-free Replicated Data Types. *SSS* 2011.
[17] GNU Diffutils manual: Unified Format（old hunk count 含 context 與刪除行）。
[18] SQLite: Atomic Commit in SQLite（方法參考，非 ATM 保證）。
[19] ATM v1 所引相鄰工作（CodeCRDT arXiv:2510.18893、EvoGit、AgentGit、CodeTeam、SEMAP、MPAC、CoAgent、S-Bus、ATCC、Atomix、Cordon、AgenticFlict 等）：完整書目沿用 v1 參考文獻表〔待補全文對照〕。
[20] AI-Atomic-Framework PR #213「fix(steward): close concurrent lost updates on canonical commit」：merge `bea35380d7f381f998c9930fa95f01b999c7f208`、feature `4d7c9ed6287173f6f704e8d0a0d8a99683776bff`，2026-10-08 合併（r3 驗證 pin，唯讀；未 tag／publish）。
[21] AI-Atomic-Framework PR #214「fix(steward): rebase disjoint region edits after hash drift」：merge `2118bc66efb3ac3bc0ddaede6a2f7cb18526b030`、feature `b5729456bc14d9bf4c8acfce7be320fec691fee2`，2026-10-08 14:27 Asia/Taipei 合併（r4 驗證 pin，唯讀；未 tag、未 publish）。https://github.com/eaglhuang/AI-Atomic-Framework/pull/214
[22] AI-Atomic-Framework PR #216「fix(steward): keep live cross-namespace lock holders and queue applies」：merge `37847584e24afc08ea58cfe380bb5b1220fbe335`（parents `44a9ee19`、`5e39ee12`）、feature `5e39ee1244ed47b3fd3f44f9553fcd690f003894`；created 2026-10-08 17:14、merged 17:30 CST by cursor[bot]；未 tag、未 publish。https://github.com/eaglhuang/AI-Atomic-Framework/pull/216

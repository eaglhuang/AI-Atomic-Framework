---
title_zh: "准入之後的真正合併：ATM 以 Composer 與中立 Steward 對同檔多代理 patch 進行確定性共寫合成"
title_en_tentative: "Beyond Admission: Deterministic Co-Write Synthesis of Same-File Multi-Agent Patches via Composer and Neutral Steward in ATM"
subtitle: "在 CID broker 准入之後，由中立 steward 對同檔多代理真實 patch 做『同一 base』的確定性合成並交易式寫入，以消除遺失更新"
positioning: "ATM v1（arXiv:2607.00041）的續篇；systems-implementation 論文；主貢獻＝Composer＋中立 steward 共寫合成；冷熱分級准入與冷檔排隊為支撐機制與對照證據"
version_date: 2026-10-07
atm_tag: "v0.1.17（commit 8dd6a1c6；packages/*/package.json 仍顯示 0.1.2，以 tag 為準）；主 claim 需待 M1 修正後之 frozen tag（暫稱 vX，是否打 tag／publish 由使用者決定）"
harness: "atm-bench 0.3.0-latency（steward 臂待 M2 接線）"
status: "草稿／非正式投稿（DRAFT — NOT FOR SUBMISSION）；主功能未完成，主結果〔待 M2/M3 實測〕"
primary_axis: "Composer+steward（真正平行合併）"
issue: "#196（https://github.com/eaglhuang/AI-Atomic-Framework/issues/196）"
supersedes: "舊稿『熱檔提案、冷檔排隊』已備份為 ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md"
sources: "COMPOSER_STEWARD_PAPER_PIVOT.md、COMPOSER_STEWARD_IMPL_PLAN.md（§0、§1.2、§2、§2.6、§3、§4、§5、§6、§7、§9）、runs/composer-probe/probe.out、PAPER_V2_DRAFT_PACK.md、PAPER_V2_KEY_TABLES.md（T1–T11）、HOT_FILE_LATENCY.md、refs/arxiv-2607.00041.txt（ATM v1 全文）"
---

# 准入之後的真正合併：ATM 以 Composer 與中立 Steward 對同檔多代理 patch 進行確定性共寫合成

**英文暫定標題**：Beyond Admission: Deterministic Co-Write Synthesis of Same-File Multi-Agent Patches via Composer and Neutral Steward in ATM

**一句定位**：ATM v1 證明了「寫入前准入」可以把同檔多代理的寫入意圖路由到正確的路徑；本文（v2）處理准入**之後**的那一半——當 broker 判定兩份 patch 可以組合時，由中立 steward 對**同一個 immutable base** 做確定性合成、一次交易式寫入，讓非衝突變更全部保留、衝突變更 fail-closed 且留下收據、提案代理不直接碰 canonical 檔。冷熱分級准入與冷檔排隊是這條路徑的**前提與對照**，不是本文主貢獻。

> ⚠ **草稿／非正式投稿**。版本日期 2026-10-07（Asia/Taipei）。現行 ATM tag v0.1.17。
> ⚠ **主功能尚未完成**（issue [#196](https://github.com/eaglhuang/AI-Atomic-Framework/issues/196)；`COMPOSER_STEWARD_IMPL_PLAN.md` 的 P0-1～P0-6）。本稿的主 claim 一律以「**目標主張／待實測**」框呈現，數字欄位標〔待 M2/M3 實測〕；**不得**在功能完成、M2/M3 實測前當作結果引用。
> 標記說明：🟢＝彙整包標為論文可用；🟡＝有 caveat（輔助／附錄／動機）；〔待 M2/M3 實測〕＝主結果尚無數據；〔待核對〕＝來自對話共識或尚未逐頁對照原文；「來源未提供」＝本 box 檔案中無此數字。所有數字抄自 `PAPER_V2_KEY_TABLES.md`、`HOT_FILE_LATENCY.md`、`COMPOSER_STEWARD_IMPL_PLAN.md` 與 `runs/composer-probe/probe.out`，未重算（標「推算」者為彙整包以來源數字相除所得）。

---

## 摘要

多個 LLM 代理在同一受治理工作樹中共寫程式時，最直接的失效是**遺失更新**（lost update）。ATM v1（arXiv:2607.00041）把這個問題定為「單一治理域內的寫入前准入」：CID broker 判定同檔但有界區域不相交的意圖走 `needs-physical-split`，交給確定性 composer，再由**中立 steward** 套用；v1 也明說，准入時的區域不相交「不保證兩份 patch 套用時不會造成行數位移」，這些位移「必須由 composer、中立 steward 與 CAS base-hash 重驗共同吸收」（v1 §3.5）。換言之，v1 把「准入之後怎麼真正合併」交給了 steward，但沒有量測它。

本文的出發點是一組負面證據。以 atm-bench 驅動真 ATM broker（v0.1.17）在熱檔高壓情境下，若 writer 只採用 ATM 的准入決策、但**沒有** composer／steward apply（stale writer），已提交更新的遺失率為 **約 55–65%**（逐情境 54.4%–65.2%），與無 ATM 的 control（63.9%–71.5%）同一量級（🟢 T6、`HOT_FILE_LATENCY.md` §2.2）。舊版 harness 報告的「0 lost」全部綁在一個理想化的同步 writer（等同完美 rebase）上，從未驅動真正的 `composeBrokerProposals`／steward apply。**准入不等於不丟更新**——合併本身才是缺口。

我們接著以唯讀探針檢查 v0.1.17 既有的 compose → merge plan → steward 交易式 apply 路徑，發現三類問題：（1）同檔、不重疊、但上方 patch 插入一行時，compose 判 `parallel-safe`，steward apply 卻拋出 `UnifiedPatchApplicationError`、兩個變更都沒寫入，且結果**依排序而異**（調換 anchor 順序即可成功）；（2）重疊衝突雖然沒有部分寫入，卻是靠例外中斷，而非可觀測的 `blocked` 收據；（3）提案代理可以自己擔任 steward 完成 apply。根因是文字合成實作為「循序 reduce 套 patch」而非「對同一 immutable base 合成」，且 `permutationStable: true` 為寫死值。

本文提出並（待完成後）評估 **Composer＋中立 Steward 的確定性共寫合成**：所有 hunk 對同一個 base 解析、以變更行＋context 的保守定義檢查不重疊、依檔內位置合成並實際驗證排列穩定性；合成失敗、`needs-steward` 無最終 patch、或 steward 身分屬於提案者時，一律回結構化 `blocked` 收據且不做部分寫入；寫入沿用 v0.1.17 已有、品質良好的交易式 apply（base-hash 重驗、temp 寫入、失敗 rollback）。目標主張是：在熱檔高壓情境下，非重疊變更 lost update 為 0（oracle 驗證）、重疊衝突 100% fail-closed 且有收據、提案代理對 canonical 檔直接寫入 0 次〔皆待 M2/M3 實測〕。冷熱分級准入（熱檔 wall 1.01–1.02×、約 5 ms/intent）、冷檔原生排隊（#180，partial）與跨 process CAS 協定作為准入成本、正確性前提與對照臂，以既有實測數字支撐。

**關鍵詞**：多代理程式生成、遺失更新、確定性合成、中立 steward、交易式寫入、寫入前准入、可重現基準

---

## 1. 引言

### 1.1 問題：同一個檔，多份真實 patch

當多個代理同時修改同一個檔案，「不衝突」有兩層意思。第一層是**准入層**：兩份意圖在語意 atom、有界區域、共享面與讀寫依賴上不重疊，可以被允許同時進行。第二層是**套用層**：兩份實際產生的 patch，在真的寫進檔案時，彼此的變更都被保留、沒有一方覆蓋另一方、結果與先後順序無關。

ATM v1 把第一層做成了一條可重播的准入詞彙：broker 依 CID、共享面、讀寫集合、檔案範圍／virtual atom 等閘門產出 `parallel-safe`、`needs-physical-split`、`SERIAL`、`blocked-*` 等裁決（v1 §3.4、Table 4）。對同檔有界不相交的情況，v1 的 Algorithm 1 safety note 寫得很明確：這種情況「不被當作直接的 parallel-safe 寫入」，而是路由到 `needs-physical-split`，「由確定性 composer 與中立 steward 產生單一受治理的套用路徑」（v1 §3.4）。v1 的架構也把「誰提出變更」與「誰執行寫入」分開：「即使 broker 判定兩份 proposal 可以組合，仍由中立 steward 執行受治理的寫入」（v1 §3.2）。

第二層——套用層——在 v1 中是被**承諾**的。v1 §3.5 明確劃出了「准入時的區域判斷」與「套用時的行數位移」的界線：先套用的 patch 插入新行、後套用的 patch 修改既有區塊，兩者在准入時仍可滿足足跡不相交，但「套用時產生的行數偏移必須由確定性 composer、中立 steward 與 CAS base-hash 重驗共同吸收，而不是讓各代理直接寫入」；並將現場案例 POS2 定位為「由准入、組合、steward 套用與 CAS 重驗構成的受控同檔寫入鏈」，而非單純的行號不相交合併（v1 §3.5）。

### 1.2 動機：准入 ≠ 不丟更新

本文的第一個發現是：**只有准入，不夠**。我們在 atm-bench 中以真 ATM broker 決策驅動熱檔高壓情境（`overlap=high`、hot_ratio 1.0、8 agents、每 rep 354 intents），比較兩種 writer：

- **sync writer**：admission 之後，在 apply 當下同步 read-modify-write——等同一個完美的 rebase／composer；
- **stale writer**：admission 之後先讀 base，hold 結束後把 base＋自己的 edit 整檔寫回——也就是「接受 ATM 的准入決策，但沒有 composer／steward apply」。

同一組准入決策下，sync writer 為 0 lost，stale writer 則丟掉約 55–65% 的已提交更新，與 control 幾乎相同（§2.3、表 S1）。也就是說，舊版 harness 與舊版 v2 草稿所有的「0 lost」，量到的其實是「理想 rebase 的正確性」，而不是 ATM 套用路徑的正確性。這同時說明了另一件事：在熱檔情境下，ATM 會把大量同檔、甚至**同區**的 writer 路由到 composer（h1-a8 每 rep 同區重疊 pairs 約 156 對，全部是 composer_merge＋composer_merge；`HOT_FILE_LATENCY.md` §1.1）——正確性的重擔實際上全壓在 composer＋steward 上。

### 1.3 現況缺口：v0.1.17 的 steward apply 還不能「真正平行合併」

ATM v0.1.17 其實已有完整的 API 鏈：`composeBrokerProposals` → merge plan → `planStewardApply`／`applyStewardPlan` → `applyTransactionalStewardPlan(writerRole:'neutral-steward')`（§5.1）。但唯讀探針（§6、表 P1）顯示，這條鏈目前**無法**兌現 v1 §3.5 的承諾：上方插行即會讓不重疊的 patch 失敗、結果依排序而異；重疊衝突以例外中斷而非可觀測收據結束；提案者可以自我 apply。這些缺口已整理為 issue #196 與 P0-1～P0-6。

### 1.4 本文的回答與誠實邊界

本文提出 **Composer＋中立 Steward 的確定性共寫合成**（§5）：以同一 immutable base 合成取代循序套用，以結構化 `blocked` 收據取代例外，以身分閘門強制「提案者 ≠ steward」，並沿用 v0.1.17 既有的交易式寫入。我們把它放進三臂（control／stale／steward）加理想參考（sync）的實驗設計中，以 oracle 驗證 lost update、以事件欄位驗證 fail-closed 與提案者直接寫入次數（§7）。

**本稿撰寫時，P0 修正與 steward 臂均尚未完成**。因此主結果全部標為〔待 M2/M3 實測〕；本稿目前能以數據支撐的只有：（a）動機——stale vs sync 對照；（b）缺口——探針表；（c）支撐——冷熱分級准入、冷檔排隊、每筆成本與跨 process CAS 的既有實測。

---

## 2. 貢獻

### 2.1 貢獻清單（依主次重排）

| ID | 貢獻 | 狀態／證據等級 | 主要證據 |
|---|---|---|---|
| **C-main** | **Composer＋中立 Steward 確定性共寫合成**：同檔多代理真實 unified-diff patch，在 broker 路由到 compose 之後，由中立 steward 對同一 base 做確定性合成（排列穩定）、一次交易式寫入；非衝突全保留、衝突 fail-closed 有收據、提案者不可自我 apply | **目標主張；實作 pending（#196 P0-1～P0-4）；證據〔待 M2/M3 實測〕** | 驗收 S1a／S1b／S2／S3／S4（§5.6）；bench 斷言 S6（§7） |
| **C-motivation** | **「准入 ≠ 不丟更新」的定量證據**：同一組 ATM 准入決策下，sync writer 0 lost、stale writer 約 55–65% lost，≈ control；並以唯讀探針揭露 v0.1.17 steward apply 的順序依賴、例外中斷與自我 apply | 🟢（stale vs sync）＋探針（質性、可重跑） | T6、`HOT_FILE_LATENCY.md` §2.2；`runs/composer-probe/probe.out` |
| **C-support-1** | **冷熱分級准入**（決定「誰要走 compose」）：熱檔 proposal-first（provisional-write-lease／composer-routed／true-conflict），每筆成本小 | 🟢（帶 caveat） | T6、T7 |
| **C-support-2** | **冷檔原生 serial queue**（#180，處理「同 atom 一定要排隊」，與合成互補） | 🟢 partial pass | T1–T3 |
| **C-support-3** | **每筆准入成本與跨 process 必要協定**：~5 ms/intent；registry CAS＋apply 互斥（負面對照） | 🟢 | T7、T8、T9 |
| **C-support-4** | **atm-bench**：seeded 情境、ground-truth oracle、事件 JSONL、control／native／stale／mp 多臂；本文將新增 steward 臂 | 🟢（工具）；steward 臂〔待 M2〕 | SMOKE_RESULT、README |

Derived Atoms（CID v2、occupy-both 等；T11）與合成的 atom 邊界有關，但本文只在 §9 以未來工作處理（P2-2）。#184 FileHeat／EMA 與熱檔 park 僅能寫 future work。

### 2.2 目標主張（草案；引自 IMPL_PLAN §1.2，數字待填）

> **目標主張／待實測**：「在 ATM vX（frozen tag，〔待 M1 後定〕）中，被 broker 路由到 compose 的同檔多 agent 真實 patch，由中立 steward 對同一個 base 做確定性合成，並一次性交易式寫入。在 atm-bench 熱檔高壓情境（如 h1-a8）下，**非重疊變更的 lost update 為〔待 M2/M3 實測；目標 0〕（oracle 驗證）**，**重疊衝突〔待 M2/M3 實測；目標 100%〕fail-closed 且有 blocked 收據**，**提案 agent 對 canonical 檔的直接寫入次數為〔待 M2/M3 實測；目標 0〕**。相較之下，同樣的准入決策但沒有 composer apply（stale writer）會丟 55–65%。」

- 唯一已有的數字是比較基準「stale writer 55–65% lost」（🟢 T6）；其餘全部〔待 M2/M3 實測〕。
- 此句將舊稿 C3 的 caveat「0 lost 綁 sync writer（理想 rebase）」替換為「0 lost 綁**真 steward apply**」。在 M2 數據出來前，本稿**不得**以肯定句陳述上述目標值。

---

## 3. 背景與相關工作

### 3.1 ATM v1：CID-brokered pre-write admission 與中立 steward

ATM v1（Huang，arXiv:2607.00041v1，2026-06-29，cs.SE）的貢獻是：帶 virtual-atom 後備的七層寫入前准入閘門（CID identity、shared surface、read/write set、file range／virtual atom、ConflictKey＋canMerge、CAS base-hash、fallback file lock）；規格到證據的治理基底；以及以 adapter 合約為界、不需先轉成通用 AST 的原子化抽象（v1 §1.3）。與本文直接相關的是三點：

1. **角色分離**：代理只能提出 proposal；即使兩份 proposal 可組合，仍由中立 steward 執行受治理寫入；一旦寫入進入 broker 治理路徑，中立 steward 是唯一正式套用權威（v1 §3.2）。
2. **同檔不相交 → 組合，不是直接寫**：同檔有界不相交編輯路由到 `needs-physical-split`，由確定性 composer 與中立 steward 產生單一套用路徑（v1 §3.4，Algorithm 1 safety note；Table 4）。
3. **套用時位移由 composer／steward／CAS 吸收**：v1 §3.5 明確區分准入時的區域判斷與套用時的行數位移，並以 POS2 現場案例作為「准入、組合、steward 套用、CAS 重驗」的同檔寫入鏈正向證據。

v1 的評估以確定性情境、現場案例（POS2／B-12／BLOCK）、外部採用者研究與 OperationalBench 為主，自述「不支持相對其他並行控制系統的廣泛優越性」（v1 摘要）。**v1 沒有對「多份真實 patch 經 steward 合成後是否保留全部非衝突變更、是否與順序無關」做系統性量測**——這正是本文的切入點。

### 3.2 v1 → v2 銜接

| 機制 | v1 怎麼寫 | v2 做什麼 |
|---|---|---|
| 組合與 steward apply | Algorithm 1 safety note、Table 4：`needs-physical-split` → deterministic composer → neutral steward apply；§3.5：位移由 composer＋steward＋CAS 吸收；POS2 為正向現場案例 | **主軸**：以探針揭露 v0.1.17 實作未吸收位移（順序依賴）；提出 immutable-base 合成＋排列穩定驗證；以 oracle 量測〔待 M2/M3〕 |
| 角色分離 | §3.2：steward 是唯一正式套用權威 | 揭露 apply 路徑無「steward ≠ 提案者」檢查（探針 #5）；加入 identity gate（P0-4） |
| fail-closed | §3.4：blocked 是對直接套用通道的 containment，不刪除提案者的工作；保留 intent／patch envelope／refinement evidence | 揭露合成失敗以例外中斷、無結構化收據（探針 #2/#4）；要求 `ok:false, verdict:'blocked'`＋blockedReasons＋proposalId（P0-2、P0-3） |
| SERIAL／排隊 | Table 4：queue or serialize the preserved intent | 支撐：v0.1.17 冷檔原生 `queue` 實測（#180 partial；§8.2） |
| 熱檔 | 僅順帶提及 | 支撐：proposal-first 熱檔准入成本與路由分佈（§8.1） |
| Park／re-arbitration | §3.5 列為已有實作＋驗證支持的一組 | v0.1.17 harness 路徑觀察不到 park（訊息寫 park 但直接 reject）〔待補全文對照，需作者確認〕；與 P1-4 交集，本文不處理 |

版本註記：v1 的框架 frozen anchor 為 `v0.9.0-alpha.1`（commit `0b31aa86…`；v1 §1.4），本文現況以 GitHub tag `v0.1.17`（commit `8dd6a1c6`）為準，其 `packages/*/package.json` 顯示 0.1.2；兩條版本號的對應關係**來源未提供**〔待核對〕。主 claim 須綁 M1 修正後的新 frozen tag。

### 3.3 Claim Plane 與其他相鄰工作

Claim Plane（arXiv:2607.21909）以宣告的資源／區域權限重疊為核心，佔位採 contingent → JIT promote；它處理的是「誰在什麼時候取得寫入權限」，與本文處理的「准入之後多份 patch 如何合成寫入」屬不同層次，兩者**互補**。本文不做 ChangeIntent／JIT 時序辯論，也不與 Claim Plane 同表硬比（IMPL_PLAN §7.2）。關於 Claim Plane 的樣本規模、效能報告與公開時序差的說法均來自對話共識，〔待核對 arXiv 原文〕，正式稿前不以肯定句出現。

相鄰工作沿用 v1 的「協調粒度 × 介入點」組織（v1 §1.1、§2）：字元級／版本控制基底（CodeCRDT、EvoGit、AgentGit）處理的是收斂而非准入；檔案／工作流治理（CodeTeam、SEMAP、MPAC）與代理並行控制（CoAgent、S-Bus、ATCC）；交易式工具效果（Atomix、Cordon）；事後 merge 衝突壓力（AgenticFlict）。本文的合成問題與三方合併（three-way merge）、OT／CRDT 的位置轉換在技術上相近：immutable-base 合成本質上是「多份對同一 base 的 diff，在不重疊前提下的確定性 offset 平移」。差異在於本文的合成**只在 broker 准入之後**發生、輸入已經過 CID／region 的語意過濾、且失敗時**拒絕**而非嘗試自動解衝突——這是刻意保守的設計選擇。上述相鄰工作的完整書目與細節〔待補全文對照〕。

---

## 4. 問題定義

### 4.1 設定

- 一個受治理工作樹、單一治理域（沿用 v1 §3.7 的單域定位）；目標檔 `f` 的 canonical 內容 `B`（base），其 hash 為 `H(B)`。
- `n` 個代理各自基於同一 `B`（同一 `baseCommit`、同一 `fileBeforeHash`）提出 `PatchProposal p_i`，內含 unified-diff patch、anchors、atomRefs、`actorId`。
- broker 已判定這些 proposal 的路由為 compose（例如熱檔 `composer-routed`，或 `needs-physical-split` → `deterministic-composer` lane）。

### 4.2 正確性目標

| 性質 | 定義 |
|---|---|
| **保留性**（no lost update） | 若 `p_1…p_n` 兩兩不重疊（§5.3 的保守定義），合成結果 `B'` 包含每一份 `p_i` 的全部變更，其餘行與 `B` 相同；以 oracle（committed intent 的 marker 必須出現在最終 worktree）驗證 |
| **排列穩定性** | 對輸入順序的任意排列 `π`，`H(compose_π(B, p_1…p_n))` 相同 |
| **fail-closed 可觀測性** | 若存在重疊或任何合成錯誤，steward 回 `ok:false, verdict:'blocked'`，附 `blockedReasons` 與衝突 proposalId；canonical 檔 hash 不變；不拋出未處理例外；不部分寫入 |
| **角色分離** | 寫入 canonical 檔的身分 `stewardId ∉ {actorId(p_i)}`，且 identity.kind = neutral；提案代理對 canonical 檔直接寫入次數 = 0 |
| **base 新鮮度** | 若 compose 之後 canonical 檔被改（`H` 變了），寫入被拒（stale／file-hash-drift），提案可 re-propose |

### 4.3 非目標

本文**不**做語意層衝突解決（LLM 或人工撰寫 steward-final-patch，P2-1）、**不**做 AST 全面化合成（P2-2）、**不**處理跨機 registry。重疊即拒絕，是本文的設計立場，不是暫時妥協。

---

## 5. 系統：Composer → Merge Plan → Steward Apply

### 5.1 既有路徑（ATM v0.1.17，程式碼層事實）

以下路徑引自 `COMPOSER_STEWARD_IMPL_PLAN.md` §2.1（行號以 v0.1.17 本機樹為準；`compose.ts` 與 `steward-transactional-apply.ts` 在 v0.1.17 與 HEAD `ed317820` 兩樹相同，GitHub `main` 的 `steward-transactional-apply.ts` 讀到的內容也相同）。

| 階段 | 元件 | 現況行為 |
|---|---|---|
| 准入 → compose | `evaluate-broker-admission.ts:48-49`；`decision.ts:228`、`decision/proposal-overlap.ts:96` | `deterministic-composer`／`neutral-steward` lane → disposition `compose`（`composer-routed`）。**准入只決定「要走 compose」**；沒有任何機制在准入之後自動收集 proposal、觸發 compose 與 steward apply |
| compose | `composeBrokerProposals`（`compose.ts:34`） | 排序 → CID 衝突回 `ok:false, blocked-cid-conflict`；baseCommit／fileBeforeHash 不一致、anchor 重疊、hunk 行範圍重疊回 `ok:true, needs-steward`；否則 `parallel-safe` |
| 排序 | `merge-plan.ts:26-55` | 依 `targetFile → firstAnchorKey（字串）→ proposalId`，**不是**檔內行號；`parsePatchHunkRanges` 只看 `@@ -a,b` |
| applyMethod | `merge-plan.ts:75-78` | `parallel-safe → patch-apply`；其他 → `steward-authored-final-patch`（但無任何程式真正產生此 patch） |
| plan | `planStewardApply`（`steward.ts:133`） | schema、blocked、human-required、scope lock、stale-base-commit／file-hash-drift；**`needs-steward` 可通過** |
| apply | `applyStewardPlan`（`steward.ts:161`） | `buildPatchProposalComposition` → 語意驗證收據 → `applyTransactionalStewardPlan(writerRole:'neutral-steward')`，寫 evidence |
| 文字合成 | `steward-transactional-apply.ts:143-173` | 名為 "against immutable base"，文字路徑實為 `proposals.reduce((c,p)=>applyUnifiedPatch(c,p.patch), before)`（`:148`）——**循序套用**；`serializabilityProof.permutationStable: true` 寫死（`:116-121`） |
| 交易式寫入 | `steward-transactional-apply.ts:246-389` | writerRole、digest、scope、base hash（stale → blocked）→ temp → canonical → 失敗 rollback。**品質良好，本文沿用** |
| 嚴格套用 | `applyUnifiedPatch`（`unified-patch.ts:79`） | context 不符即 throw `UnifiedPatchApplicationError`（`ATM_UNIFIED_PATCH_CONTEXT_MISMATCH`） |
| 身分 | `checkStewardPermission` | 只在 `arbitrateStewardRequest`（`steward.ts:316`）被呼叫；`applyStewardPlan`／`executeBrokerScopedWrite`／CLI `broker steward apply` 都不檢查 steward ≠ 提案者；CLI 預設 `stewardId='neutral-write-steward'` 但可任意帶 `--steward-id` |

另有一條結構化 composer（`transactional-composer.ts:68 composeTransactionalMutations`；text-range adapter 只支援 `.md/.txt`），吃 `MutationRequest` 而非 `PatchProposal`，具 canMerge／skipped／returnedQueueRequestIds 語意，可作為設計參考；兩條路徑的統一列為 P2-3。

### 5.2 設計：immutable-base 確定性合成（目標，P0-1）

核心改變是把「循序 reduce」換成「對同一 base 的合成」：

1. **解析**：把每份 `p_i` 的所有 hunk 都對**同一個** base `B` 解析，得到 `(start_i, oldLen_i, newLen_i, contextSpan_i)`；context 不符即記為合成錯誤（不拋出，見 §5.4）。
2. **不重疊檢查**（保守）：兩個 hunk 的**變更行＋context 行**任一交疊即視為重疊（IMPL_PLAN §7.1 風險緩解）；相鄰但 context 交疊的案例也歸為重疊、走 fail-closed。
3. **依檔內位置合成**：依 base 中的行號由下往上套用（或等價地累積 offset 平移），使上方 hunk 的插入／刪除不影響下方 hunk 的定位。這直接對應 v1 §3.5「套用時行數位移由 composer／steward 吸收」的承諾。
4. **排列穩定驗證**：真的跑 permutation——`N ≤ k` 時全排列，否則以「依位置排序＋兩兩不重疊」作為證明——將 `serializabilityProof.permutationStable` 與 `checkedPermutationCount` 改為實際值，而非寫死。
5. **輸出**：單一合成結果 `B'` 與其 digest，交給交易式寫入。

排列穩定在此設計下是**構造性**的：輸出只依賴 base 與 hunk 集合，不依賴 proposal 抵達順序或 anchor 字串排序。驗收以 S1b（兩種 anchor 排序 → 輸出 byte hash 相同）檢查。

### 5.3 「重疊」的定義與合成邊界

純行號合成的邊界是本設計最需要誠實說明之處。本文採「變更行＋context 行都不交疊」的保守定義，代價是部分語意上可合併的相鄰編輯會被拒絕；好處是：凡被判可合成者，unified diff 的 context 驗證在同一 base 上皆成立，沒有「context 被另一份 patch 改掉」的隱性風險。更細的邊界（symbol／AST-anchored 合成、Derived Atoms 的 atom 邊界）列為 P2-2。注意 compose 階段已有 anchor 重疊與 hunk 範圍重疊檢查（回 `needs-steward`），本設計在 steward 端**再驗一次**，因為 compose 的 `@@ -a,b` 範圍檢查未涵蓋 context 行。

### 5.4 fail-closed：結構化 blocked 收據（目標，P0-2、P0-3）

- **合成錯誤 → blocked**：在 `buildPatchProposalComposition` 捕捉 `UnifiedPatchApplicationError`；`applyStewardPlan` 回 `ok:false, verdict:'blocked'`，附 `blockedReasons`（例如 `compose-context-mismatch`）與衝突 proposalId；**絕不部分寫入**。
- **`needs-steward` 無最終 patch → blocked**：沒有附 steward-authored final patch 時，回 `blocked`（例如 `steward-final-patch-required`），列出 conflicts，退回提案者 re-propose。真正由 steward 解衝突屬 P2-1。
- 這把 v1 §3.4「blocked 是 containment，而非刪除提案者工作」的語意落到可被 CLI／harness 觀測的層級：收據保留衝突明細，提案者可據以 re-propose。

### 5.5 Identity gate：提案者 ≠ steward（目標，P0-4）

所有 apply 路徑（core `applyStewardPlan`、`executeBrokerScopedWrite` 與 CLI `broker steward apply`）一律檢查：`stewardId ∉ proposals[].actorId`，且 identity.kind = `neutral`；違反即 `blocked` + `invalid-steward-identity`，檔案不變。這是 v1 §3.2「中立 steward 為唯一正式套用權威」在程式碼層的強制化。CLI 在無 runtime handshake 時走 `directApplyResult` 是否也應要求 handshake／identity，列為 P1-7〔待核對〕。

### 5.6 交易式寫入（沿用）與驗收場景

寫入沿用 `applyTransactionalStewardPlan`：檢查 writerRole、digest、scope、base hash（stale → blocked）→ temp 寫入 → canonical → 失敗 rollback。合成正確性由下列驗收場景定義（IMPL_PLAN §5；M0 寫成 validator 測試、M2 寫成 bench 斷言）：

| ID | 場景 | 期望 | v0.1.17 現況 |
|---|---|---|---|
| **S1a** | 同檔、不重疊、兩個等長替換 | `parallel-safe`；`applied`；A、B 變更都在，其他行不變 | ✅（探針 #1） |
| **S1b** | 同檔、不重疊、上方 patch 插入或刪除行；兩種 anchor 排序各跑一次 | 兩種排序皆 `applied`、A、B 都保留、**輸出 byte hash 相同** | ❌（探針 #2 throw；#3 成功 → 順序依賴） |
| **S2** | 同檔、重疊 hunk | `needs-steward`；steward 回 `ok:false, verdict:'blocked'`＋conflict 明細＋proposalId；canonical hash 不變；**不 throw** | ❌（探針 #4：檔案未變，但以 throw 結束） |
| **S3** | `stewardId` 等於任一 proposal 的 `actorId`（API 與 CLI 各一次） | `blocked` + `invalid-steward-identity`；檔案不變 | ❌（探針 #5：`applied`） |
| S4 | canonical 檔在 compose 之後被改 | stale／`file-hash-drift` → blocked，可 re-propose | 現有行為（回歸） |
| S5 | 多檔部分失敗（`failAfterWrites`） | `rolled-back`，所有檔還原 | 現有行為（回歸） |
| S6（bench） | h1-a8 steward 臂 | lost=0、proposer_direct_writes=0、blocked 皆有收據、re-propose rounds 分佈可量 | 〔待 M2/M3 實測〕 |

### 5.7 與准入路由的關係

三種機制分工如下（IMPL_PLAN §6）：

- **冷熱分級准入**決定「誰要走 compose」：熱檔 proposal-first 下，無其他 writer → `provisional-write-lease`；同檔已有非 provisional holder → `composer-routed`；同 region 撞 provisional holder → `true-conflict`。
- **冷檔原生 serial queue（#180）**處理「同一 atom 一定要排隊」的情況。
- **Composer＋steward**處理「同檔不同 region 真的平行合併」——本文主軸。

一個重要的交互作用：在熱檔情境下，core 會把**同 region** 的後續 writer 也路由到 composer（`HOT_FILE_LATENCY.md` §1.1）。P0-3 修好之後，這些同區撞車會從「被 composer 默默吞掉（在 sync writer 下看起來 0 lost）」變成「可觀測的 fail-closed」。這是設計還是 bug、是否應在准入層改為 queue／park，列為 P1-4，需 ATM 作者確認〔待核對〕；本文會**同時報告正確性與重試成本**，而不以壓低 blocked 率為目標。

---

## 6. 現況缺口：唯讀探針與 #196

### 6.1 探針方法

唯讀探針在 `/tmp` 建拋棄式 git repo，只 import v0.1.17 core 原始碼，不修改 ATM 樹（`runs/composer-probe/probe.mts`；Node v24.21.0；`ATM=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17 node probe.mts`）。每個情境為兩份 `PatchProposal`、同一個 10 行檔、同一個 baseCommit／fileBeforeHash，依序呼叫 compose 與 steward apply，記錄 verdict、例外與最終檔是否保留 A／B 的變更。

### 6.2 結果

**表 P1　v0.1.17 compose／steward apply 探針（`runs/composer-probe/probe.out`）**

| # | 情境 | compose verdict／applyMethod | apply 結果 | 保留 A／B |
|---|---|---|---|---|
| 1 | 不重疊，兩邊等長替換（第 2、8 行） | `parallel-safe`／`patch-apply` | `applied` | ✅／✅ |
| 2 | 不重疊，排在前面的 patch 在上方且插入 1 行 | `parallel-safe`／`patch-apply` | **throw** `UnifiedPatchApplicationError: patch context mismatch at line 8: expected "line8", found "line7"` | ❌／❌ |
| 3 | 同 #2 的 patch，但 anchor 讓下方 patch 先排 | `parallel-safe`／`patch-apply` | `applied` | ✅／✅ |
| 4 | 重疊（兩邊都改第 5 行） | `needs-steward`／`steward-authored-final-patch` | **throw** `…context mismatch at line 5: expected "line5", found "A_EDIT"`（非 blocked 收據） | ❌／❌（檔案未變） |
| 5 | `stewardId='agentA'`（即提案者本人） | `parallel-safe` | **`applied`** | — |

### 6.3 解讀

1. **順序依賴**：#2 與 #3 只差排序，結果就不同。compose 判 `parallel-safe` 的兩份 patch，在 steward 端是否成功取決於 anchor 字串排序——這正是 v1 §3.5 所說「准入時不相交、套用時位移」的情況，而目前實作沒有吸收它。`permutationStable: true` 是寫死值，不構成證明。
2. **fail-closed 但不可觀測**：#4 沒有部分寫入（canonical 檔未變），就安全性而言等於 fail-closed；但它是以例外中斷，CLI／harness 拿不到 `verdict:'blocked'` 與衝突明細，提案者也無從據以 re-propose。
3. **角色分離未強制**：#5 中提案者本人以 steward 身分完成 apply，與 v1 §3.2 的角色分離不一致。
4. **`needs-steward` 被放行**：`planStewardApply` 只擋 blocked／human-required（`steward.ts:416-419`），`needs-steward` 會進入 apply，但沒有「steward 撰寫最終 patch」的實作（P0-3）。

**這些缺口在本稿撰寫時均未修好**。本節只描述現況，不構成「已修正」的主張。

### 6.4 P0 清單（#196）與里程碑

| ID | 層 | 缺口 | 修正方向（建議，非定案） |
|---|---|---|---|
| P0-1 | core | 循序 reduce 而非 immutable-base 合成；行數位移致失敗、結果依排序 | 對同一 base 解析、保守不重疊、依位置合成、真實 permutation 檢查 |
| P0-2 | core | 合成失敗以 throw 結束，無結構化收據 | 捕捉 → `ok:false, verdict:'blocked'`＋`blockedReasons`＋proposalId；不部分寫入 |
| P0-3 | core | `needs-steward` 被放行但無最終 patch 實作 | 無 steward-final-patch 即 blocked（`steward-final-patch-required`） |
| P0-4 | core＋CLI | 提案者可自我 apply | `stewardId ∉ actorId` 且 neutral；違反 `invalid-steward-identity` |
| P0-5 | harness | atm-bench 未驅動真 compose／steward；0 lost 綁 sync writer | 新增 `--atm-writer steward` 臂（§7） |
| P0-6 | 測試 | validators 無「多 proposal 真 apply」驗收 | S1–S4（兩種排序）加入 `validate-broker-steward.ts` 或新 `validate-broker-cowrite.ts` |

既有 validators 的覆蓋盲點：`validate-broker-compose.ts` 只測 compose verdict，沒有把兩份 proposal 真的 apply 到檔案；`validate-broker-steward.ts` 只測**單一** proposal apply（IMPL_PLAN §2.3）。這解釋了為何 #2／#4／#5 能在既有測試全綠的情況下存在。

里程碑（IMPL_PLAN §4）：**M0** 規格＋紅燈測試（S1b、S2、S3 預期紅燈，S1a 綠燈）→ **M1** core P0-1～4（S1–S4 全綠、兩種排序 byte hash 相同、既有 validators 不退化、rollback 測試仍通過；建議其後打 frozen tag，是否 publish 由使用者決定）→ **M2** harness 接線（steward 臂）→ **M3** 論文級證據（mp、延遲成本、KEY_TABLES 新表）。實際工時來源未提供。

---

## 7. 實驗設計（計畫中；結果〔待 M2/M3 實測〕）

### 7.1 研究問題

- **RQ1（保留性）**：在熱檔高壓情境下，steward 臂能否讓非重疊變更 lost update 為 0？與 stale（無合成）、control（無 ATM）相比如何？
- **RQ2（fail-closed 可觀測性）**：重疊衝突是否 100% 以 blocked 收據結束，0 次 silent overwrite、0 次例外中斷 run？
- **RQ3（角色分離）**：提案代理對 canonical 檔的直接寫入次數是否為 0？
- **RQ4（成本）**：compose window 等待、steward apply 時間、re-propose rounds 的分佈為何？wall 相對 sync（理想）與 stale 的差距多大？
- **RQ5（多 process）**：steward apply 與 registry CAS／per-file apply lock 在 4／6／8 procs 下是否仍 0 lost、0 registry 殘留？

### 7.2 實驗臂

| 臂 | writer | 意義 | 狀態 |
|---|---|---|---|
| control | — | 無 ATM：讀 base → hold → 整檔寫回（last-writer-wins） | 既有 |
| stale | `stale` | 採用 ATM 准入決策、無 composer apply（負面對照） | 既有（55–65% lost） |
| **steward** | `steward`（新） | composer_merge 的 intent 對 fixture（需為 git repo）產生真實 unified-diff `PatchProposal`（帶 baseCommit／fileBeforeHash／anchors／atomRefs）→ 每檔一個 compose window 收集 → `composeBrokerProposals` → 中立 steward `applyStewardPlan` | 〔待 M2〕 |
| sync（理想參考） | `sync` | apply 當下 read-modify-write＝理想 rebase；作為正確性與延遲的上界參考，**不是**主結果 | 既有 |

既有臂預設行為不變；steward 臂在獨立 worktree 執行（沿用「可逆、預設不變」原則）。

### 7.3 Oracle 與事件欄位

Oracle 不變：committed intent 的 marker 必須出現在最終 worktree，否則記為 lost update。steward 臂新增事件欄位：`steward_verdict`、`blocked_reason`、`repropose_rounds`、`proposer_direct_writes`；並記錄 compose window wait 與 steward apply ms。

### 7.4 兩個需在 M2 定義的語意

- **Compose window／觸發語意（P1-2）**：准入回 compose 之後，誰在什麼時候把同檔 proposal 收齊交給 steward（時間窗、N 個 proposal、或 holder release）？目前只有手動 CLI。這會引入新的等待，必須量測並與 sync／stale 對照。
- **Re-propose 迴圈（P1-3）**：前一輪 steward 寫入後檔案 hash 改變，後到的 proposal 會碰到 `file-hash-drift`／metadata mismatch；需定義「退回 → 在新 base 重新產生 patch → 重新 compose」，並量 rounds。

### 7.5 情境矩陣與驗收

| 情境 | 設定 | reps | 驗收（S6） |
|---|---|---|---|
| h1-a8 | hot_ratio 1.0、8 agents、`overlap=high`、trials 50、354 intents/rep | ×3 | lost=0；proposer_direct_writes=0；重疊衝突全部有 blocked 收據 |
| h1-a6 | hot_ratio 1.0、6 agents | ×3 | 同上 |
| h08-a8 | hot_ratio 0.8、8 agents | ×3 | 同上 |
| mp（M3） | 4／6／8 procs，共用 worktree＋registry | 〔待定〕 | 0 lost、0 registry 殘留 |

所有情境 `seed=42`，同時報 control／sync／stale 對照；表格附 run-id／seed／tag。

### 7.6 結果表（預留）

**表 R1（〔待 M2/M3 實測〕）共寫合成正確性**

| 情境 | 臂 | lost/rep（率） | blocked/rep | 有收據比例 | 例外中斷次數 | proposer_direct_writes | re-propose rounds mean/p95 |
|---|---|---|---|---|---|---|---|
| h1-a8 | control | 253（71.5%）🟢 | — | — | — | — | — |
| h1-a8 | stale（native） | 172.7（64.9%）🟢 | — | — | — | — | — |
| h1-a8 | sync（理想） | 0 🟡 | — | — | — | — | — |
| h1-a8 | **steward** | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 |
| h1-a6 | **steward** | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 |
| h08-a8 | **steward** | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 |

（control／stale／sync 列為 Oct 6 core@0.1.2 數字，引自 `HOT_FILE_LATENCY.md` TL;DR；正式稿需在同一 frozen tag 上重跑三臂。）

**表 R2（〔待 M2/M3 實測〕）共寫合成成本**

| 情境 | 臂 | wall（vs ctrl） | compose window wait p50/p95 | steward apply ms p50/p95 | overhead mean/p95 |
|---|---|---|---|---|---|
| h1-a8 | sync（理想；native） | 2549（1.01×）🟢 | — | — | 4.21／6.75 🟢 |
| h1-a8 | **steward** | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 | 〔待 M2/M3 實測〕 |

### 7.7 預期的誠實揭露

P0-3 修好後，熱檔同區撞車（h1-a8 目前每 rep 約 156 對同區重疊 pairs，全部是 composer＋composer）將大量轉為 fail-closed，「成功率」可能下降。這是本文**要揭露**的結果，而不是要規避的結果：論文將同時報「正確性」（lost、收據）與「重試成本」（blocked 率、re-propose rounds、wall）（IMPL_PLAN §7.1）。

---

## 8. 支撐實證：准入成本、冷檔排隊與跨 process 協定

本節的數字全部來自既有 run，**作為主軸的前提與對照**，不是本文主結果。所有「0 lost」均綁 **sync writer（理想 rebase）**。

### 8.1 熱檔准入：成本小，但正確性取決於合併（🟢 T6，帶 caveat）

**表 S1　熱檔 h1-a8（trials 50、354 intents/rep、×3）：Oct 6（core@0.1.2）vs v0.1.17**

| 臂 | 指標 | Oct 6 | v0.1.17 |
|---|---|---|---|
| control | wall；lost 率 | 2522；71.5% | 2521；71.5% |
| native（sync） | wall（vs ctrl）；reject/rep；lost；成功率 | 2549（1.01×）；84（23.7%）；0；76.3% | 2557；86.7；0；75.5% |
| loop（overlay，sync） | wall；reject；lost；成功率 | 2908（1.15×）；0；0；100% | 3037；0；0；100% |
| **nativestale** | lost 率 | **64.9%** | **65.0%** |
| **loopstale** | lost 率 | **65.2%** | **63.6%** |

其他情境（Oct 6，`HOT_FILE_LATENCY.md` §2.2）的 stale lost 率：h1-a6 55.5%／54.4%（native／loop）、h08-a8 64.6%／56.0%；對應 control 63.9%、68.0%。h1-a8 native 每 rep 的決策分佈為 composer_merge 210、hot_provisional 60、reject 84；同區重疊 pairs 約 156，全部是 composer_merge＋composer_merge。

**對主軸的意義**：（1）熱檔准入本身便宜（wall 1.01–1.02×、約 4–5 ms/intent），因此在准入之後加一層合成，其成本基準是清楚的；（2）准入把大部分熱檔 intent 路由到 composer，而沒有合併時的遺失率與無 ATM 幾乎一樣——**正確性幾乎全由 composer＋steward 承擔**；（3）loop 臂的 100% 成功歸功於 harness 重試 overlay，core 無 park（🟡）；原生會拒絕 17–24%。

### 8.2 冷檔原生 serial queue：與合成互補（🟢 T1–T3，partial）

冷檔同 atom 的衝突不走合成，而是排隊。v0.1.17 對同 atom（`cold_atom_identity=region`）回 `disposition=queue`（lane=serial）。

**表 S2　冷檔同檔（trials 60、`overlap=cold-same-file`、×3；matrix 2026-10-07 11:33:20–11:35:49 Asia/Taipei）**

| 臂 | agents | wall（vs ctrl） | wait p50/p95/max (ms) | commits／pass／lost（每 rep） |
|---|---|---|---|---|
| control | 8 | 3024.78（1×） | — | 441／62／379 |
| nqwait | 8 | 6208.2（**2.05×**） | 62/259/350 | 441／441／0 |
| control | 16 | 3027.87（1×） | — | 879／64／815 |
| nqwait | 16 | 9416.48（**3.11×**） | 105/343/637 | 879／879／0 |
| nqwait 單檔（×1） | 16 | 40368.98（**13.32×**） | 679/759/794 | 879／879／0 |

control lost 率（推算）85.9%（a8）、92.7%（a16）。nqwait first disposition：queue 740／direct 583（a8）、queue 1859／direct 778（a16）、queue 878／direct 1（單檔）。

**對主軸的意義**：排隊以序列化換正確性，代價隨競爭從約 2× 升到最壞 13×。這正是為何「同檔不同 region」值得真正平行合併——若把它們也排隊，就付出排隊的價格。**Caveat**：#180 為 partial pass——harness 以輪詢 activeIntent file-blocker＋re-eval 實現等待，**未**呼叫 `enqueueSerialIntent`、未驗證耐久 FIFO ticket；`queue_position` 在 nqwait 臂為常數 1，不是 FIFO 序號；0 lost 綁 sync writer。Oct 6 overlay 數字（2.03×／3.16×／13.2×，T4）僅為同量級對照（🟡）；V017 loop 臂數字不引用（🔴 T5）。

### 8.3 每筆准入成本與規模（🟢 T7、T9）

| 情境 | wall（vs ctrl） | overhead mean/p95 (ms) | lost |
|---|---|---|---|
| paced ×5（6 agents、168 intents/rep） | **1.03×** | 5.21／7.14 | — |
| S3 1000 trials（7244 intents），sp | **1.001×** | 4.77／6.45 | 0（ctrl 41.5%） |
| S3，8 procs | 1.001× | 9.35／20.9 | 0 |
| unpaced ×5（最壞上界，🟡） | 9.14× | 4.29／6.03 | — |

paced 拆解：latency_ms 2.92（p95 4.34）、apply_ms 2.2（p95 3.55）。S3 的 50 秒長跑 overhead p50 4.75–5.01 ms，無退化。unpaced 反映單 JSON registry＋fail-fast lock 的序列化瓶頸。以上為 core@0.1.2 數字。**對主軸的意義**：steward 臂的合成與交易式寫入將疊加在約 5 ms/intent 的准入成本之上；其額外成本〔待 M2/M3 實測〕。

### 8.4 跨 process：CAS 與 apply 互斥（🟢 T8）

| 情境／臂（core@0.1.2） | lost/rep | registry 殘留 | overhead mean/p95 |
|---|---|---|---|
| B control 8 procs | 201（71.3%） | — | 0.44／0.62 |
| B ATM 8 procs（CAS） | **0** | 0,0,0 | 8.69／21.63 |
| ⚠ B naive registry 8 procs | 0 | **37, 26, 32**（殭屍 lease） | 14.6／36.3 |
| ⚠ B apply-lock off 8 procs | **2（1.0%）** | 0,0,0 | 8.68／21.3 |

**對主軸的意義**：apply-lock off 的 1.0% lost **全部來自跨 process 的 composer_merge**——即使在 sync writer 下，合併路徑的寫入互斥一旦缺席就會丟更新。M3 的 mp steward 臂（P1-5）將沿用此負面對照方法。

---

## 9. 討論、限制與未來工作

### 9.1 本稿主張的強度

- **已可主張**（🟢）：准入 ≠ 不丟更新（stale 約 55–65% vs sync 0）；熱檔准入成本小；冷檔原生 queue 存在且代價可量（partial）；跨 process CAS 與 apply 互斥必要。
- **已可描述但非結果**：v0.1.17 steward apply 的三類缺口（探針，質性、可重跑）。
- **不可主張**（待 M1–M3）：共寫合成 0 lost、100% fail-closed 有收據、0 次提案者直接寫入、合成的延遲成本。
- 所有「0 lost」在本稿中均綁 sync writer；在 steward 臂數據出來前，不以 ATM 保證陳述。

### 9.2 設計限制

- **行號合成的保守性**：「變更行＋context 都不交疊」會拒絕部分語意可合併的相鄰編輯；細化需 symbol／AST-anchored 合成（P2-2），並接上 Derived Atoms（CID v2、occupy-both、stale→file-level；v0.1.17 測試通過但無性能數據，T11 🟡）。措辭沿用 v1 §6.1：adapter-guided，而非 AST-first——**不是**「ATM 不用 AST」。
- **語意衝突不在範圍**：文字不重疊不代表語意獨立（v1 §3.7 亦自我限定「正向准入裁決不代表全域語意獨立」）。語意驗證收據目前自簽且 `ok:true` 寫死（`steward-transactional-apply.ts:233-244`），需接 `post-compose-semantic-validation-policy.ts`／proposal validators（P1-1）。
- **重疊即拒絕**：本文不做 LLM／人工解衝突（P2-1）；steward-authored final patch 只定義 fail-closed 介面與審核收據需求。
- **同區路由語意未定**（P1-4）：同區第二、三 writer 被路由到 composer 是設計還是 bug，需作者確認；修正後是否在准入層改 queue／park 另議。
- **兩條 composer 路徑**：`PatchProposal`（本文）與 `MutationRequest`（`composeTransactionalMutations`）尚未統一（P2-3）。

### 9.3 外部效度威脅

- 除 mp 臂外，agents 為單 process 內 async worker，共用 event loop；hold 為 20–60 ms 模擬，非真 LLM 秒級思考（絕對等待隨 hold 等比放大為推論，未實測）。
- 單一 fixture（`atm-bench-fixture-v1-ts`）、單機；跨機 registry 未測（符合 v1 單域定位）。
- rep 數有限：多數臂 ×3，單檔與部分 scale 情境 ×1；未報告信賴區間。
- 同 seed 下 scenario 確定、admission 交錯非 bit-identical。
- 版本：支撐數字橫跨 core@0.1.2（Oct 6）與 v0.1.17；主結果須在 M1 後的同一 frozen tag 上重跑全部對照臂。

### 9.4 未來工作（依影響排序）

1. **完成 #196 P0 與 M2/M3**（本文主結果的前提）。
2. **Compose window 與 re-propose 協定**的正式定義與成本量測（P1-2、P1-3）。
3. **語意驗證接線**（P1-1）與 `BROKER_GUIDE.md`「Compose & steward apply」一節（P1-6）——目前程式碼行為比文件描述弱（BROKER_GUIDE `:86`、`:123`）。
4. **Steward-authored final patch**（人或 LLM 解衝突）及其審核收據（P2-1）。
5. **Symbol／AST-anchored 合成**，接 Derived Atoms 的 atom 邊界；Derived Atoms bench 臂（P2-2）。
6. **耐久 serial ticket 端到端**（`enqueueSerialIntent`＋eligible resume＋官方 position），使 #180 由 partial 推進到 full。
7. **熱檔 park／rearbitrate**（core 未完成）與 **#184 FileHeat／EMA heat-weight**（僅設計、未 merge）——皆不得寫成已完成。
8. **規模**：單 JSON registry 瓶頸、kill-9 stale-lock 回收、跨機（P2-4）；真 LLM／多 vendor 並行。

---

## 10. 結論

ATM v1 把寫入前准入立為一級治理問題，並把「准入之後的同檔合併」交給確定性 composer 與中立 steward。本文指出，這後半段才是遺失更新真正被消除或被放過的地方：同一組准入決策，沒有合併時丟掉約 55–65% 的更新，與完全不協調相差無幾。我們以唯讀探針證實，ATM v0.1.17 雖已具備 compose → merge plan → 交易式 steward apply 的完整 API，其文字合成卻是循序套用，因而對行數位移敏感、結果依排序而異，衝突以例外中斷，且未強制提案者與 steward 分離。

本文提出的 Composer＋中立 Steward 確定性共寫合成——對同一 immutable base 合成、真實排列穩定驗證、結構化 blocked 收據、身分閘門、沿用交易式寫入——是把 v1 §3.5 的承諾落到程式碼與可重現證據上的最小充分改動。它與冷熱分級准入（決定誰走 compose）及冷檔排隊（處理必須序列化者）分工互補。其效果——非重疊 0 lost、重疊 100% fail-closed 有收據、提案者 0 次直接寫入——在本稿中仍是**目標主張**，待 #196 修正與 M2/M3 實測後才能成立或被否證。

---

## 附錄 A：關鍵數據表精簡

| 編號 | 用途 | 數字 | 等級 | 來源 |
|---|---|---|---|---|
| A1 | 動機：無合併的遺失率 | stale lost：h1-a8 64.9%／65.2%（Oct 6）、65.0%／63.6%（v0.1.17）；h1-a6 55.5%／54.4%；h08-a8 64.6%／56.0% | 🟢 | T6；HOT_FILE §2.2 |
| A2 | 動機：無 ATM 的遺失率 | 熱檔 control 71.5%（h1-a8）、63.9%（h1-a6）、68.0%（h08-a8）；冷檔 85.9%（a8）、92.7%（a16，推算） | 🟢 | T1、T6 |
| A3 | 動機：理想合併參考 | sync writer 0 lost（所有既有臂） | 🟡 | T6 caveat |
| A4 | 動機：路由壓力 | h1-a8 native composer_merge 210/rep；同區重疊 pairs ~156/rep 全為 composer＋composer | 🟢 | HOT_FILE §1.1 |
| A5 | 缺口 | 探針 #1–#5（表 P1） | 質性 | probe.out |
| A6 | 支撐：熱檔准入成本 | wall 1.01–1.02×；overhead 4.21–4.53 ms；reject 17–24% | 🟢 | T6 |
| A7 | 支撐：冷檔排隊成本 | nqwait 2.05×／3.11×／13.32×；wait p95 259／343／759 ms | 🟢 partial | T1、T2 |
| A8 | 支撐：每筆成本 | paced 1.03×；S3 1.001×；~5 ms/intent | 🟢 | T7、T9 |
| A9 | 支撐：跨 process | CAS 0 lost；naive 殭屍 lease 37／26／32；apply-lock off 1.0% lost（全為跨 process composer_merge） | 🟢 | T8 |
| A10 | **主結果** | steward 臂 lost、blocked 收據比例、proposer_direct_writes、re-propose rounds、compose window wait、steward apply ms | **〔待 M2/M3 實測〕** | — |
| A11 | **主結果（mp）** | 4／6／8 procs steward 臂 lost、registry 殘留 | **〔待 M2/M3 實測〕** | — |
| A12 | 主 claim 綁定之 frozen tag | — | 來源未提供（待 M1 後定） | — |

## 附錄 B：v1 → v2 銜接

| v1 說了什麼 | v1 位置 | v0.1.17 現況 | v2 目標 |
|---|---|---|---|
| 同檔有界不相交 → composer＋中立 steward，不直接寫 | §3.4 Algorithm 1 safety note；Table 4 | 路徑存在；compose 判定正確（探針 #1–#3 皆 `parallel-safe`） | 保留 |
| 套用時行數位移由 composer／steward／CAS 吸收 | §3.5 | **未吸收**：探針 #2 throw、#3 成功（順序依賴） | immutable-base 合成＋真實排列驗證（P0-1） |
| blocked 是 containment，保留意圖與 patch envelope | §3.4 | 重疊時檔案未變，但以 throw 結束、無收據（探針 #4） | 結構化 blocked 收據（P0-2、P0-3） |
| 中立 steward 為唯一正式套用權威 | §3.2 | 提案者可自我 apply（探針 #5） | identity gate（P0-4） |
| CAS base-hash 重驗 | §3.5 第 6 層 | 交易式寫入已檢查 base hash（stale → blocked）、rollback 良好 | 沿用；S4／S5 回歸 |
| POS2 為同檔寫入鏈正向現場案例 | §3.5、§4.5 | 單例現場證據；無多代理系統性量測 | atm-bench steward 臂系統性量測〔待 M2/M3〕 |
| SERIAL：queue or serialize | Table 4 | 冷檔原生 `queue`（#180 partial） | 支撐證據（§8.2） |
| Late-joiner park／re-arbitration 已有支持 | §3.5 | harness 路徑觀察不到 park〔待補全文對照，需作者確認〕 | 不處理；與 P1-4 交集 |

## 附錄 C：Artifact 與重現

- ATM 現況：tag v0.1.17，commit `8dd6a1c6`（`/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`）；Oct 6 baseline HEAD `ed317820`。主 claim 之 frozen tag 待 M1 後定。
- 探針：`runs/composer-probe/probe.mts`、`probe.out`（Node v24.21.0；唯讀 import，不改 ATM 樹）。
- 支撐 runs：`runs/hot-file/`、`runs/v017/`、`runs/v017-q180/`、`runs/compare/`、`runs/multiprocess/`、`runs/scale/`。
- Issue：#196（2026-10-07 開）。本稿撰寫時未修改 ATM monorepo、未開 PR、未 push／publish；PR 可開但不 merge、不 publish、不打 tag，除非使用者明示。

## 附錄 D：本稿刻意降調處一覽

| 處 | 降調方式 |
|---|---|
| 主 claim（共寫合成 0 lost 等） | 一律「目標主張／待實測」，數字〔待 M2/M3 實測〕 |
| 既有「0 lost」 | 綁 sync writer（理想 rebase）；並列 stale 55–65% |
| 探針缺口 | 描述為現況，不寫成已修好 |
| `permutationStable: true` | 註明為寫死值，非證明 |
| 熱檔 100% 成功 | 歸功 harness overlay；原生 reject 17–24% |
| #180 | partial pass；不主張耐久 FIFO |
| 同區 → composer | 設計或 bug 待作者確認 |
| Claim Plane 對照 | 〔待核對 arXiv 原文〕 |
| v1 park 主張 vs 觀察 | 待釐清落差，不定性為回歸 |
| Derived Atoms、#184、park | 僅 future work |

---

## 參考文獻

[1] Eagl Huang. *ATM: CID-Brokered Pre-Write Admission for Multi-Agent Code Co-Synthesis — A Specification-Grounded Governance Substrate for Software Agents*. arXiv:2607.00041v1 [cs.SE], 2026-06-29.（本稿引用段落：摘要、§1.3、§1.4、§3.2、§3.4 Algorithm 1 safety note、Table 4、§3.5、§3.7、§4.5、§6.1；全文 `refs/arxiv-2607.00041.txt`；逐頁頁碼〔待補全文對照〕）
[2] Claim Plane. arXiv:2607.21909（作者、標題、日期〔待核對原文〕；PLAN_SPEC 另列 arXiv:2608.00947，關係〔待核對原文〕）。
[3] AI-Atomic-Framework repository, tag v0.1.17, commit `8dd6a1c6`；issue #196. https://github.com/eaglhuang/AI-Atomic-Framework
[4] ATM v1 所引相鄰工作（CodeCRDT arXiv:2510.18893、EvoGit、AgentGit、CodeTeam、SEMAP、MPAC、CoAgent、S-Bus、ATCC、Atomix、Cordon、AgenticFlict、CRDT [Shapiro et al. 2011] 等）：本稿僅轉述 v1 的定位，完整書目沿用 v1 參考文獻表〔待補全文對照〕。
[5] 三方合併／OT 相關經典文獻：本稿僅作定位比較，書目〔待補〕。

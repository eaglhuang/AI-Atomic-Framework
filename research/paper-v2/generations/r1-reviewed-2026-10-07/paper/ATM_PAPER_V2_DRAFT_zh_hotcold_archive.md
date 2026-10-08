---
title_zh: "熱檔提案、冷檔排隊：ATM 多代理程式共寫之冷熱分級寫入准入與冷檔序列化的實作與實證"
title_en_tentative: "Admit Hot, Queue Cold: Implemented Tiered Pre-Write Admission and Cold-File Serial Queuing for Multi-Agent Code Co-Writing in ATM"
subtitle: "把 ATM v1 已提出、已實作但未被充分描述與量測的機制，寫成可重現、帶負面對照的顯式貢獻"
positioning: "systems-implementation／實驗深化論文；ATM v1（arXiv:2607.00041）的續篇，非新理論"
version_date: 2026-10-07
atm_tag: "v0.1.17（commit 8dd6a1c6；packages/*/package.json 仍顯示 0.1.2，以 tag 為準）"
harness: "atm-bench 0.3.0-latency"
status: "草稿／非正式投稿（DRAFT — NOT FOR SUBMISSION）"
sources: "PAPER_V2_DRAFT_PACK.md、PAPER_V2_KEY_TABLES.md（T1–T11）、PAPER_V2_EXPERIMENT_NOTES.md、refs/arxiv-2607.00041.txt（ATM v1 全文）"
---

# 熱檔提案、冷檔排隊：ATM 多代理程式共寫之冷熱分級寫入准入與冷檔序列化的實作與實證

**英文暫定標題**：Admit Hot, Queue Cold: Implemented Tiered Pre-Write Admission and Cold-File Serial Queuing for Multi-Agent Code Co-Writing in ATM

**一句定位**：ATM v1 把「寫入前准入」立為一級治理問題；本文（v2）不再發明新的時序權威，而是把 v1 已提出、在 ATM v0.1.17 已落地的**冷熱分級准入**與**冷檔原生排隊**寫成顯式貢獻，並以可重現的 conflict harness（atm-bench）量出其正確性與代價——包括它做不到的地方。

> ⚠ **草稿／非正式投稿**。版本日期 2026-10-07（Asia/Taipei）。ATM tag v0.1.17。
> 標記說明：🟢＝彙整包標為論文可用；🟡＝有 caveat（輔助／附錄／動機）；〔待核對原文〕＝來自對話共識、本 box 無原文可驗證；〔待補全文對照〕＝已讀 v1 全文但尚需逐頁對照或作者確認。所有數字抄自 `PAPER_V2_KEY_TABLES.md` 等報告，未重算（標「推算」者為彙整包以來源數字相除所得）。

---

## 摘要

多個 LLM 代理在同一受控工作樹中共寫程式時，最直接的失效模式是**遺失更新**（lost update）：兩個代理讀同一基底、各自修改後寫回，後寫者覆蓋先寫者。ATM v1（arXiv:2607.00041）將此問題定位為「單一治理域內的寫入前准入」，提出 CID broker、atom／virtual atom、七層硬閘門與中立 steward；但 v1 的評估以確定性情境（AdmissionBench 20 情境／42 比較）與現場案例為主，明言不主張延遲、吞吐等效能優勢，對「熱檔」與「冷檔排隊」這兩條已實作路徑也只有零星描述——其 OperationalBench 中的 queue-wait 甚至落在計時下限（P50/P95/P99 = 0.001/0.002/0.004 ms），等於沒有量到排隊。

本文補上這一段。我們（1）把 ATM v0.1.17 的**冷熱分級寫入准入**——熱檔 proposal-first（provisional-write-lease／composer-routed／true-conflict）與冷檔直通或原生 `queue`（lane=serial）——寫成顯式機制；（2）以 atm-bench 直接驅動真 ATM broker API（`calculateBrokerDecision`、`evaluateBrokerAdmission`、`registerIntent/releaseTask`），在 seeded 情境、ground-truth oracle 與 control／native／overlay／stale 多臂下量測。主要結果：在冷檔同檔競爭下，無 ATM 的 control 遺失 85.9%（8 agents）／92.7%（16 agents）的已提交更新，ATM 原生排隊臂（nqwait）為 0 lost，代價是 wall time 2.05×／3.11×，最壞同檔情境 13.32×；熱檔准入 wall 僅 1.01–1.02×，但原生會拒絕 17–24% 的 intent；ATM 每筆准入成本約 5 ms（單 process）、跨 process 約 8–10 ms，7244 筆長跑無退化；跨 process 共用 registry 時，CAS 與 apply 互斥是必要協定（拿掉後分別出現殭屍 lease 26–37／rep 與 1.0% lost）。

所有「0 lost」皆**以同步 writer（理想 composer apply）為前提**，本文未驅動真 composer apply；無 composer apply 的 stale 對照仍有 55–65% lost。冷檔排隊屬 **partial** 驗證：量到原生 `queue` 決策與等待成本，但**未**驗證耐久 FIFO ticket。熱檔 park／rearbitrate、經驗驅動熱度（#184）與 Derived Atoms 效能皆列為未來工作。

**關鍵詞**：多代理程式生成、寫入前准入、遺失更新、冷熱分級、序列化佇列、可重現基準

---

## 1. 引言

### 1.1 問題：從「能不能寫」到「誰先寫、怎麼等」

ATM v1 的核心問題是：「當多個代理已在同一受控檔案系統、工作樹或服務域中形成寫入意圖，系統能否在任何受治理的共享變更被套用**之前**，決定哪些意圖可並行、哪些需確定性組合或序列化、哪些必須 fail-closed？」（v1 §1.1）。v1 的回答是一條「規格到證據」的治理鏈：adapter 引導的原子化把寫入意圖映射到語意 atom 與有界區域；broker 依 CID、共享面、讀寫依賴、實體重疊、已知 atom 覆蓋、virtual atom 覆蓋、有界區域的順序比對（v1 §3.4），產出 parallel-safe／needs-physical-split／SERIAL／blocked-cid-conflict／blocked-shared-surface 等裁決（v1 Table 4）；最後由中立 steward 而非提案代理執行套用（v1 §3.2）。

這個框架回答了「能不能寫」，但在實務上，多數衝突落在兩種截然不同的檔案上：

- **熱檔**（任務狀態機、broker、evidence 等多人頻繁觸碰的檔案）：重疊是常態，若一律拒絕或序列化，並行度會被全吃掉；
- **冷檔**（偶爾才有兩人同時碰）：重疊少見，但一旦發生，「快速擋掉」會把可保留的工作丟回給代理重做，「直接放行」則導致遺失更新。

v1 Table 4 對 SERIAL 的後續路徑寫的是「Queue or serialize the preserved intent; replay after the active holder completes」，§3.4 也說 fail-closed 是「對無監督並行／直接套用 fail-closed，而非對意圖保存 fail-closed」。換言之，**排隊在 v1 中是一個被承諾的後續路徑，而不是一個被量測的機制**。v1 的 OperationalBench 明說它「不主張延遲、吞吐」優勢，其 queue-wait 路徑在 N=50 下為 0.001/0.002/0.004 ms（P50/P95/P99），「應視為目前 harness 的性質」（v1 §5.2）。

### 1.2 為什麼需要 v2

v2 的動機有兩層。第一層是**描述不足**：ATM v1 對已實作機制（熱檔 provisional lease、composer 路由、冷檔原生 serial queue、registry CAS）的著墨不足，使後續工作（如 Claim Plane，arXiv:2607.21909）得以宣稱相近貢獻（彙整包 L-P1）。第二層是**量測不足**：v1 的證據回答「裁決是否正確」（route-label、intent preservation 97.62%、42/42 matched expectations；v1 Table 11），但沒有回答「正確的代價是多少」——尤其是冷檔從「快速擋住」改為「排隊」之後（PLAN_SPEC §1.1）。

因此 v2 刻意**不**進入 ChangeIntent／時序權威的辯論（L-P2），而是把兩件事做紮實：

1. 把已落地的冷熱分級准入與冷檔排隊，綁定 frozen tag（v0.1.17，commit `8dd6a1c6`）寫成可被引用的機制；
2. 用可重跑、帶負面對照的實驗，量出「0 lost update」與「延遲代價」之間的 trade-off，同時誠實揭露哪些保證依賴未驗證的前提。

### 1.3 貢獻

- **C1 冷熱分級寫入准入（已落地）**：熱檔走 proposal-first（provisional-write-lease、composer-routed、true-conflict），冷檔直通或排隊；由真 ATM broker API 驅動量測（🟢，§3、§5.2）。
- **C2 冷檔原生 serial queue（#180，partial）**：v0.1.17 對同 atom（region identity）回 `disposition=queue`（lane=serial）；在 harness 等待下等待時間可量、0 lost（🟢 partial pass，§5.1）。
- **C3 正確性 vs 成本的定量刻畫**：冷檔 control 86–93% lost vs ATM 0 lost（sync writer 下），代價 2.05×／3.11×／13.32× wall；熱檔 native 1.01–1.02×（🟢 帶 caveat，§5.1–5.2）。
- **C6 可重現 conflict harness（atm-bench）**：seeded scenario、ground-truth oracle、事件 JSONL、mock／real／control 三後端與 stale／naive／apply-lock-off 負面對照（🟢 工具貢獻，§4）。

系統深度支撐：**C4** 每筆准入成本小且穩定（§5.3）；**C5** 跨 process 共用 registry 的必要協定（§5.4）。Derived Atoms（C7）以設計＋功能正確性小節呈現（§3.6），不作實驗主張。

---

## 2. 背景與相關工作

### 2.1 ATM v1：CID-brokered pre-write admission

ATM v1（Huang，arXiv:2607.00041v1，2026-06-29，cs.SE）的三項貢獻為：（i）帶 virtual-atom 後備的七層寫入前准入閘門（CID identity、shared surface、read/write set、file range／virtual atom、ConflictKey+canMerge、CAS base-hash、fallback file lock）；（ii）規格到證據的治理基底（task-direction lock、pre-tool scope gate、validator envelope、evidence blocker、closure packet 等），CID broker 為其中的共享變更准入子系統；（iii）以 AtomizationPlanningAdapter／FileMutationAdapter 合約為界的可擴充原子化抽象，「不需先轉成通用 AST」（v1 §1.3）。

v1 的評估由受控、現場、採用者與延伸證據構成：12 情境確定性設計矩陣、3 個封存 runner case、ATM-AdmissionBench（v0.1 凍結基底；v0.2 論文 profile 為 20 個獨立情境、42 個 mode-level 比較）、三個同檔邊界現場案例 POS2／B-12／BLOCK、三週外部採用者研究，以及 OperationalBench（v1 摘要、§4–§5）。v1 自己的結論是「支持在觀察到的單域設定下可行，但不支持相對其他並行控制系統的廣泛優越性」；並明言 ATM「既不取代 Git merge，也不處理跨 clone 或跨 PR 的治理」（v1 摘要）。§3.7 列出五項不保證：無跨機分散式協調、跨語言 atom identity 未解、admission 時 active-intent 轉發不完整、liveness／starvation 需正式證明、CID schema 遷移與 adapter 信任邊界待強化。

**v1 → v2 的銜接**（本文的定位核心）：

| 機制 | v1 怎麼寫 | v2 補什麼 |
|---|---|---|
| SERIAL／排隊 | Table 4：「Queue or serialize the preserved intent; replay after the active holder completes」；OperationalBench queue-wait 在計時下限（v1 §5.2） | v0.1.17 冷檔原生 `queue` 決策；在真實等待下量到 wait p50/p95/max 與 wall slowdown（§5.1） |
| 熱檔 | 只在 §3.4 governed transaction 段落順帶提到「writer enters a hot file」；無熱檔專屬准入敘述 | proposal-first 熱檔路徑（provisional-write-lease／composer-routed／true-conflict）、靜態熱檔集合、native reject 率與成本（§3.3、§5.2） |
| Composer／steward | 有：needs-physical-split → deterministic composer → neutral steward apply；POS2 為正向案例（v1 §4.5） | 量出「沒有 composer apply 會怎樣」：stale writer 55–65% lost（§5.2）；並承認 v2 本身亦未驅動真 composer apply |
| Park／re-arbitration | §3.4：governed transaction 讓 broker 有可 park、re-arbitrate 的 handle；§3.5 將「Late-joiner park and re-arbitration」列為已有實作＋驗證支持的一組 | **衝突待釐清**：在 v0.1.17 的 harness 路徑上，core 訊息寫「should be parked for rearbitration」但直接回 reject，觀察不到 park 協定（§6.2）〔待補全文對照／需 ATM 作者確認〕 |
| Active registry | §6.4：Active Registry「目前為 broker-local in-memory 結構」 | v0.1.17 觀察到的是檔案型 registry（`.atm/runtime/write-broker.registry.json`）＋CAS write-lock、on-demand CLI 非常駐 daemon；並量到跨 process CAS 的必要性（§3.5、§5.4）〔版本差異待補全文對照〕 |
| 規模瓶頸 | §6.2 第 6 點：單 broker 可能成為吞吐瓶頸，shard／federated 為未來工作 | 給出實測上限與現象：unpaced ~236/s（sp）、~280/s（8 procs）、hot loop backlog（§5.3、§6.2） |

另需註明：v1 的框架層 frozen anchor 為 release tag `v0.9.0-alpha.1`（commit `0b31aa86…`；v1 §1.4 Reproducibility），本文以 GitHub tag `v0.1.17`（commit `8dd6a1c6`）為準，且其 `packages/*/package.json` 顯示 0.1.2。兩條版本號的對應關係**來源未提供**，投稿前須釐清並在 Artifact 附錄說明〔待補全文對照〕。

### 2.2 Claim Plane

Claim Plane（arXiv:2607.21909；PLAN_SPEC 另列 2608.00947）以宣告的資源／區域權限重疊為核心模型，佔位採 contingent → JIT promote → re-admit，contingent 預設**無**寫入權限。與 ATM 的關鍵差異是：ATM 在熱檔重疊風險下延後的是 *full write-admitted*，但 `registerIntent` 時**仍把 write surface 寫入 `activeIntents` 的 resourceKeys**；因此「ATM 的延後佔位」**不等於** Claim Plane 的 JIT。我們把 Claim Plane 的「宣告 may-touch 但不取得寫入權限」視為 ATM 目前缺少、可吸收的一條**窄路徑**，兩者互補而非替代；本文不與 Claim Plane 做 JIT 同表硬比（PLAN_SPEC §4.3）。

以下三點來自 2026-10-06／07 的討論共識，本 box 無 Claim Plane 原文，**全部〔待核對 arXiv 原文〕並需附頁碼**，正式稿前不得以肯定句出現：
- Claim Plane 的實驗樣本規模較小（約 6-pair）；
- Claim Plane 未報告 worse-than-expected 的效能數據；
- ATM 的 WriteIntent／broker admission 公開時間早於 Claim Plane 約 25 天（ATM v1 的 arXiv v1 版本日期為 2026-06-29，見其 arXiv 標記；Claim Plane 日期需核對）。

### 2.3 其他相鄰工作

v1 已以「協調粒度 × 介入點」組織相關工作：字元級／版本控制基底（CodeCRDT、EvoGit、AgentGit）、檔案／工作區／工作流治理（CodeTeam、SEMAP、MPAC）、代理並行控制（CoAgent、S-Bus、ATCC）、交易式工具效果（Atomix、Cordon），以及事後 merge 衝突壓力的量化（AgenticFlict）（v1 §1.1、§2）。v2 沿用此定位，不重複綜述。Semantic Transactions／Cordon 類的 effect outbox 是**互補層**：本 harness 只管 repo 共寫，不管支付或網路出盒等外部副作用（PLAN_SPEC §5；細節來源未提供）。ATP／Mnemosyne 的 Proposal Non-Authority 不在本實驗範圍。

---

## 3. 系統與機制（ATM v0.1.17）

### 3.1 部署形態

Write Broker **不是常駐 daemon**：它是 on-demand CLI，加上檔案型 registry（`.atm/runtime/write-broker.registry.json`）與 CAS write-lock；`atm daemon` 只有 advisory 作用（`BROKER_HARD_GATE_AUDIT.md`）。這與 v1 §3.7「單域仲裁者」的定位一致：broker 需要看得見同一個檔案系統、工作樹或 registry，才能對 active intents 做一致決策。

### 3.2 決策順序與 disposition

`calculateBrokerDecision` 的實作決策順序為：shared surface → CID／atomId 衝突 → proposal overlap → physical overlap → parallel-safe（`COLD_QUEUE_LATENCY.md` §1）。注意此順序與 v1 §3.4 列出的 gate order（CID 先於 shared surface）不同；本文以程式碼為準描述 v0.1.17 行為，差異原因待與作者確認。

broker 回傳的 disposition 在 harness 中映射為五種決策：

| ATM disposition | harness decision | 意義 |
|---|---|---|
| `direct` | admit | 直通寫入 |
| `proposal-required` | hot_provisional | 熱檔 provisional 路徑 |
| `compose` | composer_merge | 送 composer 組合 |
| `queue` | cold_queue | 冷檔序列化排隊（lane=serial） |
| `true-conflict` | reject | 真衝突，拒絕 |

### 3.3 熱檔：proposal-first 准入

熱檔判定目前是**靜態**集合：`HOT_FILE_BASENAMES = {tasks.ts, next.ts, evidence.ts, hook.ts, team.ts, broker.ts}`（`packages/core/src/broker/team-lane.ts`）。命中即走 proposal-first：

- 無其他 writer → `provisional-write-lease`；
- 同檔已有非 provisional holder（**包含同 region**）→ `composer-routed`；
- 同 region 撞上 provisional holder → `true-conflict`／`blocked-active-lease`。此時 core 訊息寫「should be parked for rearbitration」，但**沒有** park 協定，直接回 reject（`HOT_FILE_LATENCY.md` §1）。

「同 region 的多個 writer 被送進 composer 共寫」究竟是設計還是 bug，需 ATM 作者確認（彙整包 §8.2 P3）。

### 3.4 冷檔：原生 serial queue（#180）

ATM v0.1.17 的樹內新增 `packages/core/src/broker/decision/serial.ts` 與 `serial-queue/`；issue #180 於 2026-10-07 00:43（Asia/Taipei）關閉（`V017_HOT_COLD.md`）。在 `cold_atom_identity=region` 下，同一冷檔同一 atom 的第二個 intent 會收到 `disposition=queue`（lane=serial），而不再像 Oct 6 baseline（core@0.1.2，HEAD `ed317820`）那樣主要落入 compose 或 true-conflict（T5 質性證據：first disposition 由 true-conflict 707／direct 616 變為 queue 1096／direct 227）。

**範圍聲明**：ATM 另有耐久 serial ticket API（`enqueueSerialIntent`／eligible resume）。本文的 harness **未**呼叫此 API，而是對 activeIntent file-blocker 輪詢再 re-eval。因此本文能主張的是「ATM 會回原生 `queue` 決策，且在等待下阻塞 caller 並量得成本」；**不能**主張「耐久 FIFO ticket 已端到端驗證」。

### 3.5 Registry CAS 與 apply 互斥

Registry store 介面為 `createBrokerRegistryStore(path).read()／write({base, next})`；base 不符時丟 `ATM_BROKER_REGISTRY_CAS_CONFLICT`，由 caller 重問。`.write-lock` 以 `openSync(…,'wx')` fail-fast 取得，**無**等待、**無** stale-lock 回收（`MULTIPROCESS_SMALL.md`）。跨 process 正確性需要兩件事同時成立：registry 的 CAS read-modify-write，以及 worktree apply 的互斥（§5.4 以負面對照證明兩者皆必要）。

### 3.6 Derived Atoms（設計＋功能正確性；不作實驗主張）

v1 的 virtual atom 是「atom map 不完整時的暫時治理單位」（v1 §1.3、§3.3）。v0.1.17 的 Derived Atoms（計畫代號 ATM-DERIVED）把它推進一步：**認領時當場推導**、不預存全庫地圖；以既有 `AtomCandidate` → 確定性 `atomCid` 為主鍵，而非旁掛 path 鏡像（`VIRTUAL_ATOM_INDEX_ANALYSIS.md`）。依 2026-10-07 鎖定的 Draft v0.4 方向：

1. two-stage claim reservation：claim 時可選 `--atoms` 預約，commit 時以 diff 確認；
2. CID v2：不含 `detectionMethod`、無 compat flags；
3. occupy-both：正式 atom 與推導 atom 同時佔用；
4. stale → file-level：失效認領降級為檔案級；
5. `VirtualAtomInUse` 作為 derive／CID 層，而非重複的衝突計算。

> ⚠ **版本衝突註記**：檔案 `VAI_COMMIT_ATLAS_PLAN.md` 仍為 **Draft v0.3**，其 CID v2 公式**仍含** `detectionMethod`；本文依彙整包以**對話鎖定的 v0.4**（無 `detectionMethod`）為準。v0.4 尚未文件化，投稿前必須補 v0.4 文件。

tag v0.1.17 的測試全數通過（T11，🟡）：candidate-bridge 9 項（含「cid.v2 identity is independent of line numbers」「cold CID conflict scenario reaches native serial admission」）、derived atom identity、occupancy rules（confirmation、preamble、conflicts、drift）、「same-file different-atom tasks run in parallel; overlapping atoms are refused at commit」。這些是 pass/fail，**沒有**延遲或並行度數據；npm 尚未 publish。措辭為：implemented in v0.1.17 and covered by tests; quantitative evaluation is future work。

同檔隔離的立場沿用 v1 §6.1「Adapter-guided, not AST-first」：反對**強制**全 AST，偏好 adapter 引導的原子化——這**不是**「ATM 不用 AST」。

---

## 4. 實驗設置

### 4.1 Harness 與環境

| 項目 | 值 |
|---|---|
| Harness | atm-bench `0.3.0-latency` |
| ATM（主） | GitHub tag v0.1.17 → commit `8dd6a1c6`；package.json 仍為 0.1.2 |
| ATM（Oct 6 baseline） | `@ai-atomic-framework/core@0.1.2`，HEAD `ed317820`（尚無 `decision/serial.ts`） |
| Node | v24.21.0（real 後端需 ≥22 strip-types） |
| 機器 | 單一 box，8 vCPU／16 GB（跑時可用約 3 GB） |
| Fixture | `atm-bench-fixture-v1-ts`（TypeScript mini-app，含 hot/cold 檔與 region markers） |
| Oracle | 已提交 intent 的 marker 必須留在最終 worktree，否則記為 lost update |
| 計時 | `performance.now()`；百分位採 nearest-rank |

harness 直接呼叫真 ATM 的 `calculateBrokerDecision`、`evaluateBrokerAdmission`、`registerIntent／releaseTask／saveRegistry`，非模擬 broker（mock 後端僅作管線驗證）。

### 4.2 Seed、時序與重現性

所有實驗 `seed=42`；同 seed 產生同一 scenario hash（small：`80d54e045f6d9c41…`；smoke：`c05b6019aae3f13a…`）。但 admission 交錯受時序影響，同 seed 的決策直方圖會略有浮動——故本文的重現性聲明是「**scenario 確定、admission 交錯非 bit-identical**」。paced 模式：hold 20–60 ms、tick 50 ms、jitter 15 ms；unpaced 全為 0。

### 4.3 實驗臂

| 臂 | 意義 |
|---|---|
| control | 無 ATM：讀基底 → hold → 整檔寫回（last-writer-wins） |
| native | 真 ATM 原生行為（熱：true-conflict → reject；冷：`--cold-retry once`，等一輪） |
| **nqwait** | 冷檔 `--cold-retry native-queue`：持續等 `queue`∣`true-conflict` 直到 grant／timeout（#180 主臂） |
| loop | 熱：`--hot-retry loop` harness overlay；冷：只等 true-conflict（v0.1.17 下對 queue 等待為 0，語意過期，不作成本） |
| *stale | 無 composer apply 的 writer：負面對照 |
| mp-* | 每 agent 一個 OS process，共用 worktree＋registry（CAS／naive；apply-lock on/off） |

writer 預設為 `sync`：同步 read-modify-write，等同理想的 composer／rebase。這是本文所有「0 lost」的前提（§6.1）。

### 4.4 研究問題

- **RQ1**（冷檔排隊）：原生 `queue` 能否在不丟更新的前提下運作？代價如何隨競爭（8 → 16 agents → 單一檔案）增長？
- **RQ2**（熱檔准入）：proposal-first 熱檔准入的成本與拒絕率為何？composer apply 缺席時會發生什麼？
- **RQ3**（成本與規模）：ATM 每筆准入的成本為何？paced／unpaced 與長跑下是否穩定？
- **RQ4**（多 process）：共用 registry 時，哪些協定是必要的？

---

## 5. 結果

### 5.1 RQ1：冷檔原生排隊（#180）

設定：`trials=60`、`hot_ratio=0`、`overlap=cold-same-file`、`cold_policy=queue`、`queue_timeout_ms=15000`、`cold_atom_identity=region`；每臂 ×3 reps（matrix 2026-10-07 11:33:20–11:35:49，Asia/Taipei）。

**表 1（🟢，T1）冷檔同檔：正確性 × 延遲**

| 臂 | agents | wall ms | vs ctrl | goodput pass/s | waited frac | wait p50/p95/max (ms) | commits／pass／lost（每 rep） |
|---|---|---|---|---|---|---|---|
| control | 8 | 3024.78 | 1× | 20.5 | 0 | — | 441／62／**379** |
| native (once) | 8 | 4299.97 | 1.42× | 102.57 | 0.689 | 25/55/70 | 441／441／**0** |
| **nqwait** | 8 | 6208.2 | **2.05×** | 71.04 | 0.559 | **62/259/350** | 441／441／**0** |
| control | 16 | 3027.87 | 1× | 21.14 | 0 | — | 879／64／**815** |
| native (once) | 16 | 5873.42 | 1.94× | 149.66 | 0.889 | 29/60/85 | 879／879／**0** |
| **nqwait** | 16 | 9416.48 | **3.11×** | 93.35 | 0.705 | **105/343/637** | 879／879／**0** |

reject 與 timeout 在所有臂均為 0。control 的 lost 率（推算）8 agents 為 379/441 ≈ 85.9%，16 agents 為 815/879 ≈ 92.7%；nqwait 的 goodput 為 control 的約 3.47×（a8）與 4.42×（a16）（推算）。

**表 2（🟢，T2）最壞同檔（cold-one-file，16 agents，×1 rep）**

| 臂 | wall ms | vs ctrl | waited frac | wait p50/p95/max | lost | queue_rounds mean/p95/max |
|---|---|---|---|---|---|---|
| control | 3030.19 | 1× | 0 | — | 818／879 | — |
| native (once) | 5549.11 | 1.83× | 0.997 | 22/56/68 | 0 | — |
| **nqwait** | **40368.98** | **13.32×** | 0.999 | **679/759/794** | 0 | 14.55/15/15 |

在全部擠進一個檔案時，排隊退化為完全串行：wall 約等於 Σhold 加上每筆約 5 ms 的 ATM 成本。Oct 6 的驗算（T4）為 Σhold 35.2 s ＋ Σ(broker+apply) 4.6 s = 39.8 s，與實測 40.0 s 吻合。

**disposition 證據（T3）**：nqwait 的 first disposition 為 queue 740／direct 583（a8）、queue 1859／direct 778（a16）、queue 878／direct 1（單檔）；queue_rounds 平均 2.37、3.26、14.55。wait 直方圖顯示等待隨競爭右移：nqwait a8 沒有超過 400 ms 的樣本；a16 有 64 筆落在 (400, 800] ms；單檔有 859/879 筆落在 (400, 800] ms。

**解讀**：

1. v0.1.17 的冷檔衝突**會**得到原生 `queue` 決策，並在等待下阻塞 caller——這補上了 v1 只把 queue 當後續路徑承諾、OperationalBench queue-wait 停在計時下限的空白。
2. 排隊的價格清楚可見：中等競爭約 2×，高競爭約 3×，病態單檔約 13×。這是「以延遲換正確性」的誠實刻畫，而非「排隊免費」。
3. native（once）臂的 1.42×／1.94× 只等一輪，是「原生 queue 存在且有成本」的**下界**（🟡），不是完整排隊成本。

**對照 Oct 6（🟡，T4）**：core@0.1.2 時原生 `queue` 尚不可達，冷檔等待由 harness overlay（等 true-conflict 再重問）實現，得到 2.03×（a8）、3.16×（a16）、13.2×（單檔）。與 nqwait 的 2.05×／3.11×／13.32× 屬**同量級**，但機制不同，**不可**據此主張 v0.1.17「變快」或「變慢」。V017 matrix 的 loop 臂（1.12×、2.19×、2.43×，wait=0）是 harness 語意過期造成的虛短數字，本文不引用為成本（🔴，T5）。

**#180 判定：partial pass**。已滿足「關掉 overlay 仍能量到原生 queue」；未滿足「耐久 ticket／明示 FIFO」。nqwait 臂的 `queue_position` 為常數 1，**不是**官方 FIFO 序號。

### 5.2 RQ2：熱檔准入

設定：`trials=50`、`overlap=high`、`hot_ratio=1.0`、8 agents、354 intents/rep，×3。

**表 3（🟢，T6）熱檔 h1-a8：Oct 6（core@0.1.2）vs v0.1.17**

| 臂 | 指標 | Oct 6 | v0.1.17 |
|---|---|---|---|
| control | wall；lost 率 | 2522；71.5% | 2521；71.5% |
| native | wall（vs ctrl）；reject/rep；lost；成功率 | 2549（1.01×）；84（23.7%）；0；76.3% | 2557；86.7；0；75.5% |
| loop（overlay） | wall；reject；lost；成功率；waited p95 | 2908（1.15×）；0；0；100%；61 ms | 3037；0；0；100%；52 ms |
| nativestale | lost 率 | 64.9% | 65.0% |
| loopstale | lost 率 | 65.2% | 63.6% |

Oct 6 其他情境：h1-a6 native 1.01×、59 rejects/rep、成功率 78.1%；h08-a8 native 1.02×、68 rejects/rep、80.8%；loop overlay 在三種情境皆 0 reject、100% 成功，wall 1.10–1.15×；native 每筆 overhead mean 約 4.21–4.53 ms，goodput 為 control 的 2.1–2.6×。

**解讀**：

1. **熱檔准入本身很便宜**：wall 1.01–1.02×，約 4–5 ms/intent。
2. **原生會拒絕 17–24%**：由於 core 沒有 park／rearbitrate，同 region 撞上 provisional holder 時直接拒絕。loop 臂的 100% 成功**歸功於 harness 的重試 overlay**，不是 ATM 原生能力（🟡）。
3. **composer apply 是正確性的另一半**：stale writer（無 composer apply）下 lost 率 55–65%，接近 control。也就是說，**ATM 准入本身不保證無遺失更新**；它保證的是「把重疊路由到應該組合的地方」，真正避免覆蓋還需 composer／steward 正確套用。這呼應 v1 的設計（composer → neutral steward apply；v1 Table 4、§4.5 POS2），但 v2 首次以負面對照量化缺了這一步的後果。
4. **改版穩定**：v0.1.17 與 Oct 6 的熱檔行為幾乎不變（reject 86.7 vs 84/rep；成功率 75.5% vs 76.3%）。
5. native／loop 的同區重疊（h1-a8 每 rep 約 150–176 對）**全部**是 composer_merge＋composer_merge，對應 §3.3 待確認的同區 co-write 語意。

### 5.3 RQ3：每筆准入成本與規模

**表 4（🟢，T7）paced vs unpaced（6 agents × 30 trials，hot 0.4，168 intents/rep，×5；core@0.1.2）**

| 情境 | wall ATM/ctrl ms | slowdown | overhead mean/p95 (ms) | goodput ATM/ctrl |
|---|---|---|---|---|
| paced ×5 | 1560.05／1516.23 | **1.03×** | 5.21／7.14 | 103.08／71.1（1.45×） |
| unpaced ×5 | 747.27／81.73 | 9.14× | 4.29／6.03 | 216.7／1493.43（0.15×） |

paced 拆解：latency_ms 2.92（p95 4.34）、apply_ms 2.2（p95 3.55）；reject 最便宜（latency p50 0.83 ms）；冷熱 overhead p50 相近（cold 5.18／hot 5.13 ms）。COMPARE_SMALL 單 rep：ATM 0 lost／95.8% 成功 vs control 60 lost／64.3%，racy overwrite 0 vs 63。

**表 5（🟢，T9）Scale prelude（8 agents；core@0.1.2）**

| 情境 | 臂 | wall（vs ctrl） | goodput pass/s | 成功率 | lost |
|---|---|---|---|---|---|
| S1 200t | ATM sp ×2 | 1.003× | 134.7（1.61×） | 93.3% | 0（ctrl 42.1%） |
| S1 | ATM 8 procs ×2 | 1.008× | 132.2（1.58×） | 92.0% | 0 |
| S3 1000t（7244 intents） | ATM sp | **1.001×** | 133.9（1.58×） | 92.5% | 0（ctrl 41.5%） |
| S3 | ATM 8 procs | 1.001× | 132.6（1.57×） | 91.6% | 0 |
| S4 unpaced | ATM sp／8 procs | 11.6×／9.8× | 224／259 | 94.8%／92.5% | 0 |

**解讀**：在有思考時間的節奏下（paced），ATM 幾乎不拖慢整體（1.001–1.03×），每筆成本約 5 ms，S3 的 50 秒長跑 overhead p50 維持在 4.75–5.01 ms，無退化。unpaced 的 9.14×／11.6× 是無思考時間的**最壞上界**（🟡），反映的是單 JSON registry＋fail-fast lock 的序列化瓶頸（上限約 236/s sp、約 280/s 8 procs），與 v1 §6.2 預告的單 broker 吞吐瓶頸一致。

**與 v1 OperationalBench 的關係**：v1 報告 broker 決策 P95 約 0.024–0.025 ms（in-process decision span）。本文的約 5 ms 包含 registry 檔案 I/O 與 apply（broker_ms ≈ 2.5–2.7 ms、apply_ms ≈ 2.3–2.4 ms；T4），兩者量測邊界不同，**不可直接比較**；正式稿需並列定義。

### 5.4 RQ4：多 process 共用 registry

**表 6（🟢，T8）多 process（core@0.1.2）**

| 情境／臂 | wall ms | lost/rep | rejects/rep | overhead mean/p95 | registry 殘留 |
|---|---|---|---|---|---|
| A control 6 procs | 1516.2 | 60.0（35.7%） | 0 | 0.45/0.64 | — |
| A ATM sp | 1538.6 | 0 | 7.7 | 4.98/6.62 | — |
| A ATM 6 procs（CAS） | 1549.5 | **0** | 7.3 | 9.35/19.69 | 0 |
| B control 8 procs | 2024.1 | 201（71.3%） | 0 | 0.44/0.62 | — |
| B ATM 8 procs（CAS） | 2039.0 | **0** | 79 | 8.69/21.63 | 0,0,0 |
| ⚠ B naive registry 8 procs | 2132.1 | 0 | 86.3 | 14.6/36.3 | **37, 26, 32** |
| ⚠ B apply-lock off 8 procs | 2040.2 | **2（1.0%）** | 79.3 | 8.68/21.3 | 0,0,0 |

在 4／6／8 個 process 下，CAS 協定維持 0 lost、0 registry 殘留、0 crash，代價是 overhead 約 2×（4.98 → 9.35 ms）。A 情境 6 procs 每 rep 有 328.7 筆 registry 交易，其中 47% 至少重試一次，單筆最多重試 14 次。

**負面對照**說明兩個協定缺一不可：拿掉 CAS（naive registry）會留下殭屍 lease（每 rep 37／26／32 筆），持續阻擋後續 intent；保留 CAS 但關掉 apply 互斥，會出現 1.0% lost，且全部來自跨 process 的 composer_merge。這是 v1 §3.5 第 6 層「CAS base-hash」在多 process 實作上的具體化，也是 v1 未量測的部分。

---

## 6. 討論與限制

### 6.1 「0 lost」的真正意義（最重要的降調）

本文所有「0 lost update」都必須與兩個前提**一起**閱讀：

1. **sync writer 假設**：harness writer 以同步 read-modify-write 模擬理想的 composer／rebase；
2. **未跑真 composer apply**：harness 沒有驅動 `composeBrokerProposals`／steward 在真 patch 上套用。

在無 composer apply 的 stale 對照中，熱檔 lost 率為 55–65%，與 control 相當。因此正確的說法是：「在理想 composer apply 下，ATM 准入使 lost update 為 0；無 composer apply 時為 55–65%」。ATM 准入負責把衝突**路由**到正確的地方，不等於自身保證不丟更新。這與 v1 §3.7「正向准入裁決不代表全域語意獨立」的自我限定一致。

### 6.2 已知機制缺口

- **冷檔排隊為 partial**：未呼叫 `enqueueSerialIntent`／resume，未觀測 ticket 序號，FIFO 僅與時間序弱相關；不能主張耐久 FIFO ticket 已驗證。這也意味著 v1 §3.7 第 4 點（liveness／starvation 需正式證明）仍然成立——Oct 6 overlay 的 thundering herd（queue_rounds 平均 2.4／3.3／14.6）提醒我們，沒有耐久 ticket 時公平性無從保證。
- **熱檔無 park／rearbitrate**：core 訊息寫「park」但直接 reject；harness 的 `--hot-retry loop` 只是替代方案，且在 S2 長跑中 schedule_lag p95 從 322 ms 升到 1215 ms，是 unbounded backlog 的前兆。這與 v1 §3.5 把「Late-joiner park and re-arbitration」列為已有實作與驗證支持的一組**存在落差**：可能是版本差異（v1 錨點 v0.9.0-alpha.1 vs 本文 v0.1.17），也可能是 v1 所指路徑（例如 governed transaction／team broker）與本 harness 呼叫的 API 不同〔待補全文對照，需作者確認〕。正式稿必須先釐清，才能決定是「v2 發現的回歸」還是「harness 未走到該路徑」。
- **規模瓶頸**：單 JSON registry＋fail-fast lock、無 stale-lock 回收；unpaced 上限約 236/s（sp）、約 280/s（8 procs）；S4 8 procs 有 80% 的交易需重試，單筆最多 72 次。

### 6.3 外部效度威脅

- 除 mp 臂外，agents 為單 process 內的 async worker，共用 event loop；ATM 的同步 fs I/O 會拖慢其他 agent。
- hold 為模擬（20–60 ms），不是真 LLM 的秒級思考；絕對等待應隨 hold 等比放大（等待 ≈ queue depth × hold），比例大致不變——此為推論，**未實測**。
- 單一 fixture、單機；跨機 registry 未測（符合 v1 單域定位，但也限制了外推）。
- rep 數有限：多數臂 ×3，單檔與 S2–S4 ×1、S1 ×2；未報告信賴區間。
- 版本混淆：tag v0.1.17 而 package.json 顯示 0.1.2；v1 錨點為 v0.9.0-alpha.1。T6–T9 多數在 core@0.1.2（Oct 6）上量測，只有 T1–T3、T5、T6 的 v0.1.17 欄為新版本數字。

### 6.4 與 Claim Plane 的關係再陳述

v2 的實驗刻意包含最壞情況（單檔 13.32×、unpaced 9–12×）與負面對照（stale、naive、apply-lock off）。我們的主張是：ATM 的 broker 層提供了 hot/cold 分級、composer 路由、CAS／queue 等更完整的寫入前機制；Claim Plane 的「宣告但不取得寫入權限」是 ATM 可吸收的窄路徑。關於 Claim Plane 樣本規模、是否報告負面效能及公開時序的比較，均〔待核對 arXiv 原文〕。

---

## 7. 結論與未來工作

### 7.1 結論

ATM v1 主張「寫入前准入應被視為獨立的一級治理問題」（v1 §7）。本文沿著這條主張往下走一步：把 v1 承諾的 SERIAL／queue 後續路徑與只被順帶提及的熱檔路徑，落實為 ATM v0.1.17 中可指認的機制，並以可重現 harness 量出其價格。結果是一個清楚的 trade-off：冷檔原生排隊把 86–93% 的遺失更新壓到 0（在理想 composer apply 下），代價是 2–3× 的 wall time，最壞 13×；熱檔 proposal-first 准入幾乎不增加 wall time，但缺少 park 協定，使 17–24% 的 intent 被原生拒絕。跨 process 時，CAS 與 apply 互斥都是必要協定。這些結果支持「已實作機制可運作且代價可預期」，**不**支持「ATM 原生即保證無遺失更新」或「耐久 FIFO 已驗證」。

### 7.2 未來工作（依投稿影響排序）

1. **真 composer apply**（P1）：以 `composeBrokerProposals`／steward 在真 patch 上取代 sync writer，這是 C3 正確性主張的最大前提。
2. **耐久 serial ticket 端到端**（P1）：`enqueueSerialIntent`＋eligible resume＋官方 position，將 #180 由 partial 推進到 full，並為 liveness／公平性提供觀測基礎。
3. **熱檔 park／rearbitrate**（P2，僅設計）：core 層實作 late-joiner park 協定，取代 harness overlay；需先釐清與 v1 §3.5 的落差。
4. **經驗驅動熱度 FileHeat／EMA（#184，僅設計、未 merge）**：以連續 `heat ∈ [0,1]` 取代靜態 basename 集合，依 repo 自身的衝突、compose 成功率與等待時間做 EMA 升降溫；權重只調整「走哪條安全 lane」的偏好，不放寬 true-conflict／CAS（`HEAT_WEIGHT_OPTIMIZATION.md`）。預計三臂評估：static／learned_frozen／online。
5. **Derived Atoms bench 臂**（P2）：同檔不同 atom 的並行度、wait、lost，以及與 region identity 臂的對照、claim 延遲；並補上 Draft v0.4 文件。
6. **外部效度**（P2）：真 LLM／秒級 hold、≥2 家 vendor 並行（PLAN_SPEC 原目標；目前 `tick` 外部介面仍是 stub）。
7. **統計與穩健性**（P3）：信賴區間、更多 reps；16 agents × 1000 trials 多 process；kill-9 後的 stale-lock 回收；跨機 registry。

---

## 附錄 A：Artifact 與重現

- ATM：tag v0.1.17，commit `8dd6a1c6`（`/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`）；Oct 6 baseline HEAD `ed317820`。
- 主實驗：`runs/v017-q180-{control,native,nqwait}-a{8,16}-r{1,2,3}`、`runs/v017-q180-1f-*`；彙整 `runs/v017-q180/summary.{json,md}`；腳本 `run_q180.sh`、`analyze_q180.mjs`。
- 其他：`runs/v017/`（V017 冷熱）、`runs/cold-queue/`、`runs/hot-file/`、`runs/compare/`、`runs/multiprocess/`、`runs/scale/`、`runs/smoke-seed42/`。
- 本文未修改 ATM monorepo，未 push／publish，未開 issue。

## 附錄 B：本稿刻意降調處一覽

| 處 | 降調方式 |
|---|---|
| 0 lost | 一律綁 sync writer＋未跑真 composer apply；並列 stale 55–65% |
| #180 | partial pass；不主張耐久 FIFO ticket；`queue_position` 非 FIFO 序號 |
| 熱檔 100% | 歸功 harness overlay；原生 reject 17–24% |
| Claim Plane 對照 | 6-pair、未報 worse-than-expected、~25 天：皆〔待核對 arXiv 原文〕 |
| v1 park 主張 vs v0.1.17 觀察 | 標為待釐清落差，不定性為回歸 |
| Derived Atoms | 僅設計＋測試 pass；VAI 檔 v0.3 vs 鎖定 v0.4 衝突已註 |
| 成本比較 | v1 0.024 ms decision span vs v2 ~5 ms 含 I/O＋apply，不直接比 |

---

## 參考文獻

[1] Eagl Huang. *ATM: CID-Brokered Pre-Write Admission for Multi-Agent Code Co-Synthesis — A Specification-Grounded Governance Substrate for Software Agents*. arXiv:2607.00041v1 [cs.SE], 2026-06-29.（本稿已讀全文 `refs/arxiv-2607.00041.txt`；引用段落：摘要、§1.1、§1.3、§1.4、§3.2、§3.4、§3.5、§3.7、§4.5、§5.1–5.2、§6.1–6.2、§6.4、§7；逐頁頁碼〔待補全文對照〕）
[2] Claim Plane. arXiv:2607.21909（作者、標題、日期〔待核對原文〕；PLAN_SPEC 另列 arXiv:2608.00947，關係〔待核對原文〕）。
[3] AI-Atomic-Framework repository, tag v0.1.17, commit `8dd6a1c6`. https://github.com/eaglhuang/AI-Atomic-Framework
[4] ATM v1 所引相鄰工作（CodeCRDT arXiv:2510.18893、CoAgent、S-Bus、CodeTeam、ATCC、AgenticFlict、Cordon、Atomix、CRDT [Shapiro et al. 2011] 等）：本稿僅轉述 v1 的定位，完整書目沿用 v1 參考文獻表〔待補全文對照〕。
[5] Semantic Transactions／Cordon 綜述、ATP／Mnemosyne：僅依 PLAN_SPEC §5 一行描述，〔待核對原文〕。

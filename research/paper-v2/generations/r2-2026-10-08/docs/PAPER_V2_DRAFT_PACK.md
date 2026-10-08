# PAPER_V2_DRAFT_PACK — ATM 論文 v2.0 寫稿總包（討論結論＋實驗數據）

| 欄位 | 內容 |
|------|------|
| 版本 | Pack v1（2026-10-07 Asia/Taipei 彙整） |
| 對象 | 文一；之後「一起撰寫論文草稿」時的唯一起點 |
| 數據截止 | #180／q180 matrix（2026-10-07 11:35:49 CST）為最新；其後無新 run |
| 關鍵表 | [PAPER_V2_KEY_TABLES.md](./PAPER_V2_KEY_TABLES.md)（T1–T11，含來源路徑與 run-id） |
| 索引 | [PAPER_V2_DRAFT_PACK_INDEX.md](./PAPER_V2_DRAFT_PACK_INDEX.md) |
| 範圍限制 | 本包只彙整；未改 ATM monorepo、未 push、未 publish、未開 issue、未用 CloudAgent |

---

## 1. 文件目的與使用方式

1. **寫稿時先看 §2（貢獻）＋§8（缺口）決定主張強度**，再到 §6／KEY_TABLES 抓數字。
2. 每個數字都有來源檔；引用前看標籤：🟢 論文可用／🟡 有 caveat（輔助、附錄、動機）／🔴 勿用於主張。
3. 「已鎖定結論」（§2.0、§3、§4、§5.4、§7.2）來自 2026-10-06／07 的討論共識；**這些是對話記憶，不是本包從檔案驗證的事實**——凡涉及外部論文（Claim Plane 內容、公開日期差 ~25 天）的說法，正文引用前需回頭核對原文（見 §8 R4）。
4. 缺數據處一律寫「來源未提供」；寫稿時不得自行補數。
5. 本包**不含**論文正文；§9 只給大綱與對應表。

---

## 2. 論文定位與貢獻候選清單

### 2.0 已鎖定結論：論文定位（鎖定 2026-10-06／07）

| # | 結論 |
|---|------|
| L-P1 | ATM 原文（arXiv:2607.00041）對**已實作機制**描述不足，使 Claim Plane（arXiv:2607.21909）等可宣稱相近貢獻；v2 應把已實作機制寫成**明確貢獻**，並以 **frozen tag（v0.1.17）＋可重現證據（atm-bench、seed、run-id）** 支撐。 |
| L-P2 | v2 是 **systems-implementation／深化論文**，不是全新理論領域。主軸深化 **hot/cold-file admission** 與 **cold-file queuing**；**不**進入 ChangeIntent 時序辯論。 |
| L-P3 | ATM WriteIntent／broker admission 公開早於 Claim Plane 約 **25 天**；兩者**互補而非替代**。（具體日期來源未提供於本 box 檔案，寫稿前需核對 arXiv 版本日期。） |
| L-P4 | 支撐文件：`PLAN_SPEC.md` §1.1：「ATM 第二篇需要的不是再發明『時序權威／ChangeIntent JIT』」；§5：「ATM v2 論文貢獻縫：分級准入已落地＋冷檔排隊＋大量可重跑實證」。 |

### 2.1 貢獻候選（C1…）× 證據等級

| ID | 貢獻候選 | 證據等級 | 主要證據 |
|----|----------|----------|----------|
| **C1** | **分級（hot/cold）pre-write admission 已落地**：proposal-first 熱檔（provisional-write-lease、composer-routed、true-conflict）＋冷檔直通／排隊；以真 ATM broker API（`calculateBrokerDecision`、`evaluateBrokerAdmission`、`registerIntent/releaseTask`）驅動 | 🟢 實作＋實驗 | T6、T7、COMPARE_SMALL disposition 直方圖 |
| **C2** | **冷檔原生 serial queue（#180）**：v0.1.17 對同 atom（region identity）回 `disposition=queue`（lane=serial）；harness 等待後 wait 可量、0 lost | 🟢（partial pass） | T1–T3；T5 first disposition 變化 |
| **C3** | **正確性 vs 成本 trade-off 的定量刻畫**：ATM 0 lost vs control 86–93% lost（冷）／71.5%（熱）；代價：冷 nqwait 2.05×（a8）／3.11×（a16）／13.32×（一檔），熱 native 1.01–1.02× | 🟢（需帶 sync writer caveat） | T1、T2、T6 |
| **C4** | **ATM 每筆准入成本小且穩定**：~5 ms/intent（sp）、~8–10 ms（mp）；paced wall 1.001–1.03×；長跑 7244 intents 無退化 | 🟢 | T7、T9 |
| **C5** | **跨 process 共用 registry 的必要協定**：CAS（`read`→`write({base,next})`＋caller re-ask）與 apply 互斥；負面對照：naive registry 殭屍 lease 26–37/rep、apply-lock off 1.0% lost | 🟢 | T8 |
| **C6** | **可重現 conflict harness（atm-bench）**：seeded scenario、ground-truth 標籤、事件 JSONL、匯出腳本、mock/real/control 三後端 | 🟢（工具貢獻） | SMOKE_RESULT（hash 可重現）、README、各 run_matrix.sh |
| **C7** | **Derived Atoms／同檔隔離**：CID v2（無行號）、claim 時當場推導、occupy-both、stale→file-level；同檔不同 atom 可並行、重疊 atom 於 commit 被拒 | 🟡 測試通過、無性能數據 | T11；§7 |
| **C8** | **經驗驅動 FileHeat／EMA heat-weight（#184）** | 🔴 **僅設計、未 merge**，不得寫成已完成 | `HEAT_WEIGHT_OPTIMIZATION.md` |
| **C9** | **熱檔 park／rearbitrate** | 🔴 core 未完成（訊息寫 park 但直接 reject）；只有 harness overlay | T6 caveat；REMAINING_TESTS |
| C10 | 規模瓶頸的誠實揭露（單 JSON registry＋fail-fast lock；unpaced 上限 ~236/s sp、~280/s 8 procs；hot loop backlog） | 🟢（作為 limitation／future work） | T9、MULTIPROCESS §3 |

建議主貢獻：**C1＋C2＋C3＋C6**；C4／C5 為系統深度支撐；C7 視 §7 判斷放 section 或 future work；C8／C9 只能放 Future Work／Design。

---

## 3. 與相關工作對照（已鎖定結論，2026-10-06／07）

### 3.1 ATM vs Claim Plane（鎖定對比）

| 面向 | Claim Plane（arXiv:2607.21909；PLAN_SPEC 另列 2608.00947） | ATM（v1 arXiv:2607.00041 ＋ v0.1.17 實作） |
|------|------|------|
| 核心模型 | declared resource/region authority overlap | proposal-first／hot-cold 分級准入 |
| 佔位語意 | contingent → JIT promote → re-admit；**contingent 預設無 write authority** | `registerIntent` 後 write surface 即佔 `activeIntents`（寫入 resourceKeys） |
| 熱檔／重疊 | JIT 升格 | provisional-write-lease、composer＋steward、CAS／queue／rearbitration |
| 決策覆蓋 | 來源未提供細節 | `calculateBrokerDecision` 已處理 CID／shared surface／read↔write／file-range（決策順序：shared surface → CID/atomId 衝突 → proposal overlap → physical overlap → parallel-safe；`COLD_QUEUE_LATENCY.md` §1） |
| 實驗 | 未報告 worse-than-expected 性能數據；樣本規模小（約 6-pair） | atm-bench：數千筆 intents／臂，含負面對照與最壞情況（T1–T9） |
| 公開時序 | — | WriteIntent／broker admission 公開早約 25 天（L-P3） |

鎖定判讀：
- **ATM「延後佔位」≠ Claim Plane JIT**：ATM 在 hot overlap-risk 時延後 *full write-admitted*，但 register 時**仍寫入 resourceKeys**；Claim Plane contingent 預設**無** write authority。
- 文一的立場：**ATM broker 層比 Claim Plane 論文層更完整**；Claim Plane JIT 是 ATM **缺少的一條窄路徑**（declare may-touch without write authority）→ 寫成 related work 中「互補／可吸收的窄路徑」，不寫成 ATM 要追隨的方向（亦見 `PLAN_SPEC.md` §1.2「明確不做／不學」、§4.3「不做與 Claim Plane 同表硬比 JIT」）。

### 3.2 其他

| 系統 | 關係 | 來源 |
|------|------|------|
| ATM v1（arXiv:2607.00041） | 已提出 CID broker、atom／virtual atom、七層閘門等 pre-write admission；v2 補「已落地機制＋實證」 | `PLAN_SPEC.md` §1.1 |
| Cordon／Semantic Transactions 綜述 | OS／effect outbox；文中已引 ATM 管 repo 共寫；**互補層**，harness 不管外部支付／網路出盒 | `PLAN_SPEC.md` §5（僅此一行，細節來源未提供） |
| ATP／Mnemosyne | Proposal Non-Authority；非本實驗範圍 | `PLAN_SPEC.md` §5 |

---

## 4. 系統機制要點（Related／System 段可用的 locked facts）

### 4.1 Broker 與 admission（程式碼層事實）

- 真 ATM 被呼叫的 API：`packages/core/src/broker/decision.ts#calculateBrokerDecision`、`…/admission/evaluate-broker-admission.ts#evaluateBrokerAdmission`、`…/broker/registry.ts#registerIntent|releaseTask|saveRegistry`（`COMPARE_SMALL.md`、`README.md`）。
- disposition → harness decision：`direct→admit`、`proposal-required→hot_provisional`、`compose→composer_merge`、`queue→cold_queue`、`true-conflict→reject`（`README.md`）。
- 熱檔判定現況：靜態 `HOT_FILE_BASENAMES = {tasks.ts, next.ts, evidence.ts, hook.ts, team.ts, broker.ts}`（`packages/core/src/broker/team-lane.ts`；`HEAT_WEIGHT_OPTIMIZATION.md`）。
- 熱檔 disposition 細節（`HOT_FILE_LATENCY.md` §1）：無其他 writer → `provisional-write-lease`；同檔已有非 provisional holder（**包含同 region**）→ `composer-routed`；同 region 撞 provisional holder → `true-conflict`／`blocked-active-lease`（訊息「should be parked for rearbitration」但**無 park 協定**）。
- v0.1.17：樹內有 `packages/core/src/broker/decision/serial.ts` 與 `serial-queue/`；#180 issue closed（2026-10-07 00:43 CST；原記錄為 2026-10-06 16:43 UTC）（`V017_HOT_COLD.md`）。
- Write Broker **不是常駐 daemon**：on-demand CLI＋檔案型 registry（`.atm/runtime/write-broker.registry.json`）＋CAS write-lock；`atm daemon` 為 advisory-only（`BROKER_HARD_GATE_AUDIT.md`）。
- Registry store：`createBrokerRegistryStore(path).read()/write({base,next})`；衝突丟 `ATM_BROKER_REGISTRY_CAS_CONFLICT`；`.write-lock` fail-fast（`openSync(…,'wx')`），無等待／無 stale-lock 回收（`MULTIPROCESS_SMALL.md`）。

### 4.2 已鎖定的機制敘事（2026-10-06／07）

- ATM：proposal-first／hot-cold；`registerIntent` 後 write surface 佔 activeIntents；provisional-write-lease、composer+steward、CAS／queue／rearbitration。
- 「延後佔位」≠ JIT（見 §3.1）。
- **同檔隔離**：ATM §1.2 反對強制全 AST，偏好 **adapter-guided atomization**；**非「放棄 AST」**。寫稿措辭需避免「ATM 不用 AST」。

### 4.3 寫進 System 段時的硬限制

| 不可寫成已完成 | 理由 |
|---|---|
| 熱檔 park／rearbitrate | core 訊息寫 park 但直接 reject；harness `--hot-retry loop` 是 workaround |
| 原生耐久 FIFO ticket | harness 未呼叫 `enqueueSerialIntent`／resume |
| composer apply 正確性 | harness 未驅動 `composeBrokerProposals`／steward apply；0 lost 綁 sync writer |
| FileHeat／EMA（#184） | 未 merge |

---

## 5. 實驗設置

### 5.1 Harness 與環境

| 項目 | 值 | 來源 |
|------|----|------|
| Harness | atm-bench `0.3.0-latency`（`/workspace/reports/atm-v2-harness`） | README |
| ATM（最新） | GitHub tag **v0.1.17** → commit `8dd6a1c6`（訊息「derived atoms…」）；`ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17` | V017_HOT_COLD |
| 套件版本陷阱 | `packages/*/package.json` 仍寫 0.1.2；**以 tag v0.1.17 為準**；論文需註明 | V017_HOT_COLD |
| ATM（Oct 6 baseline） | `@ai-atomic-framework/core@0.1.2`，`/workspace/AI-Atomic-Framework` HEAD `ed317820`（尚無 `decision/serial.ts`） | V017_HOT_COLD |
| Node | v24.21.0（nvm；real 後端需 ≥22 strip-types） | 各報告 |
| 機器 | 單一 box，8 vCPU／16 GB（跑時可用 ~3 GB） | SCALE_PRELUDE |
| Fixture | `atm-bench-fixture-v1-ts`（TypeScript mini-app，hot/cold 檔＋region markers） | COMPARE_SMALL、README |
| Oracle | committed intent 的 marker 必須留在最終 worktree（否則 = lost update） | README |
| 計時 | `performance.now()`；百分位 nearest-rank | COMPARE_LATENCY |

### 5.2 Seed／參數

- 全部 `seed=42`；同 seed → 同 scenario hash（small：`80d54e045f6d9c41…`；smoke：`c05b6019aae3f13a…`）。
- 時序非決定：同 seed 決策直方圖略浮動（COMPARE_LATENCY Gaps #6）→ 論文需寫「scenario 確定、admission 交錯非 bit-identical」。
- hold 20–60 ms、tick 50 ms、jitter 15 ms（paced）；unpaced = 0/0/0。

### 5.3 Arms 定義

| arm | 意義 |
|-----|------|
| control | 無 ATM；讀 base → hold → 整檔寫回（last-writer-wins） |
| native | 真 ATM 原生行為（熱：true-conflict→reject；冷：`--cold-retry once`） |
| nqwait | 冷檔 `--cold-retry native-queue`：等 `queue`∣`true-conflict` 直到 grant/timeout（**#180 主臂**） |
| loop | 冷：只等 true-conflict（v0.1.17 下對 queue wait=0，**過期語意**）；熱：`--hot-retry loop` overlay |
| *stale | writer=stale：無 composer apply 的負面對照 |
| mock | MOCK broker（規格模型；不代表真 ATM） |
| mp-* | `run-mp`：每 agent 一個 OS process，共用 worktree＋registry（CAS／naive；apply-lock on/off） |

### 5.4 已鎖定的實驗方法共識（2026-10-06／07）

1. 需可重現 conflict harness（atm-bench）；已由 mock → real ATM v0.1.17。
2. **Oct 6／V017 主臂 `cold_retry=loop` 只等 true-conflict → wait_ms=0，不能當原生 queue cost。**
3. **論文冷檔排隊優先用 nqwait（`--cold-retry native-queue`）數字**；#180 判定 **partial pass**：能量到原生 queue wait；**未**驗證耐久 `enqueueSerialIntent`／嚴格 FIFO；0 lost 仍綁 sync writer。
4. #184 FileHeat／EMA heat-weight **未 merge，論文勿當已落地結果**。
5. 無 Cloud Agent、無 npm publish、無擅自 merge。

### 5.5 共通 caveats（Threats to Validity 素材）

- 單 process 共用 event loop（除 mp 臂）；ATM 同步 fs I/O 會拖慢其他 agent。
- hold 為模擬（非真 LLM 秒級）；絕對等待會隨 hold 等比放大（等待 ≈ queue depth × hold），比例大致不變（COLD_QUEUE §4 推論，未實測）。
- writer=sync ＝ 理想 composer；stale 對照 55–65% lost。
- rep 數：多數臂 ×3；1-file ×1；S1 ×2、S2–S4 ×1；未報告信賴區間（來源未提供）。
- 單一 fixture、單機；跨機 registry 未測。

---

## 6. 關鍵結果（摘要；完整表見 KEY_TABLES）

### 6.1 🟢 論文可用（主結果）

| # | 結果 | 數字 | 表／來源 |
|---|------|------|----------|
| R1 | 冷檔原生 queue 可量、正確 | nqwait a8：wall **2.05×**、waited 55.9%、wait p50/p95/max **62/259/350 ms**、lost **0**（control 379/441≈85.9%） | T1；`runs/v017-q180/summary.md` |
| R2 | 冷檔排隊成本隨競爭上升 | nqwait a16 **3.11×**（p95 343 ms）；一檔 a16 **13.32×**（p50 679 ms，queue_rounds mean 14.55） | T1、T2 |
| R3 | v0.1.17 冷檔決策改為原生 queue | nqwait first disposition：a8 queue 740/direct 583；a16 queue 1859/direct 778；1-file 878/879 | T3；T5（loop 臂 first=queue 1096/1323） |
| R4 | 熱檔准入每筆成本小 | native wall **1.01–1.02×**、overhead ~4–5 ms；reject 17–24%；loop overlay 0 reject、100%、wall 1.10–1.15× | T6 |
| R5 | ATM 每筆成本 ~5 ms，paced 下幾乎不拖慢 | paced ×5 wall **1.03×**、overhead 5.21/7.14 ms；S3 1000 trials wall **1.001×**、goodput 1.58×、0 lost | T7、T9 |
| R6 | multi-process 正確性保持（CAS） | 4/6/8 procs **0 lost、0 registry 殘留、0 crash**；overhead ~2×（4.98→9.35 ms） | T8 |
| R7 | 必要協定的負面對照 | naive registry：殭屍 lease 37/26/32 per rep；apply-lock off：**1.0% lost**（全為跨 process composer_merge） | T8 |
| R8 | 熱檔改版前後穩定 | v0.1.17 vs Oct 6：native reject 86.7 vs 84/rep、成功 75.5% vs 76.3%；loop 100% | T6 |

### 6.2 🟡 有 caveat（輔助、附錄、動機）

| 結果 | 為何降級 | 表 |
|------|----------|----|
| Oct 6 冷檔 overlay 2.03×／3.16×／13.2× | core@0.1.2 原生 queue 不可達，等待由 harness overlay 做；只能當「同量級」對照 | T4 |
| native（once）a8 1.42×、a16 1.94× | 只等一輪，非完整排隊；可當「原生 queue 存在且有成本」的下界 | T1 |
| unpaced 9.14×／11.6× | 最壞上界（無思考時間）；單 process 瓶頸 | T7、T9 |
| hot loop 100% 成功 | harness overlay；core 無 park | T6 |
| 所有「0 lost」 | sync writer；stale writer 55–65% lost | T6 |
| Mock smoke 數字 | mock broker，非 ATM | T10 |
| Derived Atoms 測試 | pass/fail，無性能數據 | T11 |

### 6.3 🔴 勿用於主張

- V017 cold 主臂（region＋loop）的 wall／wait：a8 1.12×、a16 2.19×、1-file 2.43×、wait=0 —— harness 語意過期（T5）。
- legacy（unique atomId）冷檔 0 wait／compose 數字 —— 舊路徑、artefact（T4 註、T5）。
- capability 字串 `native_queue_reachable:false`（V017 時為過期註解）。
- 熱檔 `queue_position`、nqwait 的 `queue_position`（常數 1）當成 FIFO 序號。

---

## 7. Derived Atoms／VAI 狀態

### 7.1 檔案中的狀態

- `VIRTUAL_ATOM_INDEX_ANALYSIS.md`（2026-10-06）：主張以既有 `AtomCandidate`→確定性 `atomCid` 為主鍵的 VAI，而非旁掛 `.atm` 或 path 鏡像 Shadow Atlas；缺口是「發現了候選卻沒有預設持久化進 claim／compose 路徑」。
- `VAI_COMMIT_ATLAS_PLAN.md`：**檔內版本為 Draft v0.3**（2026-10-07），計畫代號 `ATM-DERIVED`；「認領時當場算，不預存全庫地圖」；三分名詞：正式原子／推導原子／`VirtualAtomInUse`；已鎖定：正式邊界優先、比對鍵＝先佔者 atomCid/range、快取非 SSOT、import 前導區共享、stale 認領預設 B（降為檔案級）。
  - ⚠ 檔內 CID v2 公式仍含 `detectionMethod`；與下方 v0.4 共識（無 detectionMethod）**不一致**——寫稿以 v0.4 共識為準，但需把 v0.4 文件化（來源未提供 v0.4 檔案）。

### 7.2 已鎖定：Draft v0.4 方向（2026-10-07，對話共識）

1. **two-stage claim reservation**：claim 時 optional `--atoms` 預約＋**commit-time diff confirmation**。
2. **CID v2**：無 `detectionMethod`、無 compat flags。
3. **occupy-both**（正式＋推導同時佔用）。
4. **stale → file-level**。
5. **VirtualAtomInUse 作為 derive/CID 層**，而非重複衝突計算。
6. 兩段式 occupancy 測試在 tag v0.1.17 **通過**；npm **尚未 publish**。

### 7.3 測試證據（T11）

candidate-bridge 9 項全過（含 `cid.v2 identity is independent of line numbers`、`cold CID conflict scenario reaches native serial admission`）；`derived atom identity (overload merge, ordinals, content version)`、`derived atom occupancy rules (confirmation, preamble, conflicts, drift)`、`same-file different-atom tasks run in parallel; overlapping atoms are refused at commit` 皆 ok。

### 7.4 是否夠寫成獨立 section？

**判斷：夠寫「設計＋功能正確性」小節（System 之下 §x.y 或 Discussion），不夠寫「實驗結果」section。** 缺：bench 的 derived-atoms 臂（同檔不同 atom 的並行度／wait／lost 數字）、與 region identity 臂的對照、claim 延遲。建議措辭：「implemented in v0.1.17 and covered by tests; quantitative evaluation is future work」。

---

## 8. 缺口與風險（對寫稿）

### 8.1 需降調的主張

| ID | 風險 | 降調寫法 |
|----|------|----------|
| R1 | 「0 lost update」被讀成 ATM 保證 | 「在理想 composer apply（sync writer）下 0 lost；無 composer apply 時 55–65% lost」→ 必須同時報兩者 |
| R2 | 「原生 FIFO serial queue」 | 「ATM 回原生 `queue` 決策；在 harness 等待 blocker＋re-eval 下量到成本」；**不**說 durable ticket／FIFO |
| R3 | 熱檔 100% 成功 | 歸功於 harness retry overlay；core 原生 reject 17–24% |
| R4 | Claim Plane 對比內容（約 6-pair、未報 worse-than-expected、~25 天）| 來自對話記憶，本 box 無原文檔案 → 寫前逐條對 arXiv 原文核對並附頁碼 |
| R5 | 版本混淆 | 統一寫「ATM v0.1.17 (tag, commit 8dd6a1c6)」，註明 package.json 仍顯示 0.1.2 |
| R6 | Oct 6 vs v0.1.17 比快慢 | 不同 `cold_retry` 語意不可比；只比 disposition 與正確性 |

### 8.2 仍缺的實驗（依寫稿影響排序）

| 優先 | 缺口 | 影響 |
|------|------|------|
| P1 | **真 composer apply**（`composeBrokerProposals`／steward 在真 patch 上） | C3 正確性主張的最大前提 |
| P1 | **耐久 serial ticket 端到端**（`enqueueSerialIntent`＋eligible resume＋官方 position） | C2 由 partial → full |
| P2 | 熱檔 park／rearbitrate（core） | C9；目前只能 future work |
| P2 | 真 LLM／秒級 hold、≥2 vendor 並行（PLAN_SPEC 原目標） | 外部效度；目前 `tick` 外部介面仍 stub |
| P2 | Derived Atoms bench 臂 | C7 能否成為實驗貢獻 |
| P3 | 信賴區間／更多 reps（1-file 與 S2–S4 僅 ×1） | 統計嚴謹 |
| P3 | 16 agents × 1000 trials mp、kill-9 lock 回收、跨機 registry | Scale／robustness |
| P3 | 同區 composer co-write 是設計還是 bug（需 ATM 確認） | 熱檔語意描述 |
| — | #184 heat-weight 實作＋三臂（static／learned_frozen／online） | 僅能寫 future work |

---

## 9. 建議論文章節大綱（僅大綱）

| 節 | 內容要點 | 對應本包 |
|----|----------|----------|
| 1 Introduction | 多 agent 共寫 repo 的 lost update 問題；v1 機制描述不足 → v2 以實作＋實證補強；貢獻列表 | §2.0、§2.1（C1–C6） |
| 2 Background & Related Work | ATM v1；Claim Plane（互補、JIT 窄路徑、延後佔位≠JIT）；Semantic Transactions／Cordon（互補層） | §3 |
| 3 System Design | Broker 決策順序、disposition、hot：provisional／composer／true-conflict；cold：serial queue；registry CAS；adapter-guided atomization | §4 |
| 3.x Derived Atoms（可選小節） | CID v2、two-stage reservation、occupy-both、stale→file-level；測試覆蓋 | §7、T11 |
| 4 Evaluation Methodology | atm-bench、seed、arms、oracle、版本 pin、caveats | §5、T10（管線可重現） |
| 5.1 RQ1 冷檔排隊 | 正確性×延遲；8→16→一檔 | T1、T2、T3；T4 作同量級對照 |
| 5.2 RQ2 熱檔准入 | native vs overlay vs stale | T6 |
| 5.3 RQ3 成本與規模 | per-intent 成本、paced/unpaced、長跑 | T7、T9 |
| 5.4 RQ4 multi-process | CAS 必要性、負面對照 | T8 |
| 6 Discussion & Limitations | sync writer、partial #180、無 park、單 JSON registry 瓶頸、模擬 hold | §6.2、§8 |
| 7 Future Work | durable FIFO、composer apply、park、#184 heat、derived-atoms bench | §8.2、C8 |
| Artifact Appendix | tag、run-id、重跑指令 | INDEX；各報告「重跑」段 |

---

## 10. 來源索引

| 路徑（相對 `/workspace/reports/atm-v2-harness/`） | 日期（CST） | 一句話 |
|------|------|------|
| `PAPER_V2_EXPERIMENT_NOTES.md` | 2026-10-07 11:36 | #180／q180 主數字、可／不可主張、partial pass 判定 |
| `runs/v017-q180/summary.{json,md}`、`analyze.out`、`run_q180.{sh,log}`、`analyze_q180.mjs` | 2026-10-07 11:33–11:35 | q180 彙整與腳本 |
| `V017_HOT_COLD.md`；`runs/v017/{cold,hot}_summary.{json,md}`、`overlap.{json,out}` | 2026-10-07 07:22–07:35 | v0.1.17 重測；loop wait=0 caveat；熱檔不變 |
| `COLD_QUEUE_LATENCY.md`；`runs/cold-queue/`；`runs/probe-cold/` | 2026-10-06 17:50–17:57 | core@0.1.2 冷檔 overlay 串行成本；原生 queue 不可達的程式碼調查 |
| `HOT_FILE_LATENCY.md`；`runs/hot-file/` | 2026-10-06 19:28–19:39 | 熱檔 native／loop／stale 對照 |
| `COMPARE_LATENCY.md`；`runs/compare/` | 2026-10-06 17:42 | per-intent 成本；paced/unpaced |
| `COMPARE_SMALL.md` | 2026-10-06 17:43 | 首個 real vs control 雙跑；disposition 直方圖 |
| `MULTIPROCESS_SMALL.md`；`runs/multiprocess/` | 2026-10-06 19:31–19:35 | 跨 process CAS、負面對照 |
| `SCALE_PRELUDE.md`；`runs/scale/` | 2026-10-06 19:33–19:39 | 200／1000 trials、unpaced 飽和 |
| `SMOKE_RESULT.md` | 2026-10-06 16:58 | mock 管線可行性與 hash 可重現 |
| `REMAINING_TESTS.md` | 2026-10-07 11:36 | 已完成／未完成清單 |
| `HEAT_WEIGHT_OPTIMIZATION.md` | 2026-10-06 22:42 | #184 FileHeat／EMA 方案（未實作） |
| `VAI_COMMIT_ATLAS_PLAN.md` | 2026-10-07 00:33 | Derived Atoms Draft v0.3（v0.4 方向見 §7.2） |
| `VIRTUAL_ATOM_INDEX_ANALYSIS.md` | 2026-10-06 23:46 | VAI vs Shadow Atlas 分析 |
| `derived-atoms-candidate-bridge-test.log`、`v017-candidate-bridge.log`、`v017-derived-atom-{identity,occupancy}.log`、`v017-derived-atoms-parallel.log` | 2026-10-07 06:57–06:58 | Derived Atoms 測試 ok |
| `v017-{cli-spawn,parallel-bootstrap,parallel-spawn-raw}-debug.log` | 2026-10-07 06:58 | 測試環境 debug 輸出（doctor／bootstrap ok；無數據） |
| `PLAN_SPEC.md`、`FUNCTIONAL_SPEC.md` | 2026-10-06 16:40／16:51 | harness 計畫與研究問題；相關工作邊界 |
| `BROKER_HARD_GATE_AUDIT.md` | 2026-10-07 00:09 | Broker 非常駐 daemon；on-demand＋CAS |
| `ATOM_BEHAVIOR_POLICE_SURVEY.md`、`ATOM_CREATE_MAP_REUSE_AUDIT.md` | 2026-10-07 00:02／2026-10-06 23:59 | Derived Atoms 背景稽核（本包未逐條引用） |

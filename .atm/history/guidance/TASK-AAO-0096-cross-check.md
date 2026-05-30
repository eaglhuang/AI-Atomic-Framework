# TASK-AAO-0096 LegacyRoutePlan tasks.ts 實戰校驗報告 (doc_other_1429)

本報告針對 AAF 核心指令模組 `tasks.ts` (5,305 行) 執行 `atm start --legacy-flow` 所產出的 `LegacyRoutePlan` 進行結構化交叉驗證，並以 `TASK-AAO-0095` (parse-options 拆分) 的實戰成果作為對照組，深入探討靜態分析工具的準確度、盲點與後續切片順序建議。

---

## 一、 Plan 摘要 (Summary of LegacyRoutePlan)

經過工具靜態分析，`tasks.ts` 原始碼的函數依賴關係與結構特徵如下：
* **safeFirstAtoms (葉子函數 / leafFunctions)** 數量：**37** 個
* **trunkFunctions (樹幹函數)** 數量：**64** 個
* **recommendedBehavior (推薦行為) 分布**：
  * `leave-in-place` (通常是 trunk)：**64** 個
  * `atomize` (通常是 leaf)：**37** 個
* **總計分析節點數**：101 個

分析結果顯示，工具在處理超大型原始碼檔案時，傾向採用較為保守的防禦性劃分。高達 63.3% 的函數被判定為 `trunk` 且推薦 `leave-in-place`，以避免貿然移動導致依賴崩塌；僅有 36.7% 的底層無狀態輔助函數被推薦為可直接 `atomize` 的 `safeFirstAtoms`。

---

## 二、 對 parse-options cluster (0095 已切) 的 plan 建議對照

針對 `TASK-AAO-0095` 中已安全切出的 13 個選項解析函數 (parse-options cluster)，我們透過 Git 歷史追蹤 (重構前 Commit `7516d26`) 取得工具當時對這些函數的建議數據：

| 函數名稱 (Symbol Name) | 角色 (Role) | 推薦行為 (Behavior) | fanOut (出度) | callerDemand (入度) | 是否為 safeFirstAtoms |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **parseReconcileOptions** | trunk | leave-in-place | 6 | 0 | 否 |
| **parseDeliverAndCloseOptions** | trunk | leave-in-place | 6 | 0 | 否 |
| **parseCreateOptions** | trunk | leave-in-place | 6 | 0 | 否 |
| **parseMirrorOptions** | trunk | leave-in-place | 7 | 0 | 否 |
| **parseCloseOptions** | trunk | leave-in-place | 10 | 0 | 否 |
| **parseResetOptions** | trunk | leave-in-place | 7 | 0 | 0 | 否 |
| **parseLockCleanupOptions** | trunk | leave-in-place | 6 | 0 | 否 |
| **parseClaimLifecycleOptions** | trunk | leave-in-place | 12 | 0 | 否 |
| **parseHistoricalDeliveryRefs** | trunk | leave-in-place | 5 | 0 | 否 |
| **parseScopeAddOptions** | trunk | leave-in-place | 9 | 0 | 否 |
| **parseQueueOptions** | trunk | leave-in-place | 6 | 0 | 否 |
| **parseAuditOptions** | trunk | leave-in-place | 5 | 0 | 否 |
| **parseLegacyLedgerMigrationOptions** | trunk | leave-in-place | 5 | 0 | 否 |

**分析對照結論**：
這 13 個函數**皆未**被標記為 `safeFirstAtoms`，且其 `recommendedBehavior` 均為保守的 `leave-in-place`。

---

## 三、 工具準確性評估 (Accuracy Assessment)

根據 `TASK-AAO-0095` 的實作結果，這 13 個選項解析函數在移出至 `task-option-parsers.ts` 後，整個 AAF 框架完美編譯且單元測試全數通過，證明該次切片是 **100% 安全且正確的**。

這說明**工具建議與實際最佳實踐「部分吻合 (或判定過於保守)」**。
* **吻合處**：工具精確識別出這些解析函數的 `fanOut` (均介於 5 至 12 之間)，反映出它們內部調用了多個輔助常式 (如 `requireValue`、`normalizeRelativePath` 等)，靜態依賴拓撲複雜度較高。
* **不吻合處 (保守偏誤)**：因為這 13 個函數的 `callerDemand` (入度) 皆為 0 (均只在 AAF CLI 各指令的進入點被調用，屬於進入點的私有輔助解析)，且它們的邏輯實質上是**無狀態的 (Pure/Stateless) 輔助解析**，完全符合「Leaf-Cluster」的拆分特徵。然而工具僅憑其 `fanOut > 4` 且依賴多個 Leaf 輔助函數，便一律將其歸類為 `trunk` / `leave-in-place`，忽略了其語意上的「拆分安全性」。

---

## 四、 對後續 wave 3-B 候選 cluster 的 plan 建議

針對後續 wave 3-B 規劃的潛在拆分候選 cluster，我們從當前的 `LegacyRoutePlan` 中篩選出核心函數的分析結果：

1. **Close Gates Cluster (關閉門檻驗證)**
   * `evaluateTaskDeliverableGate` — **role: trunk**, behavior: `leave-in-place`, fanOut: 19
   * 工具建議：應保留在原處。因涉及極為複雜的 Git 檔案比對與多個 `close-packet` / `evidence` 輔助工具的調用。
2. **File-IO Cluster (檔案與日誌讀寫)**
   * `listTaskFiles` — **role: trunk**, behavior: `leave-in-place`, fanOut: 10
   * `safeTaskFileReadDir` — **role: leaf**, behavior: `atomize`, fanOut: 2
   * 工具建議：底層 helper `safeTaskFileReadDir` 是極佳的 `safeFirstAtoms` 可直接移出；但涉及高層遞迴邏輯的 `listTaskFiles` 則應先保留。
3. **Output Cluster (輸出與報告整理)**
   * `writeLockCleanupReport` — **role: trunk**, behavior: `leave-in-place`, fanOut: 9
   * 工具建議：保留在原處，直到依賴的底層檔案寫入 Leaf Helper 均已先被抽離。

---

## 五、 建議的下波切片順序 (Proposed Slicing Sequence)

依據 `safeFirstAtoms` 分布與依賴關係拓撲，我們建議後續 wave 3 的切片順序如下：

1. **Step 1: Leaf Helper 批量抽離 (Wave 3-B)**
   * **對象**：`safeTaskFileReadDir`、`safeTaskFileStat`、`readJsonRecord`、`sha256`、`normalizeStringValue`。
   * **理由**：這些是 100% 被工具判定為 `safeFirstAtoms` 的無狀態純葉子函數，將它們批量抽離可立竿見影地降低 `tasks.ts` 的重複程式碼，且對高層 trunk 無任何不良依賴影響。
2. **Step 2: File-IO / Utility 模組化 (Wave 3-C)**
   * **對象**：`listTaskFiles`、`readLegacyLedgerTaskFiles` 等檔案讀寫 cluster。
   * **理由**：當 Step 1 的底層 helper 被抽離後，這些中層 trunk 的內部 `fanOut` 將被清空或大幅簡化，進而轉化為新的 safe atoms，利於二次切片。
3. **Step 3: Close Gates 獨立 (Wave 3-D)**
   * **對象**：`evaluateTaskDeliverableGate`、`evaluateFrameworkDeliveryWindow` 等。
   * **理由**：此類高風險、與 CLI 閉環高度綁定的驗證邏輯，應作為最後一波中層重構，以防範系統運作的臨界風險。

---

## 六、 工具盲點與限制觀察 (Tool Limitation Observations)

由本次 LegacyRoutePlan 實戰實踐，我們觀察到 ATM 靜態分析工具存在以下局限性：

1. **缺乏語意與無狀態性認知**
   * 工具僅根據靜態的 AST 調用關係 (Call Graph) 進行判斷。例如，選項解析函數雖然只調用了無狀態的 `requireValue`，但工具因為其出度 `fanOut` 較高，便死板地將其判定為 `trunk`。工具無法理解「雖然調用了許多輔助函數，但該函數本身是 Pure/Stateless，且僅在進入點被調用」的語意特徵。
2. **缺乏「相鄰節點 (Sibling Atoms)」的協同判斷**
   * 當一個 Cluster (如 parse-options) 中的 13 個函數具有高度相似的結構與調用關係時，工具是獨立評估每一個函數的，無法感知到「這是一個高度內聚的輔助模組 (Sub-command Option Parser Family)」，也無法主動給出「將此 13 個函數包裹為一個 option-parser 模組統一抽離」的宏觀重構建議。
3. **過度防禦 (Over-defensive) 的 trunk 標記**
   * 只要函數調用了其他非外部模組（如 AAF packages），或者 fanOut 超過特定門檻 (通常為 4~5)，工具便會將 recommendedBehavior 設定為 `leave-in-place`，使 AI 在缺少人工架構師介入時，容易陷入不敢對中底層邏輯進行大幅重構的困境。

# ATM 推導原子（Derived Atoms）— 完整計畫書

| 欄位 | 內容 |
|------|------|
| 文件狀態 | Draft v0.3 |
| 日期 | 2026-10-07（Asia/Taipei） |
| 產品 | ATM（AI-Atomic-Framework） |
| 計畫代號 | `ATM-DERIVED`（取代舊稱 ATM-VAI／Shadow Atlas） |
| 歷程 | v0.1 中央 atlas＋commit hook → v0.2 能重算的不 commit → **v0.3 認領時當場算，不預存全庫地圖** |
| 相關稽核 | `VIRTUAL_ATOM_INDEX_ANALYSIS.md`、`ATOM_CREATE_MAP_REUSE_AUDIT.md`、`ATOM_BEHAVIOR_POLICE_SURVEY.md`、`BROKER_HARD_GATE_AUDIT.md`；熱度另線（#184） |
| 相關 issue | #180／#181／#184（本計畫不依賴） |
| 本文件不涵蓋 | 物理 refactor 產品化、C#／Python enclose 完整規格、論文圖表、改名歷史進 commit（P-later） |

---

## 0. 一句話

認領當下對「這次要碰的檔案」算出 **推導原子**，與 **正式原子** 疊合後寫入佔用紀錄；**不常駐 Broker、不寫入攔截、不預設 commit atlas、不自動升格**。

---

## 1. 名詞（強制統一）

| 名稱 | 是什麼 | 不是什麼 |
|------|--------|----------|
| **正式原子** | registry 內原子（如 `atm create`／審核後誕生） | 推導結果 |
| **推導原子** | 從程式碼算出的候選（path＋symbol＋kind＋內容版本） | 「虛擬原子」；禁止再叫虛擬原子 |
| **VirtualAtomInUse** | 動態佔用投影：誰正在佔哪段／哪個 id（跟租約生滅） | 靜態地圖；**不是**推導原子倉庫 |

關係：認領時先算推導原子 → 疊合正式邊界 → 填入 WriteIntent／atomRefs → 佔用寫進 `VirtualAtomInUse`。前者是後者的**輸入**，不重複儲存真相。

---

## 2. 為何縮到 v0.3

推導原子由程式碼唯一決定 → 能重算就不該當 SSOT 進 git。

| 舊路徑（v0.1） | v0.3 |
|----------------|------|
| `.atm/atlas` 全庫地圖 | **不做**（預設） |
| commit hook 自動 refresh | **不做**（第一版） |
| close 硬閘查 atlas | **不做**（第一版） |
| 開發流全庫掃描 | **選用**（報告／警察） |

預設正確性：各任務在認領當下算好並記下佔用；後到任務比對**先佔者寫入的 atomCid／range**，不靠事先存好的全庫地圖。

---

## 3. 目標與非目標

### 3.1 目標（三步）

1. **修正原子 id（CID v2）**：去掉行號；處理同名符號（kind＋canonical path／enclosing scope）。
2. **認領時當場算推導原子**，與正式原子疊合，填進佔用紀錄；補 **import 前導區**、以及 **「修改既有原子」** 操作類型。
3. **正式原子漂移** → doctor／警察回報；不自動修。

### 3.2 非目標（第一版）

- 不常駐 Write Broker；不在 write／存檔攔截。
- 不預設寫入／commit `.atm/atlas`；不做 close 對 atlas 的硬閘。
- 不自動把推導原子轉成正式原子。
- 不把推導結果當成第二套 registry。
- 不綁 cold queue／hot park／heat（#180／#181／#184）。
- 不用 shadow／「虛擬原子」命名靜態地圖。

### 3.3 成功標準

| 步驟 | 可驗證 |
|------|--------|
| 1 | 插入空行 CID 不變；改符號／路徑 CID 變；同檔同名（不同 kind／scope）CID 不撞；改體只動 contentVersion |
| 2 | 認領觸及檔：discover → 疊合 → atomRefs／佔用；兩 task 同檔不同符號可走既有 compose／parallel-safe；同符號衝突 |
| 3 | 正式邊界對不上碼 → stale；doctor／警察可見；認領遇 stale 行為符合鎖定規則（見 §5） |

---

## 4. 正式 vs 推導：儲存與判讀

### 4.1 儲存

- 推導原子**沒有寫入權**（不進 registry）。
- 可選**本機／行程快取**：鍵＝檔案內容雜湊；刪了不影響正確性；**不得**當跨進程 shared SSOT。

### 4.2 疊合規則（已鎖定）

| 情況 | 規則 |
|------|------|
| 範圍重疊 | **正式邊界優先**；落在正式範圍內的部分歸正式原子，**不另發推導 id** |
| 推導跨兩個正式原子 | 拆成兩段各歸正式；中間未登記區標為未登記區或降為**檔案級 claim**（實作選一種寫死，禁止 silently 吞掉） |
| 漂移 | 正式記錄位置對不上程式 → **stale**；doctor／警察回報；**不自動修** |

### 4.3 升格（永遠不自動）

只走既有關卡：`atm create` 或 `behavior.atomize` 提案 → 審核。觸發提案的典型來源：

- 使用者選擇重構；
- 警察 finding（例如同一推導原子反覆被認領／高變動）建議升格；
- 拆分大檔時順便升格。

---

## 5. 認領時當場算（核心流程）

```
claim(targetFiles, opType, …)
  → 對 touched 檔：快取命中？否則 discover（regex／既有 JS/TS 路徑）
  → CID v2 + contentVersion（可選寫入本次 intent，不寫全庫）
  → 載入正式原子邊界；套用 §4.2 疊合
  → 組裝 atomRefs（正式 id 優先；其餘為推導 CID）
  → 與 active VirtualAtomInUse 比對：**比對鍵＝先佔者記錄的 atomCid／range**
  → 通過 → 寫入本次佔用（VirtualAtomInUse）；失敗 → 既有衝突／park／queue
```

### 5.1 比對鍵（補充，已鎖定）

後到任務**不得**只靠「符號字串碰巧同名」判斷衝突；以先佔者寫進佔用紀錄的 **atomCid 與 range** 為準。當次重算只服務「組裝本次 intent」。

### 5.2 快取（補充，已鎖定）

內容雜湊當鍵、可丟；正確性只靠當次 discover＋正式 registry。

### 5.3 Import 前導區（補充，已鎖定）

前導區視為**檔案級共享區**或獨立 derived region；預設串列或走既有 compose，**避免**兩個函式 claim 都默認獨佔整段 import。

### 5.4 操作類型（補充）

補齊至少：

- 修改既有原子（改體／改簽名需區分是否換 CID）；
- （既有）新增／刪除／整檔 等，與 broker 操作面對齊。

### 5.5 認領遇正式 stale（補充，已鎖定）

二選一寫死（建議預設 **B**）：

- A：fail-closed（要求人先處理漂移）  
- B：降為**檔案級** claim（不可用過期正式邊界做細粒度 compose）

禁止：用過期正式邊界繼續 fine-grained compose。

### 5.6 全庫掃描

選用：報告、警察分析、人工調查。**不是**日常開發／認領路徑。

---

## 6. CID v2（步驟 1）

| 概念 | 規則 |
|------|------|
| atomCid | `SHA-256( formulaVersion ‖ kind ‖ symbol ‖ sortedCanonicalSourcePaths ‖ detectionMethod ‖ enclosingScope? )` — **不含行號** |
| 同名 | 同檔同名靠 kind＋enclosingScope（或同等穩定區分）分開；規則寫進文件與測試 |
| contentVersion | 內容／preimage 雜湊；變了只升版本，不換 id |
| Locator | path＋symbol；行號僅快取；anchor resolve → fresh\|stale\|ambiguous\|unsupported |
| v1 | 含 lineSignature 的舊 CID；舊 claim／receipt 可驗證；**新寫入用 v2** |

掛點：`packages/core/src/broker/candidate-bridge.ts`（`computeCandidateAtomCid`）。  
回退：`ATM_CID_FORMULA=v1|v2`。

---

## 7. 與既有機制銜接（禁止平行）

| 既有 | 用法 |
|------|------|
| `discoverAtomCandidates` | 認領時發現源（先 JS/TS） |
| `candidate-bridge` | 唯一 CID 公式與 WriteIntent 橋 |
| `content-anchor` | 定位／stale 語意 |
| `atm create`／`create-map` | 正式出生；推導不取代 |
| path-to-atom＋`register-path` | 粗 owner；可作 fallback，不得蓋過「正式／推導 CID 不相交」的結果 |
| `VirtualAtomInUseRegistry` | 僅動態佔用 |
| `behavior.atomize`／police／curator | 升格／拆分提案；推導只當線索 |
| INV-ATM-010 compose-first | 消費疊合後的邊界 |

**不要新建：** 平行 create CLI、第二套 path-map、第二套 CID、把推導當正式 registry、預設 commit 的全庫 atlas。

---

## 8. 分期（相對 v0.1 大幅縮水）

### P0 — CID v2

公式＋同名規則＋測試＋文件＋旗標。不做認領疊合、不做 atlas。

### P1 — 認領時 discover＋疊合

Claim／WriteIntent 組裝：touched 檔當場算 → §4.2 → atomRefs → 佔用。含 import 區語意、「修改既有原子」op、stale 降級規則。可選行程快取。

### P2 — Doctor／警察漂移與升格線索

正式 stale 可見；警察可對「反覆認領的推導原子」發升格建議（仍不自動轉）。

### P-later（有需要再加）

- 改名歷史（commit 或旁路記錄）協助正式原子改掛新名；第一版認領找不到 → stale＋人工。  
- 可丟棄的磁碟快取目錄。  
- 選用全庫掃描報告 CLI。  
- 若實務證明認領延遲不可接受，再評估 commit 旁路快取（仍非 SSOT）。  
- close 閘、強制 atlas——**僅在有明確痛點時**重開評估。

回退：關 feature flag → 回到今日檔案／粗 owner 認領。

---

## 9. 測試矩陣（摘要）

| ID | 案例 | 期望 |
|----|------|------|
| T-P0-1 | 插入空行 | CID 不變 |
| T-P0-2 | 改函式名 | CID 變 |
| T-P0-3 | 只改函式體 | CID 不變，contentVersion 變 |
| T-P0-4 | 同檔同名不同 kind／scope | CID 不撞 |
| T-P1-1 | 兩 task 同檔兩函式 | 可同時 admitted（既有 compose／parallel） |
| T-P1-2 | 兩 task 同符號 | 衝突／排隊 |
| T-P1-3 | 推導落在正式範圍內 | 不另發 id；佔用正式 id |
| T-P1-4 | 推導跨兩正式原子 | 不 silently 吞；拆段或檔案級 |
| T-P1-5 | 兩 claim 碰 import 區 | 共享區語意（串列／compose），非雙獨佔 |
| T-P1-6 | 正式 stale 仍認領 | 符合 §5.5（擋或檔案級） |
| T-P2-1 | 漂移 | doctor／警察可見；不自動改碼 |

---

## 10. 風險與緩解

| 風險 | 緩解 |
|------|------|
| 同名撞 CID | P0 強制 scope／kind 測試 |
| 過期正式邊界誤 compose | §5.5 |
| 快取被當成真相 | 文件＋禁止跨進程 SSOT |
| discover 品質（regex） | 低信心不進 parallel-safe；後續 enclose 另卡 |
| 誤叫「虛擬原子」 | 名詞表＋ code review 用語 |

---

## 11. 任務卡切分

1. `TASK-DERIVED-0001` CID v2＋同名規則＋測試＋文件  
2. `TASK-DERIVED-0002` 認領路徑：discover＋疊合＋atomRefs  
3. `TASK-DERIVED-0003` import 區＋「修改既有原子」op 類型  
4. `TASK-DERIVED-0004` 正式 stale 認領策略（§5.5）＋doctor 表面  
5. `TASK-DERIVED-0005` dogfood：同檔雙符號  
6. （可選）`TASK-DERIVED-0006` 警察升格 finding  
7. （P-later）改名歷史／選用全庫報告  

---

## 12. 已鎖定 vs 可後定

| 項目 | 狀態 |
|------|------|
| 正式／推導／InUse 三分；禁「虛擬原子」指靜態圖 | **已鎖定** |
| 不自動升格；升格走 create／atomize＋審核 | **已鎖定** |
| 認領當場算；預設不 commit 全庫地圖 | **已鎖定** |
| 正式邊界優先；漂移不自動修 | **已鎖定** |
| 比對鍵＝佔用紀錄的 CID／range | **已鎖定** |
| 快取可丟、非 SSOT | **已鎖定** |
| import 共享區語意 | **已鎖定** |
| stale 認領：擋或檔案級（建議檔案級） | **已鎖定方向；實作選 B 除非產品改選 A** |
| CLI 名稱、低信心門檻數值 | 可後定 |
| 跨兩正式原子：拆段 vs 整段檔案級 | 可後定（須寫死一種） |

---

## 13. 相對 v0.1／v0.2 的變更摘要

- 刪除：預設 `.atm/atlas`、commit hook、P4 close atlas 閘、開發流全庫掃描。  
- 保留並前移：CID v2、正式／推導疊合、不自動升格、InUse 僅佔用。  
- 新增釘死：名詞、比對鍵、快取非 SSOT、import 區、stale 認領策略。

---

## 14. 開工檢查清單

- [ ] 同意三步範圍與非目標  
- [ ] 同意名詞與禁止「虛擬原子」混用  
- [ ] 同意 §5.5 stale 策略（預設 B）  
- [ ] 同意跨兩正式原子的落地選項（拆段或檔案級）  
- [ ] （可選）開 `TASK-DERIVED-0001`

---

**文件結束（Draft v0.3）**

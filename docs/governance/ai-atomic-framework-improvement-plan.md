# AI-Atomic-Framework 改善規劃書

版本：v0.1
日期：2026-05-11
適用範圍：AI-Atomic-Framework 上游主倉與其預設治理 bundle、CLI、核心契約、範例與驗證腳本。

## 1. 規劃目的

這份規劃書的目標，不是把 ATM 再寫得更「完整」，而是把它改成更「可用、可信、可維護、可接手」的治理框架。

目前 ATM 的概念層設計是成立的：它把 atomic work item、scope lock、evidence、context summary、adapter boundary 與 validation gate 都定義出來了。但實作層存在幾個明顯落差：

- 驗證命令有「看起來完整」但不一定「真的做了什麼」的問題；
- package manager、runtime、build 方式、型別系統彼此沒有完全收斂；
- plugin 與 behavior 的切分過碎，增加了理解與維護成本；
- bootstrap 與 self-hosting 入口過長，對人與 agent 都不夠友善；
- hash lock、registry、evidence 與自我描述之間存在 placeholder 或過度自我參照風險。

因此，本規劃書以「先止血，再收斂，再簡化入口，最後做擴張」為主軸，避免在基礎信號仍不誠實時繼續擴大 surface area。

## 2. 現況診斷

### 2.1 驗證信號不夠誠實

目前 `npm test`、`npm run typecheck`、`npm run lint` 的實作邏輯高度相似，本質上多半是在串接一大串 `validate-*.mjs` 腳本。這種模式雖然方便把規則集中在一處，但也有三個問題：

1. 名稱與實際行為不一致，容易讓使用者誤以為有跑真正的 typecheck 或 lint。
2. 當其中某個 validator 只是對 metadata 或 fixture 做包裝檢查時，整體綠燈不代表程式碼真的可編譯、可執行。
3. 未來維護者會在「修 validator 還是修核心程式」之間浪費時間。

### 2.2 工具鏈與 runtime 路線沒有完全統一

repo 同時存在 `pnpm-workspace.yaml`、`packageManager: pnpm@...`、`package-lock.json` 與大量 `npm run` 範例。這會造成：

- 新 contributor 不確定應該用 npm 還是 pnpm；
- lockfile 可能反覆漂移；
- 文件與實際執行方式不一致；
- 自動化 agent 需要額外猜測執行環境。

另外，`packages/core` 是 TypeScript，但根目錄並沒有完整的編譯與發佈路線，導致「型別定義存在，但 runtime 路徑不一定真的被使用」。如果這條路線不收斂，就會一直存在「文件上很正確、實際上半透明」的狀態。

### 2.3 package 與 plugin surface 過碎

`packages/` 下有大量 `plugin-behavior-*` package，而且不少 package 都非常薄，實作內容短、責任接近、命名語意重疊。這帶來四個後果：

- 使用者需要記住太多 package 名稱；
- agent 在規劃 action 時要在多個近義詞之間做選擇；
- monorepo 維護成本高於這些 package 的實際內容量；
- 變更一個邊界時，容易產生跨 package 同步不一致。

### 2.4 bootstrap 與 self-hosting 體驗過長

ATM 的首要承諾是「root-drop、zero install、agent 可自我啟動」。但目前實際上仍依賴較多前置條件：

- 需要讀多份文件；
- 需要理解 `.atm/` 下多個分散目錄；
- 需要知道 bootstrap、init、guide、create、validate、verify 的順序；
- 需要理解 task、lock、evidence、context summary、continuation report 的檔案分佈。

這對人類是學習成本，對 agent 是 context budget 成本。

### 2.5 hash lock 與 registry 仍有 placeholder 風險

當 registry 或 spec 內的 hash 還是固定 dummy 值時，hash lock 的價值會大幅下降。這不只是技術債，也是治理信任問題：

- 使用者以為鎖住了內容，實際上鎖的是 placeholder；
- 驗證看似可重現，但沒有真正用 canonical content 算出結果；
- 如果未來想做跨版本比較，缺乏可信基準。

### 2.6 自我參照太重，缺少外部錨點

seed spec、seed registry 與 validator 之間如果互相引用過深，就會形成「validator 驗 validator」的循環。這不是不能做，而是需要至少一個外部固定錨點，否則很難說服外部使用者這套系統不是自我證明。

### 2.7 repo 衛生與使用者路徑還可再收斂

根目錄出現暫存檔、手動調試檔，會讓 governance 工具的可信度下降。另一方面，`README.md`、`QUICK_START.md`、`SELF_HOSTING_ALPHA.md`、`ARCHITECTURE.md` 等文件之間雖然內容完整，但對首次使用者來說，仍然不夠像一條直線。

## 3. 目標狀態

改善完成後，ATM 應該達成以下狀態：

1. **驗證真實化**：`test`、`typecheck`、`lint` 名稱與行為一致，不再只是包裝多個 metadata validator。
2. **工具鏈單一化**：整個 repo 對外只保留一套主要安裝與執行路線。
3. **核心契約穩定化**：core 契約維持精簡、可移植、可被不同 runtime 實作。
4. **plugin surface 收斂**：預設治理 bundle 保持完整，但不再以過多小 package 承載近義責任。
5. **bootstrap 入口單一化**：新使用者或 agent 只需要一個官方入口，就能完成初始化與第一個 smoke。
6. **hash 與 evidence 可驗證**：所有關鍵 registry 與 spec 的 hash 有明確 canonicalization 規則與可重算結果。
7. **文件可操作化**：文件不只是描述理想狀態，而是能直接引導執行。

## 4. 改善原則

- **誠實優先**：名稱、腳本、報告與真實行為必須一致。
- **單一入口優先**：同類型動作只保留一個官方入口，避免 agent 選錯路徑。
- **先收斂再擴張**：在工具鏈與邊界穩定前，不先加新 package 或新變體。
- **核心與 bundle 分離**：core 只負責契約，預設 bundle 才負責便利性。
- **證據可重放**：任何重要結論都要能回到 command、artifact、digest、report。
- **降低記憶負擔**：讓使用者記 3 個 profile 名稱，不要記 30 個腳本名。
- **保留遷移彈性**：每個重大改造都要有 migration path 與相容層。

## 5. 建議目標架構

### 5.1 層級建議

| 層級 | 職責 | 不應做的事 |
| --- | --- | --- |
| `packages/core` | 核心契約、spec/registry/hash 邏輯、純工具 | 不依賴預設治理 bundle，不假設 host layout |
| `packages/cli` | 對外命令面與流程入口 | 不承載核心契約語意 |
| `packages/plugin-sdk` | 插件與 adapter 契約 | 不內建 host-specific 規則 |
| `packages/plugin-governance-local` | 預設治理 bundle 的 reference implementation | 不把 bundle 行為回寫成 core 必需條件 |
| `packages/adapter-local-git` | 本機/ Git 對接範例 | 不改 core 的語意 |

### 5.2 目錄收斂建議

` .atm/ ` 的目錄不一定要全部消失，但對外應收斂成少數可理解的視角：

- `state`：當前狀態、上下文預算、context summary；
- `tasks`：任務與狀態追蹤；
- `evidence`：驗證結果與關聯 artifact；
- `reports`：可重放的執行報告；
- `artifacts`：可保留的輸出；
- `profile`：預設治理設定。

重點不是檔案要少到極致，而是 agent 不需要記住太多層狀規則。

## 6. 分階段改善路線圖

### Phase 0：止血與誠實化

**目標**：先讓現有信號可信。

#### 工作項目

| 項目 | 內容 | 交付物 | 驗收方式 |
| --- | --- | --- | --- |
| 統一 package manager | 選擇 npm 或 pnpm 其中一套，刪除另一套遺留 | 單一 lockfile 與一致文件 | 全文檢查沒有互相矛盾的安裝指令 |
| 讓 `typecheck` 真的 typecheck | 補 `typescript` 與 `tsc`，或把腳本改名為誠實的 validation profile | 真正型別檢查 | 失敗時能指出 TS 原始錯誤 |
| 讓 `lint` 真的 lint | 引入 ESLint / Biome / 等效工具，或改名 | 真正 lint 流程 | 會回報程式風格與潛在錯誤 |
| 清理 repo 殘留 | 刪除暫存檔與調試檔，補 `.gitignore` | 乾淨 root | 根目錄不再有臨時垃圾檔 |
| 偵測 placeholder hash | 新增 audit 腳本，列出仍在使用 dummy digest 的項目 | hash audit report | registry / spec 中的假值可被快速定位 |

#### Phase 0 完成標準

- `test/typecheck/lint` 不再讓人誤解；
- 文件與工具指令完全一致；
- root workspace 沒有明顯臨時檔；
- placeholder hash 能被列出與追蹤。

### Phase 1：核心收斂

**目標**：把過碎的邊界整併成可理解的核心面。

#### 工作項目

| 項目 | 內容 | 交付物 | 驗收方式 |
| --- | --- | --- | --- |
| 收斂 validation profile | 將大量 `validate-*.mjs` 整理成少數 profile：`quick`、`standard`、`full` | profile runner | 使用者只需記 3 個等級 |
| 收斂 behavior package | 將高度近似的 behavior package 重新切分或合併 | 更少但更清楚的 package 邊界 | package 數量下降，命名語意更清楚 |
| 統一 hash canonicalization | 明確定義 canonical JSON / 欄位排序 / 忽略規則 | 可重算 hash 設計 | 同一 spec 在不同機器上得到相同 digest |
| 建立外部錨點 fixture | 讓核心驗證不只依賴自我描述資料 | golden fixtures | 至少一組不自我參照的驗證樣本 |
| 收斂治理 bundle | 預設 bundle 保持可用，但不再散成太多微型 package | reference bundle v1 | 能一口氣裝出可用預設治理 |

#### Phase 1 完成標準

- 核心邊界可以被一個新 contributor 用一句話說清楚；
- validation profile 明顯少於現有腳本數量；
- hash 與 registry 可重算且可驗證；
- bundle 仍完整，但 package surface 明顯縮小。

### Phase 2：入口簡化

**目標**：讓第一次使用的人不用猜順序。

#### 工作項目

| 項目 | 內容 | 交付物 | 驗收方式 |
| --- | --- | --- | --- |
| 新增 `atm doctor` | 一次列出當前 repo 狀態、缺失檔、已鎖任務、最近 evidence | 狀態摘要命令 | 新使用者可快速知道下一步 |
| 新增 `atm next` | 根據目前狀態推導下一個官方步驟 | 推薦行動命令 | 不再需要手動推理流程 |
| 壓縮 bootstrap prompt | 將官方 single-entry prompt 縮短到最小必要資訊 | 簡化版官方提示 | 使用者可以直接複製執行 |
| 重寫 quick start | 讓新手沿著一條最短路徑完成 hello-world | 簡化導覽文件 | 30 分鐘內完成首個 smoke |
| 合併重複說明 | README、Quick Start、Self-Hosting Alpha 的重疊內容只保留一個主入口 | 主入口文件 | 不需要反覆讀三份近似文件 |

#### Phase 2 完成標準

- 任何人進 repo 後，只要做 1 到 2 個決策就能開始；
- bootstrap 不再需要長篇提示才能跑；
- `doctor` / `next` 可以替代大多數手動腦內推理。

### Phase 3：預設 bundle 與 adapter 成熟化

**目標**：讓 ATM 真正成為可下放的治理底座。

#### 工作項目

| 項目 | 內容 | 交付物 | 驗收方式 |
| --- | --- | --- | --- |
| 預設治理 bundle v1 | 把 task、lock、evidence、budget、context summary、profile 收成 reference implementation | 一個清楚的預設 bundle | 可直接給下游 repo 使用 |
| adapter contract 固化 | 把 host-specific 行為固定在 adapter / plugin boundary 內 | 穩定 contract | core 不再被 host implementation 汙染 |
| downstream example | 製作一個完整但簡單的 host example | 可追蹤的 sample repo | 能示範從 root-drop 到完成第一個 task |
| migration note | 對舊入口與舊格式提供清楚遷移說明 | migration guide | 舊使用者有明確過渡路徑 |

#### Phase 3 完成標準

- ATM 可作為下游專案的治理預設；
- adapter contract 穩定，不需要常改 core；
- sample repo 足以示範真實使用場景。

### Phase 4：持續治理與擴張

**目標**：避免回到「概念完整、實作再度分裂」的狀態。

#### 長期工作項目

- 每次變更都要有對應 evidence；
- 每個重大契約更新都要有 migration path；
- 每一輪發佈都要跑一組固定的 smoke / regression / neutrality checks；
- 新增 package 前先回答「是否真的需要獨立 package」；
- 新增命令前先回答「是否可由 `doctor`、`next` 或既有 profile 表達」。

## 7. 技術決策建議

### 7.1 TypeScript 與 JavaScript 路線二選一

目前最關鍵的工程決策之一，是要不要正式建立 build pipeline。

**方案 A：保留 TypeScript，建立正式編譯流程**

- 優點：型別完整、契約清楚、長期可維護性高。
- 成本：需要 `tsc`、輸出目錄、發佈規則、CI 與 source map 策略。

**方案 B：runtime 全面收斂到 `.mjs` + JSDoc / `.d.ts`**

- 優點：工具鏈更輕、執行路徑更直觀、與 CLI 現況接近。
- 成本：型別體驗與大型重構支援略弱，需要很好的文件與測試。

**建議**：短期若要先把 alpha 路徑跑順，優先選擇一條能被完整執行的路線，不要讓 `ts` 與 `mjs` 長期半分裂。

### 7.2 Plugin package 佈局

如果 behavior 與治理插件仍然偏小，建議把多個近義 package 合成較少數的 capability package，再用內部 action id 做分派。這會比維持大量薄 package 更適合 agent，也更容易維持 release 認知。

### 7.3 Hash lock 與 registry

hash lock 應由 canonicalization 規則直接生成，而不是手寫 placeholder。必要時可以先保留相容層，但最終一定要讓 registry、spec、report 都能被重算。

### 7.4 文件與 CLI 的關係

文件應該告訴使用者「只有一條官方路」，CLI 則負責把那條路做短。不要讓 CLI 變成文件的另一份複製品。

## 8. 驗收指標

以下指標可作為改善是否成功的最小量化標準：

1. `test`、`typecheck`、`lint` 三者名稱與真實行為一致。
2. 根目錄不再有臨時調試檔。
3. registry 與 seed spec 不再出現 placeholder digest。
4. bootstrap / self-hosting 的官方入口縮成單一主流程。
5. 新 contributor 能在不讀大量內部規格的情況下完成 hello-world smoke。
6. 預設治理 bundle 可單獨作為 reference implementation 被重用。
7. 核心與 adapter 的責任邊界可以被明確說出，不依賴模糊例外。

## 9. 風險與對策

| 風險 | 影響 | 緩解方式 |
| --- | --- | --- |
| package manager 切換 | 可能引發 CI 或 lockfile 漂移 | 先定決策，再一次性同步文件與腳本 |
| type/runtime 路線重整 | 可能讓現有命令暫時失效 | 先做相容層，再逐步 cutover |
| plugin 合併 | 可能影響既有 import 路徑 | 透過 re-export 與 migration note 降低衝擊 |
| hash 重新計算 | 可能讓舊 registry 失效 | 保留 legacy snapshot 與版本化 registry |
| bootstrap 壓縮 | 可能讓文件看起來更短但不夠完整 | 文件主入口保留進階說明，簡版只做第一次上手 |

## 10. 建議執行順序

1. 先決定 package manager 與 runtime/build 路線。
2. 把 `test/typecheck/lint` 變成誠實信號。
3. 清理 root 與 placeholder hash。
4. 收斂 plugin / behavior package。
5. 新增 `doctor` / `next` 類型入口。
6. 壓縮 bootstrap 與 self-hosting 路徑。
7. 補齊 migration note、golden fixture 與長期回歸門檻。

## 11. 結語

ATM 的問題不是「概念不夠」，而是「概念已經夠多，但落地時的信號與入口還不夠簡單」。

這份改善規劃的核心方向是：先把真實性做回來，再把 surface area 縮小，最後才把便利性做上去。只要順序正確，ATM 才有機會從一個設計完整的 governance framework，變成一個真的能被人與 agent 順手使用的框架。
# ATM Write Broker 硬閘門稽核（Standing Broker Hard Gate）

日期：2026-10-07（Asia/Taipei，CST）  
倉庫：`/workspace/AI-Atomic-Framework`  
範圍：現況是否「每次寫入都經 Broker」、以及把 Standing Broker 做成「每筆受治理寫入 fail-closed」需要什麼。  
約束：本報告僅稽核，**無程式碼變更、無 GitHub 操作**。

---

## 一句結論

**今天不是 always-on Write Broker daemon。**  
Write Broker 是 **按指令 on-demand** 載入／寫入檔案型 registry（`.atm/runtime/write-broker.registry.json`），搭配 **work-admission ticket**、**git／integration hooks**、**restricted execution gateway** 做受治理路徑上的 fail-closed。  
既有 `atm daemon` 是 **advisory-only 檔案監視**，明確不mutate 受治理狀態，**不是** Write Broker。  
要把「每一筆受治理寫入」都硬閘在 broker ticket 上，短期最貼近現況的是 **方案 B（強制 on-demand + 必經 hook／CLI）**；真要「admit 卡住等到釋放」才需要 **方案 A（常駐 broker 程序）**。純 **方案 C（FS watch／pre-commit only）無法在寫入前 fail-closed**。

自動原子化／VAI（atlas）refresh：**不必**常駐 daemon 也能 on-demand `evaluateBrokerAdmission`／`broker register`；今日 **沒有**「掛在 broker admit 上 sleep 等到租約釋放」的語意——沒有常駐程序或明確 poll 迴圈就不會「hang on admit」。

---

## 1. Write Broker 何時啟動／registry 何時建立？Always-on 還是 on-demand？

### 證據：on-demand CLI，非常駐程序

| 事實 | 路徑 |
|------|------|
| `atm broker` 入口每次命令組路徑，**不 spawn daemon** | `packages/cli/src/commands/broker/implementation.ts`（`registryPath` → `.atm/runtime/write-broker.registry.json`） |
| Registry 讀寫是 **檔案 store + CAS write-lock** | `packages/core/src/broker/registry-store.ts`（`createBrokerRegistryStore`、`writeBrokerRegistrySnapshot`、`mkdirSync(dirname)`） |
| 檔案不存在時 **read 回傳空文件**（記憶體空 registry），不自動起行程 | 同檔 `readBrokerRegistrySnapshot`：`if (!existsSync(registryPath)) { createEmptyBrokerRegistryDocument() … }` |
| 首次真正寫入才落盤 | `writeBrokerRegistrySnapshot` → `mkdirSync` + `.write-lock` + rename CAS |
| `register` 動作：load → `calculateBrokerDecision` → `createBrokerTransactionAuthority(…).register` | `packages/cli/src/commands/broker/registry-actions.ts` |
| Broker 模組匯出純函式／檔案 API，**無 socket／listen／IPC server** | `packages/core/src/broker/index.ts`、`packages/cli/src/commands/broker/*`（搜尋無常駐 server） |

### 與 `atm daemon` 的區隔（勿混淆）

| 事實 | 路徑 |
|------|------|
| Daemon 為 opt-in，**advisory-only，永不 mutate 受治理狀態** | `packages/cli/src/commands/daemon.ts`（enable 訊息）；`packages/core/src/daemon/daemon-watcher.ts` 檔頭註解 |
| Watcher 監視 maps／atoms／`.atm/runtime`，只寫 `notifications.jsonl` | `daemon-watcher.ts`：`buildDefaultWatchPaths`、`appendDaemonNotification`、`action: 'advisory'` |

**判定：** Write Broker = **per-command on-demand + 持久化 registry 檔**；**不是** always-on Write Broker daemon。Registry「建立」= 第一次成功的 CAS write（常由 `broker register`／claim 前置註冊觸發）。

---

## 2. 哪些寫入路徑「必須」走 broker admission（或同等 ticket）？

「必須」此處指：**走 ATM 受治理路由時**會要求 broker 決策／registry 註冊，或至少 **現行 work-admission ticket**（ticket 由 claim／import／repair-closure 發行，與 broker 體系綁定）。

### 2.1 明確呼叫 Broker register／admission

| 路徑 | 行為 | 證據 |
|------|------|------|
| `next --claim` 前置 | `registerPreClaimBrokerTransaction` → `runBroker(['register', …])` 寫 intent 並註冊 | `packages/cli/src/commands/next/claim-helpers.ts`；orchestration 於 `claim-orchestration.ts` |
| Claim admission 裁決 | 以 `evaluateBrokerAdmission`／conflict-matrix 與 `broker register` 對齊 | `packages/cli/src/commands/next/claim-admission.ts`（檔頭註解 TASK-RFT-0011） |
| `atm broker register\|decision\|status\|release\|…` | 直接操作 registry | `packages/cli/src/commands/broker/registry-actions.ts` |
| `atm broker steward plan\|apply` | 中立 steward 為共享檔唯一 apply 路徑 | `packages/cli/src/commands/broker/steward-runtime-actions.ts`；`packages/core/src/broker/steward.ts` |
| Compose／proposal／batch／parallel-admission | broker 子命令族 | `packages/cli/src/commands/broker/implementation.ts` 用法字串 |
| Taskflow close／衝突閘 | `loadRegistry` + `calculateBrokerDecision` | `packages/cli/src/commands/taskflow/broker-gate.ts` |
| Team start | **不得繞過** claim／dependency admission；可消費 broker proposal | `docs/tasks/TASK-TEAM-0028-…`；`docs/governance/parallel-governance-charter.md`；start 仍走 legacy team runner |

### 2.2 必經 work-admission ticket（broker 體系產物，未必每次 live `register`）

| 路徑 | 行為 | 證據 |
|------|------|------|
| Claim 發票 | `issueWorkAdmissionTicket` 寫入 task document | `packages/cli/src/commands/tasks/claim-work-admission.ts`；核心 `packages/core/src/broker/work-admission-ticket.ts`（缺票 → `ATM_WRITE_TICKET_MISSING`） |
| Pre-commit | 檢查 ticket／shared-write provenance／cross-task mutation／broker lifecycle | `packages/cli/src/commands/hook/pre-commit/implementation.ts`、`support.ts`、`cross-task-admission.ts` |
| Integration `pre-tool` | 活躍 direction lock 下 mutating 檔案要求現行 work-admission；raw-git 否認 | `packages/cli/src/commands/integration-hooks/implementation.ts` |
| Restricted execution gateway（agent／editor） | `atm-governed-command`／declared write 需 `checkWorkAdmissionTicket`；raw-git mutation deny | `packages/core/src/team-agents/restricted-execution-gateway.ts` |
| Police／review-advisory／git-governance／taskflow write-readiness | 有 task+files 時評估 work admission | `packages/cli/src/commands/police.ts`、`review-advisory.ts`、`git-governance/work-admission-check.ts`、`taskflow/write-readiness.ts` |

### 2.3 INV-ATM-010 拓撲／compose 契約（政策層）

| 規則 | 路徑 |
|------|------|
| 正常開發單一 canonical worktree；僅 neutral-steward 可 apply shared delivery | `packages/core/src/broker/workspace-topology-policy.ts` |
| Compose-first 憲章敘述 | `fixtures/charter/default-charter.json`（`INV-ATM-010`）；`docs/governance/parallel-governance-charter.md` |

**判定：** 受治理「意圖→註冊→（compose）→steward apply→commit／close」鏈路上，**claim／broker CLI／steward／多數 hook 閘門**會要求 admission 或 ticket。這不是 OS 級「任何 write(2)」硬閘。

---

## 3. 今日可繞過 Broker 的寫入路徑

| 旁路 | 說明 | 證據／依據 |
|------|------|------------|
| **Raw git** | 直接 `git commit`／未裝 hook／`--no-verify` | `docs/governance/git-boundary-admission-contract.md`：hook「可偵測但可被本機操作者繞過」；`--no-verify` 為緊急 lane |
| **編輯器直接存檔** | 未裝／未觸發 integration pre-tool 時，FS 寫入不經 broker | hooks 為安裝式（`integration-hooks/implementation.ts`）；無 FUSE／強制 FS interceptor |
| **腳本／Node 直寫** | `writeFileSync`／建置腳本不經 ATM CLI | 無全域 wrapper；`create-atm` 即為直寫範例 |
| **`create-atm` scaffolding** | bootstrap 時 `mkdirSync`／`writeFileSync` package／launcher | `packages/create-atm/src/index.ts` |
| **npm publish／一般 build 產物** | 除非走 runner-sync／projection steward 佇列，否則不自動 broker admit | steward 佇列存在於 broker runtime（`runner-sync-steward-queue`、`generated-projection-steward`），但對外 npm 非強制入口 |
| **Atomize／候補 discover** | `candidatesToWriteIntent` 為函式庫轉換；物理 refactor 另有 dry-run 政策，**預設開發流未必持久化並 register** | `packages/core/src/broker/candidate-bridge.ts`；對照 `VIRTUAL_ATOM_INDEX_ANALYSIS.md` |
| **`.atm/atlas`（規劃中 VAI）** | 若未當 shared surface 走 ticket／steward，會成無治理旁路 | 既有報告 `VIRTUAL_ATOM_INDEX_ANALYSIS.md`、`ATOM_BEHAVIOR_POLICE_SURVEY.md` 已標風險 |
| **Rescue／alternate worktree 歷史寫入** | 違 INV-ATM-010 的「正常 per-card 寫入」案例靠稽核／disposition，非即時硬擋所有 FS | `scripts/governance-bypass-audit.ts`；`docs/reports/plan-3x-4x-rescue-worktree-audit.json` |
| **Git boundary MVP 定位** | 契約寫明 MVP 閘在 **pre-push**；本機 commit「保持便宜彈性」 | `docs/governance/git-boundary-admission-contract.md` |

**判定：** Broker **不是**今日「所有磁碟寫入」的硬閘；它是 **ATM 命令面＋可安裝 hooks＋ticket／receipt** 的治理閘。旁路在設計上仍存在，部分靠 emergency receipt／doctor／事後 audit。

---

## 4. doctor／INV-ATM-010 與 broker 強制姿態

### 4.1 Charter 定義

```text
INV-ATM-010 — Single canonical worktree and compose-first shared writes
enforcement: doctor
```

來源：`fixtures/charter/default-charter.json`；技能／GEMINI 摘要同文。

規則要旨：單一 canonical worktree／base／HEAD；共享實體檔走 compose（atom／CID／anchor／range intent → broker／adapter／composer）；**僅 neutral steward** 寫共享檔；Git branch／detached worktree／alternate index **不得**當正常隔離；例外需具名 receipt。

### 4.2 doctor 實際檢查什麼

| 檢查 | 路徑 | 與「每寫必經 broker」關係 |
|------|------|---------------------------|
| Charter 完整性（檔案存在、可解析、authority bundle） | `packages/cli/src/commands/doctor/utilities.ts`（`checkCharterIntegrity`／V2）；`run-doctor.ts` | **只驗證憲章在場**，不掃描「每次 write 是否有 ticket」 |
| Cross-task mutation／incident 等 | `run-doctor.ts` 匯入 `cross-task-mutation-guard` | 治理衛生，非 OS write interceptor |

### 4.3 執行期／證據層對 INV-ATM-010 的強制

| 機制 | 路徑 | 姿態 |
|------|------|------|
| Workspace topology policy | `workspace-topology-policy.ts` | 非 canonical／worker 直寫 shared delivery → reject |
| Lifecycle receipt 驗證 | `packages/core/src/broker/replay/lifecycle-receipts.ts`（`pathOnlyFileLock`／`workerDirectWrite`／`detachedWorktreeIsolation` → `INV-ATM-010`） | **證據／replay fail-closed**，非寫入當下 FS hook |
| Parallel admission policy | `docs/governance/parallel-governance-charter.md`；`broker parallel-admission` | 預設 `mode: enforce`，shared-write 門檻 ticketed；跳閘 → queue-only |
| Work admission ticket | `work-admission-ticket.ts` | 缺票／過期／scope 外 → deny codes |

**姿態總結：** INV-ATM-010 的 **doctor enforcement = 憲章／衛生檢查**；真正「寫不下去」靠 **ATM 命令面＋hooks＋ticket＋receipt 驗證**。這是 **受治理表面 fail-closed**，不是 **全域寫入 hard gate**。要把「standing broker hard gate」寫進產品定義，需另開「無 ticket 則受治理寫入失敗」的明確合約與安裝／CI 要求。

---

## 5. 做成「每筆受治理寫入無 broker ticket 即 fail-closed」的變更規模

「受治理寫入」建議邊界（與 INV-ATM-010 一致）：  
task／claim 範圍內的 source／shared surface／`.atm` 治理產物／steward apply／close／commit wrapper；**不含**純本機暫存、未採用 ATM 的綠地脚手架（`create-atm` 初期）、已具名 emergency receipt 的例外。

### 方案 A — 常駐 Broker 程序（persistent daemon）

| | |
|--|--|
| **做法** | 獨立 process 擁有 registry 鎖與 admit API（Unix socket／本地 HTTP）；CLI／hooks／VAI refresh 一律 RPC；daemon 掛掉 → 寫入 fail-closed |
| **優點** | 真 hard gate；可實作「admit 等待／佇列喚醒」；跨 process 單一仲裁者，減少 CAS 重試風暴 |
| **缺點** | 與現況「檔案 CAS + on-demand」架構落差大；運維（PID、崩潰恢復、多 worktree、權限）；現有 `atm daemon` **刻意 advisory**，不能直接打開 mutate——需**新** mutating broker daemon，避免語義污染 |
| **LOC 量級** | ~**1.5k–4k**：daemon 協定／客戶端、啟動與健康檢查、CLI 改走 RPC、hook／gateway 改連線、失敗碼與 doctor「daemon required」、測試與救援文件。既有 registry／decision 可重用（~broker 核心已大型，CLI broker 子樹數十檔） |
| **風險** | INV-ATM-013（昂貴工作前先檢查）要先探 daemon；windows／CI 無常駐行程的採用成本 |

### 方案 B — 維持 per-command on-demand，但強制「必經 hook／CLI」（建議主線）

| | |
|--|--|
| **做法** | 所有受治理寫入入口（`next`／`tasks`／`git commit` wrapper／`integration pre-tool`／`agent-execute`／steward／atomize atlas write）在 mutate 前：`loadRegistry` + ticket 檢查，必要時 `broker register`；doctor／`integration hooks verify` 把「hook 未裝」升為 **error**（對 adopted 專案）；禁止無 ticket 的 ATM wrapper |
| **優點** | 最貼近現況（claim 已 `runBroker(register)`；ticket／CAS 已存在）；無常駐行程；與 multi-process harness（檔案 registry）一致 |
| **缺點** | **無法**攔截「完全不經 ATM／hooks 的 raw FS」；「等待租約」仍需命令內 poll 或立即 queue／block，而非 process hang |
| **LOC 量級** | ~**0.5k–1.5k**：收斂缺口 call site、doctor／verify 升格、atlas／shared-surface 寫入接 steward、文件與少數測試。核心 decision／registry **少改** |
| **風險** | 採用方未裝 hook 仍旁路——需產品政策（adopter 強制 verify）而非僅程式 |

### 方案 C — 僅 FS watch／pre-commit

| | |
|--|--|
| **做法** | 強化現有 advisory daemon 或 pre-commit／pre-push：事後或提交時發現無 ticket |
| **優點** | 最小改動（~**0.2k–0.8k**）；可重用 `daemon-watcher` 路徑 |
| **缺點** | **寫入已發生**才發現；不符 INV-ATM-010「compose-first、steward 才碰共享檔」的**事前**仲裁；hook 仍可 `--no-verify`；watch 今日 **禁止 mutate** |
| **判定** | **不足以**單獨達成 hard gate；只適合作 B／A 的**偵測補強** |

### 建議組合

1. **先做 B**：把「受治理寫入 = 必須有現行 ticket（＋必要時 registry intent）」收成單一 gate helper，掛上 claim 已覆蓋以外的缺口（atlas、atomize 持久化、未裝 hook 的 verify）。  
2. **C 作偵測／CI**：pre-push／doctor 報「無 ticket 的 governed path 變更」。  
3. **僅當產品要「阻塞等待佇列頭」**再上 **A**（或 B + 明確 poll-with-backoff，見 §6）。

---

## 6. 自動原子化（atlas／VAI refresh）能否在無常駐 daemon 時「hang on broker admit」？

### 現況機制

| 能力 | 行為 | 路徑 |
|------|------|------|
| 候補 → WriteIntent | 純函式，同步 | `packages/core/src/broker/candidate-bridge.ts`（`candidatesToWriteIntent`） |
| Admission 評估 | 純函式，立即回 disposition（direct／compose／queue／blocked…） | `packages/core/src/broker/admission/evaluate-broker-admission.ts` |
| Registry 衝突 | CAS 衝突 **丟錯**（`ATM_BROKER_REGISTRY_CAS_CONFLICT`），非 sleep hang | `registry-store.ts` |
| Shared surface queue | 檔案佇列狀態（queue-head／queued…），**不是**常駐 waiter | `registry-actions.ts` + shared-surface 模組 |
| VAI／atlas | 規劃寫入 `.atm/atlas`，應視為 **shared surface** | `VIRTUAL_ATOM_INDEX_ANALYSIS.md` |

### 回答

- **可以不靠常駐 daemon** 做 atlas refresh：refresh 命令內 `discover` → `candidatesToWriteIntent` → `evaluateBrokerAdmission`／`broker register` → 有票再寫 index（必要時走 steward／compose）。這與今日 claim 模式相同。  
- **「hang on admit」**（阻塞到衝突租約釋放再繼續）**今日不存在**於 core API。要模擬：  
  - **無 daemon：** refresh 迴圈 poll `loadRegistry` + backoff（方案 B 延伸，~百行級），或立即 fail／queue 並回傳可執行 recovery command（更符合 INV-ATM-013 fail-fast）。  
  - **有 daemon（方案 A）：** 可真正 park 在 admit 上直到 release／heartbeat 過期清理。  
- 若 atlas 寫入**不**經 ticket／steward，會製造 INV-ATM-010 旁路（多 agent 寫 meta），與「standing hard gate」目標衝突——**無論 A／B，atlas 都必須進 broker／steward 面**。

---

## 證據索引（精簡）

| 主題 | 路徑 |
|------|------|
| Broker CLI 入口與 registry 路徑 | `packages/cli/src/commands/broker/implementation.ts` |
| Registry CAS／空檔行為 | `packages/core/src/broker/registry-store.ts` |
| Register 決策與落盤 | `packages/cli/src/commands/broker/registry-actions.ts` |
| Claim → broker register | `packages/cli/src/commands/next/claim-helpers.ts` |
| Admission 純函式 | `packages/core/src/broker/admission/evaluate-broker-admission.ts` |
| Work admission ticket | `packages/core/src/broker/work-admission-ticket.ts` |
| Steward apply | `packages/cli/src/commands/broker/steward-runtime-actions.ts`、`packages/core/src/broker/steward.ts` |
| Pre-commit／pre-tool | `packages/cli/src/commands/hook/pre-commit/*`、`integration-hooks/implementation.ts` |
| Restricted gateway | `packages/core/src/team-agents/restricted-execution-gateway.ts` |
| Advisory daemon | `packages/cli/src/commands/daemon.ts`、`packages/core/src/daemon/daemon-watcher.ts` |
| INV-ATM-010 charter | `fixtures/charter/default-charter.json` |
| Doctor charter check | `packages/cli/src/commands/doctor/utilities.ts`、`run-doctor.ts` |
| Topology／lifecycle INV | `workspace-topology-policy.ts`、`replay/lifecycle-receipts.ts` |
| Parallel charter | `docs/governance/parallel-governance-charter.md` |
| Git boundary／hook 可繞過 | `docs/governance/git-boundary-admission-contract.md` |
| create-atm 直寫 | `packages/create-atm/src/index.ts` |
| VAI／atlas 與 shared surface | `/workspace/reports/atm-v2-harness/VIRTUAL_ATOM_INDEX_ANALYSIS.md` |

---

## 對父代理／規劃的可執行摘要

1. **現況：** Write Broker = **on-demand + 檔案 registry**；**非** standing daemon。  
2. **必須經 admission／ticket 的：** claim、`broker *`、steward apply、受治理 hooks／gateway／taskflow 閘——在「走 ATM」前提下。  
3. **可旁路的：** raw git、無 hook 編輯器、任意腳本、`create-atm`、未接入 steward 的 publish／build、規劃中的無治理 atlas。  
4. **INV-ATM-010：** doctor 管憲章；執行靠 ticket／topology／receipt；**尚未**等於「每次 FS write 硬閘」。  
5. **硬閘路線：** **B 為主（~0.5–1.5k LOC）**；A 僅為真正阻塞佇列（~1.5–4k + 運維）；C 不能單獨達標。  
6. **Auto-atomize：** 無 daemon 可 admit；**不會**自動 hang；要等待需 poll 或上 A；atlas 必須當 shared surface。

# ATM Atom 行為／警察／演化表面調查（VAI 設計對照）

日期：2026-10-07（Asia/Taipei）  
範圍：`/workspace/AI-Atomic-Framework`（只讀調查，無程式碼變更、無 GitHub）  
目的：讓 Virtual Atom Index（VAI）／`.atm/atlas` 設計不與既有行為、警察、演化、registry、replacement-lane 衝突。

---

## 0. 一句結論

ATM 已有完整的 **正式 atom／map 生命週期**（behavior → propose → ReviewAdvisory → HumanReview → status-machine）與 **replacement-lane 滾出**；VAI 應只補「候選 CID 持久化＋claim／compose 消費」這一層，**不得**變成第二套 registry、第二套 shadow、或可直接升格／改碼的旁路。

---

## 1. 行為／警察／演化清單

### 1.1 Lifecycle modes（執行／相容契約）

| Mode | 定義位置 | 語意 |
|------|----------|------|
| `birth` | `packages/plugin-sdk/src/lifecycle.ts`（`AtomLifecycleMode`）；generator 預設 `packages/core/src/manager/atom-generator.ts` | 新 atom 誕生；警察 registry gate 較寬（`canPromote` 不以 evolution 嚴格門檻卡死） |
| `evolution` | 同上；upgrade／map-curator／evolution-draft 固定寫入 | 既有 atom／map 演化；`runPoliceChecks`／`validateRegistryConsistency` 在 evolution 下要求 registry gate 全過才可 promote |

Hooks（plugin-sdk）：`beforeBirth`／`afterBirth`／`beforeEvolution`／`afterEvolution`（`AtomLifecycleHooks`）。  
**沒有**獨立的 `strangler` lifecycle mode；strangler 是 **範例＋replacement／atomize 敘事**（見 1.6）。

### 1.2 Behavior taxonomy（公開 action id）

權威文件：`docs/governance/behavior-taxonomy.md`  
實作包：`packages/plugin-behavior-pack/src/*`（經 `registerBehaviorPack` 註冊；介面在 `packages/plugin-sdk/src/behavior.ts`）

| Family | Action id | 實作檔 | Registry 轉換（`status-machine.ts`） |
|--------|-----------|--------|--------------------------------------|
| Split | `behavior.split` | `split.ts` | atom：`active`→`active` |
| Split | `behavior.atomize` | `atomize.ts` | atom：`draft`→`active`（secondary `validated`）；**新獨立治理單元誕生** |
| Merge | `behavior.merge` | `merge.ts` | atom：`active`→`active`＋secondary `deprecated`；≥2 sources |
| Merge | `behavior.dedup-merge` | `dedup-merge.ts` | 同上；恰好 2 sources |
| Merge | `behavior.compose` | `compose.ts` | **map**：`active`→`active`；≥2 sources |
| Evolution | `behavior.evolve` | `evolve.ts` | atom：`active`→`active`；**必須**委派 `ATM-2-0020:ProposeAtomicUpgrade`（`EVOLVE_DELEGATION_TARGET`） |
| Evolution | `behavior.polymorphize` | `polymorphize.ts` | atom：`active`→`active`＋secondary `validated` |
| Lifecycle | `behavior.expire` | `expire.ts` | atom／map：`deprecated`→`expired`（需 TTL） |
| Lifecycle | `behavior.sweep` | `sweep.ts` | atom／map：`active`→`deprecated`（需 zero callers） |
| Propagation | `behavior.infect` | `infect.ts` | atom：`active`→`active` |

分類規則（taxonomy）：新獨立單元用 `atomize`、否則 `split`；去重才用 `dedup-merge`；身分不變變體用 `polymorphize`；清殘留用 `sweep`、正式關閉用 `expire`。

**Core 內另有 upgrade「行為」輔助（非 plugin behavior id）：**

| 模組 | 路徑 | 角色 |
|------|------|------|
| reshape | `packages/core/src/upgrade/behaviors/reshape.ts` | map 級 split／merge 邊重路由提案（`atm.reshapeProposal`） |
| retire | `packages/core/src/upgrade/behaviors/retire.ts` | atom 退休階段 `deprecated`→`shadow-off`→`legacy-retired`＋`atm.atomRetirementProof` |

### 1.3 Registry status machine（正式生命週期）

路徑：`packages/core/src/registry/status-machine.ts`

- **狀態**：`draft`｜`validated`｜`active`｜`transitioning`｜`deprecated`｜`expired`｜`quarantined`
- **治理層級**：`foundation`｜`governed`｜`standard`｜`experimental`
- **可變性**：`mutable`｜`frozen-after-release`｜`immutable`
- **過渡動作**：`transition.propose`／`promote`／`quarantine`（quarantine **policeOnly**）＋全部 `behavior.*`＋`experience.*`
- **核心規則**：behavior 產出的是 **宣告式 transition plan**，不得直接寫 registry；實作 guard 見 `plugin-sdk` `BehaviorRegistry.executeGuarded`

### 1.4 Atom police 表面

#### 1.4.1 結構／blocker 檢查（`packages/core/src/police/index.ts`）

`runPoliceChecks`：依選項跑 dependency-graph、layer-boundary、forbidden-imports、registry-consistency；預設 `lifecycleMode: 'birth'`；evolution 時 `canPromote` 綁 registry gate。

#### 1.4.2 Police family facade（`packages/core/src/police/family.ts`）

- 入口：`runPoliceFamilyGate`；CLI：`packages/cli/src/commands/police.ts`（`police run`，`--profile standard|full`）
- **Advisory-only hardening**：明確禁止 registry-mutation／auto-approve／direct-promotion／bypass-review
- 核心 family 名稱（`types.ts`）：`schema`｜`boundary`｜`dependency-graph`｜`registry-consistency`｜`lifecycle`｜角色家族｜`rescue`

#### 1.4.3 13 個角色（`POLICE_ROLE_REGISTRY`）

路徑：`packages/core/src/police/role-registry.ts`＋`roles/*`  
原子地圖說明：`docs/reports/police-family-atomic-map.md`

| Role id | 驗證什麼 | 與 maps／atoms 關係 | 典型 routeHint |
|---------|----------|---------------------|----------------|
| `dedup` | 語意指紋重疊、quality 去重候選 | scope＝atomId | 往 dedup-merge／review |
| `demand` | caller demand ≥ split 門檻 | 符號／區段 → 建議 split | split／atomize |
| `quality` | 版本間品質回歸、map propagation 失敗、dedup hint | atom 版本＋`mapImpactScope` | block／needs-review |
| `map-integration` | map curator 草案／observation、propagation risk | **直接吃 curator report**；scope＝mapId | compose／merge／sweep |
| `atomization` | 可 atomize／infect 區段＋dry-run 中立性／契約 | 候選段 → `behavior.atomize` | `behavior.atomize` |
| `decomposition` | 過大檔 LOC、日提案 cap、suppression | 建議 decomposition plan＋**map replacement** | `behavior.atomize`／`compose` |
| `evolution` | stale base atom／map version、recurrence／confidence、日 cap | 證據驅動演化訊號 | proposal-draft |
| `polymorph` | template／instance drift、propagation 缺失、variant 門檻 | polymorph 家族 | evolve／polymorphize |
| `rollback` | 缺 rollback／equivalence／retirement／reversible-patch；scope drift | riskClass 含 atomize／infect／map replacement／evolve | hard-fail／needs-review |
| `evidence-integrity`（shared gate） | 缺證據、重複、untrusted、schema mismatch、stale | 提案／finding 的 evidence refs | `directApplyAllowed: false` |
| `reversibility`（shared gate） | 不可逆提案 | 與 rollback suppression key 共用 | gate.reversibility |
| `noise-control`（shared gate） | suppression／bypass 計數 | 過濾噪音 finding | advisory |
| `adopter-neutrality` | 上游保護檔含 adopter 專有詞 | full profile 可 fail | 阻斷污染上游 |

常數：`DEFAULT_POLICE_DAILY_CAP=50`、`DEFAULT_EVIDENCE_MAX_AGE_MS=30d`；evolution 預設 recurrence≥2、confidence≥0.6。

#### 1.4.4 其他警察鄰接

| 表面 | 路徑 | 說明 |
|------|------|------|
| Rescue police | `packages/core/src/police/rescue-family.ts` | capsule／map hash 等救援不變量；可 `block-all-mutations` |
| Lifecycle police（plugin） | `packages/plugin-rule-guard/src/lifecycle-police.ts` | quarantine writer＝`lifecycle-police`；caller migration notices |
| Plugin-sdk police types | `packages/plugin-sdk/src/police.ts` | LifecyclePoliceFinding／Notice 契約 |
| Schemas | `schemas/police/*`、`schemas/behavior/behavior-proposal.schema.json` | lifecycle-finding／notice、quality／non-regression、registry-candidate |

### 1.5 Evolution／map curator／upgrade propose 流

權威設計：`docs/ATOM_EVOLUTION_PLAN.md`（證據可解釋「為何考慮」，**不可**自行決定允許升格）。

| 階段 | 程式／CLI | 產出 | 可否寫 registry |
|------|-----------|------|-----------------|
| L0 觀察 | evidence pattern detector reports（`.atm/history/reports`） | observation | 否 |
| L1／L2 掃描草案 | `packages/core/src/upgrade/evolution-draft.ts`；CLI `atm upgrade --scan`（`packages/cli/src/commands/upgrade/scan.ts`） | dry-run proposal drafts | 否 |
| 單 atom 演化 | `behavior.evolve` → `proposeAtomicUpgrade`（`packages/core/src/upgrade/propose.ts`） | `atm.upgradeProposal` | 否（待 gates） |
| Map 結構 | `curateAtomMapEvolution`（`packages/core/src/upgrade/map-curator.ts`） | curator report：proposal＋patch drafts | 否 |
| Map propose CLI | `atm upgrade` map 路徑／`upgrade-map-propose.ts` | 同 propose，target.kind=`map` | 否 |
| Metrics | `metrics-to-proposal.ts` | evolution 模式提案 | 否 |
| Human review 橋 | `packages/plugin-human-review/src/map-curator-bridge.ts` | broker-split → review queue（`behavior.split`／map） | 否 |
| 正式 gates | propose/gates：hash-diff、quality、registry-candidate、map-equivalence、polymorph-impact、rollback、propagation、review-advisory、human-review、retirement | `automatedGates` | 通過後才走 status-machine |

**Map curator 行為子集**（`map-curator/types.ts`）：僅 `compose`｜`merge`｜`dedup-merge`｜`sweep`。  
**訊號**：`caller-graph`｜`input-output-overlap`｜`recurring-failure-cluster`｜`zero-caller-sweep`｜`broker-split-suggestion`。  
預設門檻：caller≥3、IO overlap≥0.75、failure≥2、confidence≥0.5。

驗證腳本敘事（文件）：`validate:upgrade-proposal`、`validate:map-curator`、`validate:behavior-pack`、`validate:conversation-evolution` 等。

### 1.6 Strangler／legacy 表面

- 範例：`examples/legacy-strangler-minimal/` — 不先重寫 legacy，用 atom wrapper 包一層入口。
- 正式協議：`docs/MAP_REPLACEMENT_PROTOCOL.md` — **map 擁有組合語意**；replacement 模式與 registry 狀態 **分欄**。
- Decomposition police／taxonomies 把過大表面導向 **atomize＋map replacement**，不是另開 `strangler` CLI。

### 1.7 Atom space layout

文件：`docs/ATOM_SPACE_LAYOUT.md`  
實作：`packages/core/src/manager/atom-space.ts`（map 對應 `map-generator`）

```text
atomic_workbench/atoms/<atomId>/   → atom.spec.json, atom.test.ts, atom.test.report.json
atomic_workbench/maps/<mapId>/     → map.spec.json, map.integration.test.ts, map.test.report.json
```

規則：資料夾名＝ID 精確字串；禁止平行 alias；registry `location.workbenchPath` 預設指此；空 `atom.*` 目錄當殘留刪除。

同時：粗覆蓋 `atomic_workbench/atomization-coverage/path-to-atom-map.json`（＋shards／receipts）— **path→owner**，非 symbol／CID 級。

### 1.8 Registry progression 與 replacement lane

| 概念 | 路徑 | 狀態／模式 | 與 registry 關係 |
|------|------|------------|------------------|
| Replacement lane | `packages/core/src/registry/replacement-lane/*`；CLI `replacement-lane.ts` | `draft`→`shadow`→`canary`→`active`→`legacy-retired` | **獨立欄位**；粗同步：draft→registry draft；shadow／canary→validated；active／legacy-retired→active |
| Progression policy | `packages/core/src/registry/progression-policy.ts` | automation `off`｜`proposal-only`；gates 存在 `atomic_workbench/maps/<mapId>/replacement.progression-policy.json` | 產出 `pending-human-approval` 提案，不自動 promote |
| Lineage backfill | MAP_REPLACEMENT_PROTOCOL；`registry lineage backfill` | 成員 `versionLineage` | 寫 lineage-log；報告在 `.atm/history/reports/registry-lineage-backfill/` |

**命名警示（對 VAI）：** replacement 的 **`shadow`** 已被佔用；VAI／Atlas **禁止**再用 shadow 當產品名（見既有 `VIRTUAL_ATOM_INDEX_ANALYSIS.md`／`ATOM_CREATE_MAP_REUSE_AUDIT.md`）。

### 1.9 Atomize／create CLI 家族

#### `atm create` / `atm create-map`

- `packages/cli/src/commands/create.ts` — 物理 scaffold＋註冊 workbench atom（可 `--dry-run`）
- `packages/cli/src/commands/create-map.ts` — 從 plan／spec 建 map＋註冊

→ 這是 **正式 registry 誕生** 路徑，不是 VAI 寫入。

#### `atm atomize`（遠不止 create）

規格：`packages/cli/src/commands/command-specs/atomize.spec.ts`  
實作：`packages/cli/src/commands/atomize.ts`＋`scripts/src/atomize-*.js`

| Subcommand | 作用 |
|------------|------|
| `inventory` | 覆蓋盤點 → coverage 報告 |
| `score` | dogfood 分數 → `atomic_workbench/atomization-coverage/dogfood-score.*` |
| `backfill` | `--dry-run` 提案／`--apply` 寫 generatedDraft 治理產物（**非**直接改 production） |
| `register-receipt` | 路徑登記收據＋shard |
| `snapshot` | 任務前後原子化快照 |
| `verify-task` | 任務 atom／map／path delta 驗證 |

**尚無**落地的 `atomize --refactor`（VAI 分析列為未來 opt-in L4）；`planAtomize` 在 JS adapter 強制 dry-run／委派 bridge。

#### 其他相關 CLI

- `atm police run`
- `atm upgrade`（propose／map-propose／`--scan`）
- `atm replacement-lane transition`
- `atm registry`／`registry-diff`／lineage backfill

---

## 2. 與 VAI／`.atm/atlas` 的銜接點與衝突點

既有 VAI 敘事：`/workspace/reports/atm-v2-harness/VIRTUAL_ATOM_INDEX_ANALYSIS.md`、`ATOM_CREATE_MAP_REUSE_AUDIT.md`。  
現況：repo 的 `.atm/` 有 charter／history／runtime／catalog 等，**尚無** `.atm/atlas/`。

### 2.1 建議銜接點（應 EXTEND，勿重造）

| VAI 層 | 掛接既有表面 | 說明 |
|--------|--------------|------|
| L0 即時 discover | `discoverAtomCandidates`（language-js／python／csharp）；`computeCandidateAtomCid`（`packages/core/src/broker/candidate-bridge.ts`） | 身分公式已存在 |
| L1 Index 持久化 | **新建** `.atm/atlas/index.json`（或分片）；API 鄰近 broker／plugin-sdk | 補「預設不落盤」缺口 |
| Locate | `createContentAnchor`／`resolveContentAnchor`；contentHash；range 僅快取 | 與 stale／re-anchor 一致 |
| Admit | WriteIntent／AGR／`VirtualAtomCandidate`／bounded region | claim／compose **消費** atlas 的 atomCid |
| Coarse owner | path-to-atom map／shards＋`atomize register-receipt`／inventory／score | 可選加 CID 外鍵，命令面不變 |
| L2 Map | atomic map＋**map curator**（compose／merge／sweep／broker-split） | 跨檔組合仍走 curator 提案，不由 atlas 直接改 map |
| L3 註解 | `.atm/atlas/annotations/` | advisory only，不可當 gate |
| L4 物理 | `atm create`／未來 `atomize --refactor`／`behavior.atomize`＋police＋propose | opt-in；升格＝正式治理 |
| 演化回饋 | experience-loop／close → 「升成 registry atom」提案 → create＋register-path | 與 evolution-draft 同一「advisory→gates」哲學 |
| 共享寫入治理 | 視同 `.atm/runtime/write-broker.registry.json` 類 **shared surface** | 多 agent 寫 atlas 需 ticket／steward |

### 2.2 衝突／雙重真相風險

| 風險 | 衝突對象 | 若 VAI 做錯會怎樣 |
|------|----------|-------------------|
| 第二套正式 registry | `atomic-registry.json`、capsule／map registries、status-machine | 雙 SSOT、升格旁路、police／quarantine 失效 |
| 誤用 shadow 命名 | replacement-lane `shadow`、validator shadow | 語意撞車、文件／CLI／論文敘事混亂 |
| 把 atlas 當 workbench | `atomic_workbench/atoms\|maps/<ID>/` | 違反 ATOM_SPACE_LAYOUT；scaffold／test／registry path 漂移 |
| 自動 promote | ReviewAdvisory／HumanReview／behavior guards／progression `proposal-only` | 違反 ATOM_EVOLUTION_PLAN 核心規則 |
| 與 VirtualAtomInUse 混淆 | `buildVirtualAtomInUseRegistry`（lease 占用） | 把短租占用當跨任務索引 |
| 與 path-to-atom 平行 | coverage shards | 第三套 path 真相；inventory／score 失真 |
| 第三套正式 ID | `ATM-*`／`atm.*` owner id／atomCid | 已有 sidecar 銜接；再發明正式 ID 會炸 claim |
| CID 公式漂移 | `computeCandidateAtomCid`（實作含 lineSignature） | stale 誤判或身分分裂；需版本化遷移 atlas |
| Police 繞過 | family advisory-only、rollback／evidence-integrity、adopter-neutrality | 低信心候選直接 parallel-safe／污染上游 |
| Curator 短路 | map-curator 只出 draft | atlas 直接改 map members／edges |
| Behavior.atomize 混進預設 refresh | status-machine draft→active | 每次 claim 觸發「誕生」級突變 |
| `.atm/atlas` 無治理寫入 | shared-surface／broker | 與 compose-first／INV 並行假設衝突 |

### 2.3 行為／警察如何「看見」VAI（設計暗示）

- **atomization／demand／decomposition police**：可讀 atlas 高信心候選當 finding 輸入，但仍只出 **proposal-draft／routeHint**，不寫 registry。
- **evolution police**：atlas stale（hash 不符）可視為 observation／reconfirm 訊號，對齊 base version／watermark 檢查。
- **map-integration police**：仍以 curator report 為準；atlas 可提供 broker-split 的 region／CID 證據，不替代 curator。
- **quality／rollback**：物理升格或 map replacement 才進入；VAI 寫入本身不應觸發 equivalence／retirement 門檻（除非走 L4）。
- **noise-control／daily cap**：atlas 大量低信心候選必須進 suppression／cap，避免提案洪水。

---

## 3. 設計約束（必守／勿碰）

### 3.1 必守

1. **證據／索引 ≠ 許可**：VAI 持久化與 refresh 不得直接 mutate `atomic-registry.json`、workbench specs、或 replacement mode。
2. **CID 主鍵對齊** `computeCandidateAtomCid`；path／symbol 為 locator；hash 不符 → `stale`／needs-reconfirm。
3. **升格唯一正路**：高信心候選 →（可選）experience／curator／evolution draft → `ReviewAdvisory`＋`HumanReviewDecision` → `behavior.*`／`atm create`／register-path → status-machine。
4. **單 atom 演化走 `behavior.evolve`→ProposeAtomicUpgrade**；結構走 compose／merge／dedup-merge／sweep（curator 子集）。
5. **Replacement 與 registry 分欄**；progression 預設 `off`／最多 `proposal-only`。
6. **Atom／map 空間**：一 ID 一 canonical folder；新產物預設進 `atomic_workbench/...`。
7. **`.atm/atlas` 當 shared surface**：多寫者需既有 ticket／steward／broker 類治理，不可當無治理旁路。
8. **Police advisory-only**：新索引不得提供 registry-mutation／auto-approve／direct-promotion／bypass-review。
9. **Adopter neutrality**：atlas annotations／AI 描述不得污染 upstream 受保護檔或 CID 身分層。
10. **物理重構 opt-in**：`planAtomize`／未來 refactor 保持 dry-run→任務卡；與 atlas refresh **不同開關**。
11. **path-to-atom 只延伸**：inventory／score／register-receipt／backfill 命令語意保持；VAI 補細粒度。
12. **公開文件邊界**：框架契約維持 adopter-neutral；宿主實驗不反向變成核心硬性需求（見 ATOM_EVOLUTION_PLAN）。

### 3.2 勿碰

1. **勿**新建平行「虛原子 registry」當正式生命週期 SSOT。
2. **勿**用 `shadow` 命名 Atlas／VAI／目錄／CLI。
3. **勿**讓 `.atm/atlas` 寫入等同 `behavior.atomize`／`atm create` 副作用。
4. **勿**讓 claim 空 `atomRefs` 的弱路徑成為 VAI 成功標準；應推動「有 CID／anchor 才算完整 intent」。
5. **勿**把 `VirtualAtomInUseRegistry`、candidates rank 報告目錄、或旁掛 `*.atm` 檔當 SSOT（旁掛僅可為唯讀投影）。
6. **勿**發明第三套正式 atom ID 生態。
7. **勿**靜默改 CID 公式而不做 atlas 遷移版本。
8. **勿**讓 map curator／upgrade propose 被 atlas「自動 apply」取代。
9. **勿**把 replacement-lane 證據門檻（equivalence／propagation／retirement）套到單純 index refresh，或反過來用 index 冒充 equivalence。
10. **勿**在 core 再拆新 publishable behavior package；新行為細節進 `plugin-behavior-pack`（taxonomy 規則）。
11. **勿**讓 police／lifecycle-police 以外的 actor 寫 quarantine。
12. **勿**把 host-local 偏好（格式／工作流）經 VAI 自動升成 global atom contract。

---

## 4. 路徑索引（速查）

| 主題 | 主要路徑 |
|------|----------|
| Behavior taxonomy | `docs/governance/behavior-taxonomy.md` |
| Behavior pack | `packages/plugin-behavior-pack/src/` |
| Behavior 契約 | `packages/plugin-sdk/src/behavior.ts`、`lifecycle.ts` |
| Police roles | `packages/core/src/police/roles/`、`role-registry.ts`、`family.ts`、`index.ts` |
| Evolution plan | `docs/ATOM_EVOLUTION_PLAN.md` |
| Evolution draft／scan | `packages/core/src/upgrade/evolution-draft.ts`；`packages/cli/src/commands/upgrade/scan.ts` |
| Propose／gates | `packages/core/src/upgrade/propose.ts`、`propose/gates.ts` |
| Map curator | `packages/core/src/upgrade/map-curator.ts`、`map-curator/types.ts` |
| Status machine | `packages/core/src/registry/status-machine.ts` |
| Replacement lane | `packages/core/src/registry/replacement-lane/`；`docs/MAP_REPLACEMENT_PROTOCOL.md` |
| Progression | `packages/core/src/registry/progression-policy.ts` |
| Atom space | `docs/ATOM_SPACE_LAYOUT.md`；`packages/core/src/manager/atom-space.ts` |
| Atomize CLI | `packages/cli/src/commands/atomize.ts`；`scripts/src/atomize-{inventory,score,backfill}.js` |
| Create／create-map | `packages/cli/src/commands/create.ts`、`create-map.ts` |
| CID bridge | `packages/core/src/broker/candidate-bridge.ts` |
| VAI 前序分析 | `reports/atm-v2-harness/VIRTUAL_ATOM_INDEX_ANALYSIS.md`、`ATOM_CREATE_MAP_REUSE_AUDIT.md` |
| Strangler 範例 | `examples/legacy-strangler-minimal/` |

---

## 5. 調查邊界

- 只讀 catalog；未改程式、未開 GitHub issue／PR。
- 以 `packages/` 與 `docs/` 為準；`release/atm-root-drop/` 為發行鏡像，語意與上表同源。
- 未執行完整 test suite；行為語意以原始碼與公開 docs／既有 harness 報告交叉核對。

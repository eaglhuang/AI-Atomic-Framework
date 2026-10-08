# ATM Atom／Map 建立與覆蓋機制複用稽核

**目的**：在導入 Virtual Atom Index（VAI）／Shadow Atlas 之前，釐清既有建立、覆蓋、錨定管線，避免平行造輪。  
**範圍**：`/workspace/AI-Atomic-Framework`（唯讀稽核；無 GitHub 寫入、無程式碼變更）  
**日期**：2026-10-06（Asia/Taipei／CST）  
**相關既有分析**：`/workspace/reports/atm-v2-harness/VIRTUAL_ATOM_INDEX_ANALYSIS.md`

---

## 一句結論

ATM **已有**物理原子出生（`create`／AtomGenerator）、Map 出生（`create-map`／generateAtomicMap）、粗粒度 path→owner 覆蓋（path-to-atom shards）、細粒度定位（content-anchor）、以及候選→WriteIntent 橋（candidate-bridge／CID）。  
**缺口不是「沒有索引語意」**，而是 **discoverAtomCandidates 結果沒有預設持久化進可 claim／compose 的身分層**。VAI 應 **掛在既有管線上延伸**，不要另起一套 registry／atlas／shadow 命名系統。

---

## 1. 已有機制清單（可複用）

### 1.1 物理 Atom 建立：`atm create` → AtomGenerator

| 項目 | 內容 |
|------|------|
| CLI | `node atm.mjs create --bucket <BUCKET> --title ... --description ... [--logical-name ...] [--dry-run]` |
| Guide intent | `atm guide create-atom`（導向同一條 `create`；**命令名是 `create` 不是 `create-atom`**） |
| 實作 | `packages/cli/src/commands/create.ts` → `packages/core/src/manager/atom-generator.ts`（`generateAtom`） |
| 文件 | `docs/ATOM_GENERATOR.md` |
| ID | `ATM-{BUCKET}-{NNNN}`（`id-allocator`） |
| 寫入檔案 | `atomic_workbench/atoms/<atomId>/atom.spec.json`、`atom.source.mjs`、`atom.test.ts`、`atom.test.report.json` |
| Registry | 更新 `atomic-registry.json` + `atomic_workbench/registry-catalog.md` |
| Schema | `schemas/atomic-spec.schema.json`；spec 上 `schemaId: atm.atomicSpec` |

管線（文件與程式一致）：

```text
atm create → generateAtom() → allocateAtomId() → scaffoldAtomWorkbench()
  → runAtomicTestRunner() → createAtomicRegistryEntry() → writeRegistryArtifacts()
```

### 1.2 物理 Map 建立：`atm create-map` → generateAtomicMap

| 項目 | 內容 |
|------|------|
| CLI | `node atm.mjs create-map`（inline JSON／`--spec`／`--from-plan`） |
| 實作 | `packages/cli/src/commands/create-map.ts` → `packages/core/src/manager/map-generator.ts` |
| ID | `ATM-MAP-{NNNN}` |
| 寫入檔案 | `atomic_workbench/maps/<mapId>/map.spec.json`、`map.integration.test.ts`、`map.test.report.json` |
| Registry | 同一套 `atomic-registry.json`／catalog |
| Schema | `schemas/registry/atomic-map.schema.json`；`schemaId: atm.atomicMap` |
| 輸入轉換 | `createAtomicMapRequestFromDecompositionPlan`（`packages/core/src/registry/decomposition-plan.ts`） |

### 1.3 原子化覆蓋（path→owner，粗粒度）

| 命令 | 腳本／模組 | 主要輸出 |
|------|------------|----------|
| `atm atomize inventory` | `scripts/src/atomize-inventory.js` | 覆蓋盤點報告（evidence 內；對照 exclusion／path map） |
| `atm atomize score` | `scripts/src/atomize-score.js` | `atomic_workbench/atomization-coverage/dogfood-score.json`、`.md`；run metadata 在 `.atm-temp/...` |
| `atm atomize backfill`（預設 dry-run；`--apply`） | `scripts/src/atomize-backfill.js` | `atom-backfill-proposal.json`；apply 另寫 `atom-backfill-applied.json`、`atom-backfill-rollback.md`（**只動治理產物，不動 production source**） |
| `atm atomize register-receipt` | → helper `register-path` | 寫入 owner shard + 合併投影 + receipt |
| `atm atomize snapshot`／`verify-task` | 同 helper | `task-snapshots/<TASK>/before|after.json`；驗證 delta |

**register-path 精確用法**（CLI 包裝後等同）：

```bash
node scripts/src/atomization-register-receipt.js register-path \
  --repo . --task TASK-ID \
  --shard atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json \
  --path-pattern packages/cli/src/commands/foo.ts \
  --atom-id atm.foo-map --capability "..." \
  [--source-task TASK-ID] [--map-id atm.some-map]
```

或：

```bash
node atm.mjs atomize register-receipt --repo . --task TASK-ID \
  --shard ... --path-pattern ... --atom-id ... --capability "..."
```

**權威分片（寫）→ 投影（讀）**：

- SSOT shards：`atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-*.json`
- Manifest：`.../path-to-atom-map-shards/manifest.json`（`atm.pathToAtomMapShards.v1`）
- Merge：`.../path-to-atom-map-shards/merge.js`
- 投影：`atomic_workbench/atomization-coverage/path-to-atom-map.json`（`atm.pathToAtomMap.v1`）
- CID sidecar：`atomic_workbench/atomization-coverage/atom-id-to-cid.json`（`atm.atomIdToCid.v2`）
- 政策 SSOT：`docs/ATOMIZATION_COVERAGE_TAXONOMY.md`
- Receipts：`atomic_workbench/atomization-coverage/receipts/<TASK>/...`

**覆蓋列語意**：`path_pattern`（可含 `#fragment` 邏輯區，如 `batch/implementation.ts#checkpoint-readiness`）→ `atom_id`／capability／coverage_status。  
這是 **檔／目錄／偶發 logical fragment 的 owner map**，**不是** symbol＋contentHash 虛原子索引。

### 1.4 Content-anchor：符號／內容雜湊定位（無須物理拆檔）

| 項目 | 路徑 |
|------|------|
| Create | `packages/core/src/broker/boundaries/content-anchor.ts`（`createContentAnchor`） |
| Resolve | `packages/core/src/broker/boundaries/resolver.ts`（`resolveContentAnchor` → `resolved`／`stale`／`ambiguous`／`unsupported`） |
| Schema | `schemas/governance/content-anchor.schema.json`；也嵌在 `write-intent.schema.json` |
| 身分欄位 | `preimageDigest`、`symbolName`、`astPath`、`fileDigest`；`location`（行號）僅輔助 |
| Rename | path 變更 → `stale`，需 re-anchor |

### 1.5 WriteIntent／atomRefs：宣告綁定，不要求物理拆檔

| 項目 | 路徑 |
|------|------|
| 型別 | `packages/core/src/broker/types.ts`（`WriteIntent`、`WriteIntentAtomRef`） |
| Schema | `schemas/governance/write-intent.schema.json`（`atm.writeIntent.v1`） |
| 橋接 | `packages/core/src/broker/candidate-bridge.ts`（`candidatesToWriteIntent`、`computeCandidateAtomCid`） |

`WriteIntentAtomRef` 可攜：`atomId`、`atomCid`、`operation`、可選 `contentAnchors[]`、可選 `sourceRange`。  
Broker／composer／AGR 依 **CID／range／anchor** 裁決並行，INV-ATM-010 compose-first：**共享物理檔可 compose**，工人宣告邊界即可。

注意：schema **允許空 `atomRefs`**（僅 `targetFiles`）；claim 路徑常因此變弱——VAI 應把「有錨／有 CID 才算完整 intent」變成預設，而不是另造 admission。

**CID 實際公式**（以程式為準，含 lineSignature）：

```text
SHA-256( kind || symbol || sortedSourcePaths || `${lineStart}:${lineEnd}` || detectionMethod )
```

註：部分敘事文件寫「不含行號」；**實作與測試（`candidate-bridge.test.ts`）會因行號改變 CID**。VAI 持久化時必須與 `computeCandidateAtomCid` 對齊，或明確做公式演進＋遷移。

### 1.6 候選發現（記憶體／報告，非虛原子 SSOT）

| 層 | 位置 | 持久化？ |
|----|------|----------|
| SDK 契約 | `packages/plugin-sdk/src/atomization-planning.ts`：`AtomCandidate`、`discoverAtomCandidates`、`planAtomize`（**強制 `dryRun: true`**）、`VirtualAtom`、`enclose?` | 型別／guard only |
| JS | `packages/language-js/src/language-js-adapter.ts`：`discoverJavaScriptAtomCandidates`；**`planAtomize` 未實作**；**無 `enclose`** | 否（回傳陣列） |
| Python | `packages/language-python/src/language-python-adapter/planning.ts`：discover + dry-run plan | 否 |
| C# | `packages/language-csharp` 存在 | 未見等同 AtomizationPlanning 完整落地於本稽核路徑 |
| Bridge | `candidate-bridge.ts` | **純函式，不落盤** |
| CLI `atm candidates rank` | `packages/cli/src/commands/candidates.ts` | 寫 `.atm/history/reports/candidates/...`（**legacy 檔案風險排序**，≠ `AtomCandidate`／CID） |

### 1.7 執行期「虛擬原子在用」投影（lease 期，非 Atlas）

| 項目 | 路徑 |
|------|------|
| `VirtualAtomInUseRegistryDocument` | `packages/core/src/broker/registry.ts`（`buildVirtualAtomInUseRegistry`） |
| AGR `VirtualAtomCandidate` | `packages/core/src/broker/agr.ts`；由 `WriteIntent.atomRefs.sourceRange` 投影（`decision/decomposition.ts`） |
| Broker registry 檔 | 慣例 `.atm/runtime/write-broker.registry.json`（本快照當下未必存在；由 register／team-lane 生命週期寫入） |

這是 **active intent 的在用投影**（有 TTL／lease），**不是**跨任務的長期虛原子目錄。

### 1.8 其他相關（勿混淆）

- **Map curator／split suggestion**：`packages/core/src/upgrade/map-curator*`、`docs/reports/split-suggestion-evidence/` — 提案拆細 coarse owner，不是 VAI。
- **Replacement lane `shadow`**：`docs/MAP_REPLACEMENT_PROTOCOL.md`、`atm replacement-lane` — map 替換 rollout（draft→shadow→canary→active），**禁止借用為 Atlas 名**。
- **Bounded region（proposal admission）**：broker proposal 上的行列區間仲裁；與 path-to-atom、VAI 層級不同。
- **Active read-set**：`conflict-matrix`／`resource-overlap` 的 `active-read` — 讀依賴對稱 admission，不是索引。

---

## 2. 看似重複、其實不同的東西

| 名稱 A | 名稱 B | 差異（勿合併當同一 SSOT） |
|--------|--------|---------------------------|
| `atm create` 物理 atom | `discoverAtomCandidates`／VAI 候選 | 前者寫 workbench＋registry；後者是語意候選／CID，預設不拆檔 |
| `atomic-registry.json` | path-to-atom-map／shards | Registry＝正式 atom／map 生命週期；path map＝production path **所有權覆蓋** |
| path-to-atom `atom_id`（如 `atm.cli-router`） | `ATM-CORE-0004` 正規 ID | 兩套 ID 生態並存；靠 `atom-id-to-cid.json` 等 sidecar 銜接，勿再發明第三套「正式 ID」 |
| `VirtualAtom`（plugin-sdk） | `VirtualAtomCandidate`（AGR） | SDK＝enclose／layer 契約；AGR＝intent 上的 range 衝突投影 |
| `VirtualAtomInUseRegistry` | 建議的 `.atm/atlas` | In-use＝lease 內占用；Atlas／VAI＝跨任務可刷新的候選索引 |
| `atm candidates rank` 報告 | `AtomCandidate`＋CID | Rank＝legacy 熱點排序產物；CID bridge＝admission 身分 |
| content-anchor | candidate CID | Anchor＝內容／符號 **定位與 freshness**；CID＝候選 **穩定身分**（目前還綁 lineSignature） |
| path `#fragment` | symbol＋hash region | Fragment 是人工 logical 標籤；不是可 resolve 的 content-anchor |
| replacement-lane `shadow` | Shadow Atlas 構想 | 完全不同語意域；Atlas 應用 `atlas`／`region-index`／`vai` |

---

## 3. 若做 VAI，應掛在哪條既有管線

建議 **單一掛接點**：候選發現 → CID 橋 →（**新增持久化**）→ WriteIntent／claim → broker。

| 步驟 | 掛接模組／檔案／命令 | 角色 |
|------|----------------------|------|
| 1 Discover | `AtomizationPlanningAdapter.discoverAtomCandidates`（JS／Python 既有；強化 enclose） | 即時候選 |
| 2 Identity | `packages/core/src/broker/candidate-bridge.ts`（`computeCandidateAtomCid`／`candidatesToWriteIntent`） | **唯一 CID 公式** |
| 3 Persist（缺口） | 新建讀寫層讀寫 `.atm/atlas/`（或分片），但 **API 應活在 core broker／plugin-sdk 旁**，由 `atm atomize` 或 doctor／claim 觸發 refresh | L1 Index |
| 4 Locate | 複用 `createContentAnchor`／`resolveContentAnchor`；VAI 列存 `contentHash`／anchorId，行號只快取 | 勿另造定位語意 |
| 5 Admit | 既有 WriteIntent＋broker decision／AGR／proposal bounded region | 消費 VAI 的 atomCid |
| 6 Coarse owner | path-to-atom shards：可選 **延伸** mapping 欄位（symbol／cid／hash），或 VAI→owner 外鍵；**不要**平行第二套 path map | 覆蓋仍走 register-path |
| 7 Promote | 升格正式 atom 時走 `atm create`／AtomGenerator＋register-path；物理拆檔走 `planAtomize` dry-run → 任務卡 → opt-in refactor | L4 仍 opt-in |
| 8 Governance | `.atm/atlas` 視為 **shared surface**（與 write-broker registry 同類），多 agent 寫入需 ticket／steward | 見既有 shared-surface 投影 |

**不要**把 VAI 掛成：

- 第二套 `atomic_workbench/atoms/` 影子目錄；
- 與 `atomic-registry.json` 平行的「虛原子 registry」當正式生命週期；
- 旁掛 `*.cs.atm` 當 source of truth（最多做唯讀投影）。

---

## 4. 明確「不要新建」的清單

1. **不要**新建平行的 atom／map 出生 CLI（已有 `create`／`create-map`／AtomGenerator／MapGenerator）。  
2. **不要**新建第二套 path→owner 投影目錄（已有 shards＋`path-to-atom-map.json`＋register-path）。  
3. **不要**新建第二套 CID 公式（必須呼叫／演進 `computeCandidateAtomCid`）。  
4. **不要**新建第二套內容定位語意（必須延展 content-anchor）。  
5. **不要**用 `shadow` 命名 Atlas／VAI（reserved：replacement-lane／validator shadow）。  
6. **不要**把 `VirtualAtomInUseRegistry` 擴成長期索引（那是 lease 占用投影）。  
7. **不要**把 `atm candidates rank` 報告目錄當成 VAI SSOT。  
8. **不要**預設要求物理拆檔才能 claim（已有 compose-first＋anchor／range；缺的是持久化與預設綁錨）。  
9. **不要**讓 `.atm/atlas` 繞過 shared-surface／broker 治理。  
10. **不要**另造「正式 atom ID」命名空間取代 `ATM-*`／既有 readable `atm.*`／CID 三者既有分工。

---

## 5. 最小銜接設計（7 點）

1. **Persist discover**：對 touched files 呼叫既有 `discoverAtomCandidates`，經 `computeCandidateAtomCid` 寫入 `.atm/atlas/index.json`（或按 owner／path 分片）；欄位最小集：`atomCid`、`kind`、`symbol`、`sourcePaths`、`detectionMethod`、`contentHash`／`anchorId`、`confidence`、`status(fresh|stale)`、可選 `lineRange` 快取。  
2. **Locator＝content-anchor**：refresh 時 `resolveContentAnchor`；hash／symbol 不符 → `stale`，禁止靜默沿用舊 range。  
3. **Claim／compose 預設吃 VAI**：組 WriteIntent 時優先填 `atomRefs[].atomCid`＋`contentAnchors`／`sourceRange`；逐步收緊「僅 targetFiles、空 atomRefs」的預設路徑。  
4. **CID 契約對齊**：文件與實作統一（目前實作含 lineSignature）；若要「符號穩定、行號可漂移」，應 **版本化演進公式** 並遷移 atlas，而不是旁路 hash。  
5. **path-to-atom 只 EXTEND**：保留 path→owner；可選加 `primary_atom_cid`／symbol 欄，或由 VAI 反查 owner；register-path／inventory／score **命令面不變**。  
6. **enclose 補齊**：JS／TS（與 Python）落地 `enclose()`，AGR Layer-1 虛擬邊界才有 adapter 真相；缺 enclose 維持 `partial`／advisory（見 `docs/BROKER_GUIDE.md`）。  
7. **升格與重構分流**：experience／close 可提案「升成 registry atom」→ `atm create`＋register-path；`planAtomize`／未來 `atomize --refactor` 保持 dry-run→任務卡→opt-in，**永不**與 VAI 寫入混成同一預設開關。

---

## 6. 對照調查問題的直接答案

### Q1 create-atom／AtomGenerator／generateAtomicMap／create-map 寫什麼？

- CLI：`create`、`create-map`（guide 的 create-atom 只是意圖名）。  
- 寫：`atomic_workbench/atoms|maps/<ID>/...`、`atomic-registry.json`、catalog。  
- ID：`ATM-{BUCKET}-{NNNN}`／`ATM-MAP-{NNNN}`。

### Q2 覆蓋管線命令與輸出？

見 §1.3；核心權威在 **shards**，投影在 **path-to-atom-map.json**，backfill／score／receipts 在 `atomic_workbench/atomization-coverage/`。

### Q3 content-anchor 與 WriteIntent 如何不拆檔綁定？

Intent 宣告 `atomRefs`＋可選 anchors／sourceRange → broker 用 CID／range／overlap 仲裁；物理檔可共享。Rename／內容變 → resolve `stale`。

### Q4 candidate-bridge／discover 有無已存 `.atm/` 或 workbench？

- **discover／bridge：預設不持久化。**  
- `atm candidates rank` 會寫 `.atm/history/reports/candidates/`，但是 **另一產品面**。  
- 無既有 `.atm/atlas/` 目錄。

### Q5 atlas／region／virtual registry／taxonomy？

- Taxonomy：`docs/ATOMIZATION_COVERAGE_TAXONOMY.md`。  
- Virtual in-use：`atm.virtualAtomInUseRegistry.v1`（執行期）。  
- VirtualAtom 型別：plugin-sdk。  
- **無** Shadow Atlas／VAI 落地目錄；region 多指 proposal bounded region 或 path `#fragment`。

### Q6 Overlap：新 `.atm/atlas` 會重複什麼？應 EXTEND 什麼？

| 會重複（避免） | 應延伸（建議） |
|----------------|----------------|
| 再做一套 path→owner | path-to-atom shards 欄位／外鍵到 CID |
| 再做一套 CID／anchor | candidate-bridge＋content-anchor |
| 再做物理 atom 目錄當索引 | `.atm/atlas` 只存虛擬索引；升格走 create |
| shadow／in-use 命名混用 | 新名 `atlas`／`vai`；in-use 維持 lease 投影 |

---

## 7. 關鍵路徑速查（給實作者）

```text
packages/cli/src/commands/create.ts
packages/cli/src/commands/create-map.ts
packages/cli/src/commands/atomize.ts
packages/core/src/manager/atom-generator.ts
packages/core/src/manager/map-generator.ts
packages/core/src/broker/candidate-bridge.ts
packages/core/src/broker/boundaries/content-anchor.ts
packages/core/src/broker/boundaries/resolver.ts
packages/core/src/broker/registry.ts          # VirtualAtomInUseRegistry
packages/core/src/broker/agr.ts
packages/plugin-sdk/src/atomization-planning.ts
packages/language-js/src/language-js-adapter.ts
packages/language-python/src/language-python-adapter/planning.ts
scripts/src/atomization-register-receipt.js
scripts/src/atomize-backfill.js
scripts/src/atomize-inventory.js
scripts/src/atomize-score.js
atomic_workbench/atomization-coverage/path-to-atom-map-shards/
docs/ATOMIZATION_COVERAGE_TAXONOMY.md
docs/ATOM_GENERATOR.md
docs/BROKER_GUIDE.md
schemas/governance/write-intent.schema.json
schemas/governance/content-anchor.schema.json
```

---

## 8. 稽核方法與限制

- 方法：repo 內路徑／CLI／schema／腳本交叉檢索與抽樣讀檔；對照既有 `VIRTUAL_ATOM_INDEX_ANALYSIS.md`。  
- 限制：未執行 live `atm create`／`atomize`（避免寫入）；C# adapter 僅確認套件存在，未做完整行為驗證。  
- 產出：本檔 `/workspace/reports/atm-v2-harness/ATOM_CREATE_MAP_REUSE_AUDIT.md`。

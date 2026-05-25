<!-- doc_id: doc_governance_0001 -->
# ATM 100% 原子化覆蓋口徑與排除政策

## 版本
- 版本: 1.1
- 日期: 2026-05-25
- 來源任務: TASK-ASA-0001（任務契約保存在 upstream planning repo；本文件是 ATM repo 內的政策 SSOT）
- 上一版: 1.0 (2026-05-21)
- 變更: 1.1 把 exclusion reason / dogfood score / path-to-atom map 三個草案升級為正式 JSON Schema 區塊，作為後續 guard 與 validator 的 SSOT

## 1. Production Source 分類規則

### 1.1 必須被 Atom/Map 覆蓋的路徑

以下路徑被視為 **production source**，必須被 atom 或 map 擁有：

```
packages/*/src/**/*.{ts,js}    # 所有 package source
packages/*/types/**/*.{d.ts}   # TypeScript 型別定義
scripts/src/**/*.ts            # 構建腳本（生成的部分除外）
integrations/**/*.{ts,js}      # 集成適配器
```

### 1.2 自動排除的路徑（Generated/Fixture/Output）

以下路徑 **自動排除** 於 ownership coverage 之外，但必須記錄排除原因：

```
dist/**                        # 編譯輸出
build/**                       # 構建輸出
release/**                     # 發布產物
*.gen.ts                       # 自動生成的型別
*.gen.json                     # 自動生成的配置
fixtures/**                    # 測試 fixture
specs/samples/**               # 規範範例
tests/**/*.snapshot.*          # 快照測試結果
atomic_workbench/generators/**/(outputs|artifacts)/**  # 生成器輸出
```

### 1.3 可選覆蓋路徑

以下路徑可選擇被 atom/map 覆蓋，或明確標記 `exclusion_reason`：

```
examples/**                    # 示例代碼
docs/**                        # 文檔（高級別架構除外）
samples/**                     # 示例應用
```

## 2. Exclusion Reason Schema

所有被排除的路徑必須使用標準 schema 記錄排除原因。下方為機器可讀的 JSON Schema 草案（草案編號 `atm.exclusionInventoryEntry.v1`），後續 guard / validator 直接依本節欄位驗收 `atomic_workbench/atomization-coverage/exclusion-inventory.json` 的每一筆 entry。

### 2.0 JSON Schema 草案 (`atm.exclusionInventoryEntry.v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "atm.exclusionInventoryEntry.v1",
  "title": "ATM Atomization Coverage Exclusion Entry",
  "type": "object",
  "additionalProperties": false,
  "required": ["path", "reason", "provenance"],
  "properties": {
    "path": {
      "type": "string",
      "description": "排除的 path 或 glob（相對於 ATM repo root）"
    },
    "reason": {
      "type": "string",
      "enum": [
        "generated",
        "fixture",
        "snapshot",
        "doc",
        "example",
        "test-only",
        "internal-only"
      ],
      "description": "排除原因（受控字彙；新類別必須先擴充本 schema）"
    },
    "owner_atom_id": {
      "type": "string",
      "pattern": "^atom-[a-z0-9-]+$",
      "description": "若有對應 owner atom，需符合 readable ref 命名"
    },
    "provenance": {
      "type": "string",
      "minLength": 1,
      "description": "生成或維護來源的人類可讀說明"
    },
    "valid_until": {
      "type": "string",
      "format": "date-time",
      "description": "暫時性排除的失效時間（RFC3339）"
    },
    "notes": {
      "type": "string",
      "description": "附加說明（中文或英文）"
    }
  }
}
```

`exclusion-inventory.json` 必須是 entry 陣列；每個 entry 都必須通過上述 schema。陣列 top-level 不另外包裝，以維持 `scripts/src/atomize-inventory.js` 直接 `JSON.parse(...)` 後當作 list 使用的契約。

### 2.1 排除原因分類

| 原因 | 定義 | 範例 |
|---|---|---|
| `generated` | 由 ATM generator / build script / tool 自動生成 | `*.gen.ts`, `dist/**` |
| `fixture` | 測試 fixture、mock data、snapshot | `tests/fixtures/**`, `*.snapshot` |
| `snapshot` | 回歸測試 snapshot（自動比對） | `tests/**/*.snap` |
| `doc` | 文檔或示例代碼（非 production logic） | `docs/**`, `examples/**` |
| `example` | 示例應用或參考實現 | `examples/**`, `samples/**` |
| `test-only` | 測試程式碼（非 production coverage 對象） | `tests/**/*.ts` |
| `internal-only` | 內部實用工具（不是 public contract） | `scripts/internal/**` |

## 3. 100% Dogfood Score 定義

### 3.1 得分欄位

```typescript
interface DogfoodScore {
  // 所有權覆蓋
  source_ownership_coverage: number;           // 0-100: 被 atom/map 擁有的 production source %
  source_ownership_debt: number;               // production source 路徑數，未被覆蓋的
  
  // 入點原子化
  public_command_coverage: number;             // 0-100: 有 atom/map spec 的 CLI command %
  command_with_readable_ref: number;           // 有 readable ref 的 CLI command 數
  
  // 證據覆蓋
  atom_with_test_evidence: number;             // 有測試 evidence 的 atom %
  atom_with_rollback_evidence: number;         // 有 rollback 說明的 atom %
  atom_with_provenance: number;                // 有 provenance 記錄的 atom %
  
  // 排除覆蓋
  excluded_paths_with_reason: number;          // 被明確記錄排除原因的 path %
  
  // 可讀性
  runAtm_with_readable_ref: number;            // runAtm call 使用 readable ref 的 %
  
  // 聚合指標
  overall_atomization_score: number;           // 加權平均 0-100
  timestamp: string;                           // RFC3339 計算時間
}
```

### 3.2 Pass/Fail 門檻

| 指標 | Pass 門檻 | Fail 門檻 |
|---|---|---|
| source_ownership_coverage | >= 95% | < 80% |
| public_command_coverage | >= 95% | < 80% |
| atom_with_test_evidence | >= 80% | < 60% |
| atom_with_rollback_evidence | >= 70% | < 50% |
| excluded_paths_with_reason | >= 95% | < 90% |
| runAtm_with_readable_ref | >= 100% | < 95% |
| overall_atomization_score | >= 85 | < 70 |

### 3.3 Grade 分級

- **Grade A**: overall_atomization_score >= 90
- **Grade B**: overall_atomization_score >= 80 && < 90
- **Grade C**: overall_atomization_score >= 70 && < 80
- **Grade F**: overall_atomization_score < 70 (Fail, release blocked)

### 3.4 JSON Schema 草案 (`atm.dogfoodScore.v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "atm.dogfoodScore.v1",
  "title": "ATM Self-Atomization Dogfood Score",
  "type": "object",
  "required": [
    "timestamp",
    "version",
    "overall_atomization_score",
    "grade",
    "scores"
  ],
  "properties": {
    "timestamp": { "type": "string", "format": "date-time" },
    "version": { "type": "string" },
    "overall_atomization_score": { "type": "integer", "minimum": 0, "maximum": 100 },
    "grade": { "type": "string", "enum": ["A", "B", "C", "F"] },
    "scores": {
      "type": "object",
      "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 100 },
      "required": [
        "source_ownership_coverage",
        "public_command_coverage",
        "atom_with_test_evidence",
        "atom_with_rollback_evidence",
        "excluded_paths_with_reason",
        "runAtm_with_readable_ref"
      ]
    },
    "trend": { "type": "string", "enum": ["improving", "stable", "regressing"] },
    "next_target": { "type": "integer", "minimum": 0, "maximum": 100 },
    "priority_gaps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["area", "current", "target"]
      }
    }
  }
}
```

## 4. Exclusion Inventory 與 Path-to-Atom Map 檔案

核心檔案位置（相對 ATM repo root）：

```
atomic_workbench/atomization-coverage/
├── exclusion-inventory.json            # 所有排除路徑集中記錄（entry 陣列）
├── path-to-atom-map.json               # production path 與 owner atom 的對應
├── dogfood-score.json                  # 最近一次 atomize score 結果
├── generated-fixture-boundaries.json   # generated / fixture 邊界（TASK-ASA-0005）
└── coverage-reports/                   # 未來日期 snapshot（reserved，目前可不存在）
```

### 4.1 path-to-atom-map.json 結構

```json
{
  "version": "string",
  "timestamp": "RFC3339",
  "mappings": [
    {
      "path_pattern": "string (glob)",
      "atom_id": "string (atom-* readable ref)",
      "capability": "string",
      "coverage_status": "covered | partial | planned | debt"
    }
  ],
  "summary": {
    "total_production_paths": "integer",
    "mapped_paths": "integer",
    "coverage_percentage": "integer 0-100",
    "atoms_defined": "integer",
    "atoms_with_evidence": "integer",
    "debt_items": "integer"
  }
}
```

### 4.2 JSON Schema 草案 (`atm.pathToAtomMap.v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "atm.pathToAtomMap.v1",
  "title": "ATM Path-to-Atom Map",
  "type": "object",
  "required": ["version", "mappings", "summary"],
  "properties": {
    "version": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "mappings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path_pattern", "atom_id", "capability", "coverage_status"],
        "additionalProperties": false,
        "properties": {
          "path_pattern": { "type": "string", "minLength": 1 },
          "atom_id": { "type": "string", "pattern": "^atom-[a-z0-9-]+$" },
          "capability": { "type": "string", "minLength": 1 },
          "coverage_status": {
            "type": "string",
            "enum": ["covered", "partial", "planned", "debt"]
          }
        }
      }
    },
    "summary": {
      "type": "object",
      "required": [
        "total_production_paths",
        "mapped_paths",
        "coverage_percentage",
        "atoms_defined",
        "atoms_with_evidence",
        "debt_items"
      ],
      "properties": {
        "total_production_paths": { "type": "integer", "minimum": 0 },
        "mapped_paths": { "type": "integer", "minimum": 0 },
        "coverage_percentage": { "type": "integer", "minimum": 0, "maximum": 100 },
        "atoms_defined": { "type": "integer", "minimum": 0 },
        "atoms_with_evidence": { "type": "integer", "minimum": 0 },
        "debt_items": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

## 5. Guard 與 Validator 入點

以下命令用於驗證覆蓋：

```bash
# 產生當前得分
node atm.mjs atomize score --cwd . --json

# 驗證 production path 所有權
node atm.mjs validate atomization-coverage --repo . --json

# 驗證 runAtm/runAtmMap 可讀性
node atm.mjs validate atom-callsite-readability --repo . --json

# 驗證排除原因完整性
node atm.mjs validate exclusion-reasons --repo . --json
```

## 6. 過渡政策

### 6.1 Existing Atoms

已存在的 atom（如 core/cli/adapters）在 dogfood migration 中：
- 保留現有功能實現
- 逐步補充 evidence（test/rollback/provenance）
- 不強制立即改成 readable ref 入點

### 6.2 新增 Atoms

新增的 atom 必須：
- 從創建時就有 spec
- 包含 test evidence
- 使用 readable ref 入點（如涉及 runAtm）

### 6.3 Helper Functions

非公開介面的 helper function：
- 不強制包成 runAtm
- 但必須文件化其 owner atom
- 必須列在對應 atom 的 `internal_symbols` 中

## 7. 驗收檢查清單

- [x] exclusion-inventory.json 已建立，包含所有已知排除路徑（17 筆，2026-05-21）
- [x] path-to-atom-map.json 已建立，列出 12 條 production path → owner atom 映射（2026-05-21）
- [x] DogfoodScore 結構已定義，dogfood-score.json 含 overall + components，初始 grade=B（2026-05-21）
- [x] 排除原因、score、map 均提供正式 JSON Schema 草案（2026-05-25, TASK-ASA-0001 v1.1）
- [ ] `node atm.mjs validate atomization-coverage` 待 TASK-ASA-0004 加入
- [ ] `node atm.mjs atomize score` 待 TASK-ASA-0003 接通正式管線

## 8. 下游 Task 對應

| 任務 | 引用本文件章節 |
|---|---|
| TASK-ASA-0002 atomize inventory CLI | §1, §2, §4 |
| TASK-ASA-0003 atomize score 報告 | §3, §3.4 |
| TASK-ASA-0004 atomization-coverage guard | §1, §2, §4 |
| TASK-ASA-0005 generated/fixture 邊界 | §1.2, §1.3, §2 |
| TASK-ASA-0006 bulk atom spec backfill | §6 |
| TASK-ASA-0016 graduation gate | §3.2, §3.3 |

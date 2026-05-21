<!-- doc_id: doc_governance_0001 -->
# ATM 100% 原子化覆蓋口徑與排除政策

## 版本
- 版本: 1.0
- 日期: 2026-05-21
- 作者: ATM Framework Self-Atomization Task-ASA-0001

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

所有被排除的路徑必須使用標準 schema 記錄排除原因：

```json
{
  "path": "string",                           // 排除路徑（glob or file）
  "reason": "generated|fixture|snapshot|doc|example|test-only|internal-only",
  "owner_atom_id": "string (optional)",       // 如果有對應 atom
  "provenance": "string",                     // 生成/維護來源說明
  "valid_until": "RFC3339 (optional)",        // 過期日期（for temporary exclusions）
  "notes": "string (optional)"                // 附加說明
}
```

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

## 4. Exclusion Inventory 檔案

核心 exclusion inventory 位置：

```
c:\Users\User\AI-Atomic-Framework\atomic_workbench\atomization-coverage\
├── exclusion-inventory.json      # 所有排除路徑集中記錄
├── path-to-atom-map.json         # production path 與 atom 的對應
└── coverage-reports/
    ├── coverage-{date}.json      # 日期 snapshot
    └── trending.json             # 趨勢數據
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

- [ ] exclusion-inventory.json 已建立，包含所有已知排除路徑
- [ ] path-to-atom-map.json 已建立，覆蓋 >= 95% production source
- [ ] DogfoodScore 結構已定義，且初次計算得分 >= 70
- [ ] 本文件經過 doc review 通過
- [ ] `node atm.mjs validate exclusion-reasons` 無誤

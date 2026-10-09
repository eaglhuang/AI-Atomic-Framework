# EXPECTED — v0.1.17 composer／steward 探針（historic red-baseline）

| 欄位 | 內容 |
|------|------|
| 綁定 | ATM tag `v0.1.17` peel `8dd6a1c6d169bf0421a55d3954a0a299b0bd582b` |
| 腳本 | `probe.mts`（五情境；stdout＝JSONL） |
| 角色 | **M0 紅燈基準**／論文動機反例；**不是** M1 修後驗收綠燈 |
| 固化日 | 2026-10-07 20:18 CST（Asia/Taipei） |

若重跑結果與下表或已固化 `probe.out` **不一致**：**不要**改本檔去遷就；記錄差異並標 **blocked**。

---

## 五情境期望

### 1. `disjoint-replace`（S1a）— 期望 **綠**

- 同檔兩處等長替換（line2→`A_EDIT`，line8→`B_EDIT`），同一 base。
- **期望／實際（historic）**：
  - `composeVerdict` = `parallel-safe`
  - `applyMethod` = `patch-apply`
  - `ok` = true，`verdict` = `applied`
  - `hasA` = true，`hasB` = true

### 2. `disjoint-insert-top-first`（S1b 排序 A）— 期望 **紅**

- 上方插入＋下方插入；anchor 排序使**上方 patch 先 apply**。
- **期望／實際（historic）**：
  - compose 仍報 `parallel-safe`（誤判可並行）
  - apply **throw**：`UnifiedPatchApplicationError: patch context mismatch at line 8: expected "line8", found "line7"`
  - `hasA` = false，`hasB` = false（兩邊都丟）
- **論文用點**：非重疊插入在「上方先」時失敗 → 證明順序依賴／非同 base 合成。

### 3. `disjoint-insert-bottom-first`（S1b 排序 B）— 期望 **綠**（對照用）

- 與上列**相同 patch 內容**；僅 anchor 改為使**下方 patch 先**（`z`／`b`）。
- **期望／實際（historic）**：
  - `ok` = true，`verdict` = `applied`
  - `hasA` = true，`hasB` = true
- **論文用點**：與情境 2 對照＝**同一對 disjoint insert，結果隨排序變**（非 composition-determinism）。

### 4. `overlap-same-line`（S2）— 期望 **紅**（throw，非 blocked 收據）

- 兩提案改同一行（line5）。
- **期望／實際（historic）**：
  - `composeVerdict` = `needs-steward`
  - `applyMethod` = `steward-authored-final-patch`
  - apply **throw**：`UnifiedPatchApplicationError: patch context mismatch at line 5: expected "line5", found "A_EDIT"`
  - `hasA` = false，`hasB` = false
- **缺口**：應為 **blocked 收據＋檔不變**；現況為 **例外拋出**，非結構化 `blocked`。

### 5. `proposer-as-steward`（S3）— 期望 **紅**（不應 allowed；現況 applied）

- 單一提案；`stewardId` = 提案者 `agentA`。
- **期望／實際（historic）**：
  - `ok` = true，`verdict` = `applied`，`stewardId` = `agentA`
- **缺口**：應拒絕（如 `invalid-steward-identity`）且檔不變；現況 **提案者可自我 apply**。

---

## 固化 stdout（權威摘要；與 `probe.out` 相同）

```json
{"label":"disjoint-replace","composeVerdict":"parallel-safe","applyMethod":"patch-apply","ok":true,"verdict":"applied","hasA":true,"hasB":true}
{"label":"disjoint-insert-top-first","composeVerdict":"parallel-safe","applyMethod":"patch-apply","threw":"UnifiedPatchApplicationError: patch context mismatch at line 8: expected \"line8\", found \"line7\"","hasA":false,"hasB":false}
{"label":"disjoint-insert-bottom-first","composeVerdict":"parallel-safe","applyMethod":"patch-apply","ok":true,"verdict":"applied","hasA":true,"hasB":true}
{"label":"overlap-same-line","composeVerdict":"needs-steward","applyMethod":"steward-authored-final-patch","threw":"UnifiedPatchApplicationError: patch context mismatch at line 5: expected \"line5\", found \"A_EDIT\"","hasA":false,"hasB":false}
{"label":"proposer-as-steward","ok":true,"verdict":"applied","stewardId":"agentA"}
```

sha256(`probe.out`) = `70bc1a3ab79be3df6480e6ea785815913e1f939f3009cb7d1c5e8471c101ac2d`

---

## 與修後綠燈（B2–B4／M1）的邊界

| 情境 | Historic（本目錄） | 修後目標（#196／#198；**另跑、另目錄**） |
|------|-------------------|------------------------------------------|
| S1b 兩排序 | 一紅一綠（順序依賴） | 皆 applied；輸出 byte hash 相同 |
| S2 | throw | `blocked` 收據＋檔不變；不 throw |
| S3 | applied | identity 拒絕；檔不變 |

**B2–B4 待 M1**；不得用本紅燈目錄宣稱已修。

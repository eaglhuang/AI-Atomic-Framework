# EXPECTED — B5–B8（#198 契約凍結）

| 欄位 | 內容 |
|------|------|
| 綁定 | ATM merge `5692474f7db70ab52a7a71c8af4867609e7e4b43` |
| 腳本 | `probe.mts` |
| 固化日 | 2026-10-07 22:43 CST（Asia/Taipei） |

若重跑與下表不一致：**不要**改本檔遷就；標 **blocked** 並開 ATM 議題（本 harness 不改 pin 行為）。

---

## B6 凍結契約（#198 PR 詮釋）

1. **Overlap**＝一方的**變更**碰到另一方 hunk 覆蓋的任一列（**changed 或 context**）、同 gap 雙插入、或插入落在對方 hunk 內。
2. **僅共享未變更 context**、變更本身不交疊 → **允許**（類 `git merge-file`）。
3. **同 gap 雙插入** → block `steward-final-patch-required`。

本 harness **不**發明更嚴／更鬆的規則；觀測須對齊上列。

---

## 分項期望

### B5（S4 stale）

| case | 期望 |
|------|------|
| `true-s4-mutate-after-compose` | compose／`buildPatchProposalComposition` 後改 disk → `applyTransactionalStewardPlan`：`ok:false`，`verdict:blocked`，reason 含 `canonical target base hash is stale`；**不 throw**；檔 hash＝突變後內容（steward 未寫） |
| `applyStewardPlan-after-mutate` | 同突變下 `applyStewardPlan` → `file-hash-drift`（或等價 stale）；檔仍＝突變後 |
| `repropose-fresh-fileBeforeHash` | 對突變 base 重建 proposals（新 `fileBeforeHash`）→ `applied`，兩 edit 都在且保留外部突變列 |

### B6（邊界矩陣）

| case | 契約 | 期望 code／結果 |
|------|------|-----------------|
| `same-gap-dual-insert` | block | `steward-final-patch-required` |
| `adjacent-endpoints` | block | `steward-final-patch-required`（變更落在對方 span） |
| `context-overlap-only` | **allow** | `ok`，`checkedPermutationCount>0` |
| `file-head` | allow | ok |
| `file-tail` | allow | ok |
| `multi-hunk-plus-disjoint` | allow | ok |

### B7（排列／property）

| case | 期望 |
|------|------|
| `reorder-proposals-identical-hash` | 多種 proposal 順序 → 同一 output hash；`checkedPermutationCount>0` |
| `five-disjoint-bounded-permutation` | `checkedPermutationCount===6`（旋轉＋反轉，非硬編 0） |
| `serializabilityProof-frame` | `permutationStable===true` 且 count>0 |
| `blocked-before-after-hash-equal` | 衝突 apply blocked；檔前後 hash 相同；不 throw |

### B8（S5 rollback）

| case | 期望 |
|------|------|
| `failAfterWrites-multi-file` | `verdict:'rolled-back'`；`a.json`/`b.json` 還原；標「**例外補償／注入 failAfterWrites，非 crash atomicity**」 |

### Stock 回歸

| 腳本 | 期望 |
|------|------|
| `validate-broker-cowrite.ts --mode validate` | exit 0 |
| `validate-broker-steward.ts --mode validate` | exit 0 |
| `tests/core/transactional-steward-rollback.test.ts` | exit 0／`[transactional-steward-rollback] ok` |

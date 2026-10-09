# Composer／Steward 探針 — v0.1.17 紅燈基準（B1）

| 欄位 | 內容 |
|------|------|
| Checklist | **B1**（`EXPERIMENT_CHECKLIST.md`） |
| 角色 | **historic red-baseline**（動機／M0）；**不是**修後綠燈證據 |
| ATM 樹 | `/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17`（tarball；無 `.git`） |
| ATM SHA（tag peel） | **`8dd6a1c6d169bf0421a55d3954a0a299b0bd582b`**（annotated tag `v0.1.17` → tag obj `47697ae528a529ef67c8a20c88f3e97d2b98fe18`） |
| Steward blob 核對 | `packages/core/src/broker/steward-transactional-apply.ts` sha256 `2b9328a1dd11a3f465748d0cc502033629cc7d6ffe5bf1f991a36602089e9350`（與 `VERSION_ANCHORS.md` §2 一致） |
| Node（本次重跑） | **v24.10.0**（`/home/box/.local/node24/bin/node`；需 ≥22 支援 `--experimental-strip-types`／`.mts`） |
| 初跑記載 | `COMPOSER_STEWARD_IMPL_PLAN.md` 曾記 Node v24.21.0；本次重跑為 v24.10.0，**stdout 與舊 `probe.out` byte-identical** |
| 重跑時間 | **2026-10-07 20:18:38 CST**（Asia/Taipei, UTC+8） |
| 一致性 | 重跑 ≡ 舊 `probe.out`（`cmp` identical；sha256 `70bc1a3ab79be3df6480e6ea785815913e1f939f3009cb7d1c5e8471c101ac2d`） |

---

## 如何重跑

```bash
export ATM=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17
NODE=/home/box/.local/node24/bin/node   # 或任何 Node ≥22
cd /workspace/reports/atm-v2-harness/runs/composer-probe
"$NODE" --experimental-strip-types probe.mts | tee probe.out
cp -a probe.out probe.jsonl
sha256sum -c checksums.sha256
```

約束：

- **不改** ATM monorepo、不開 PR、不 npm publish。
- 探針只在 `/tmp` 建拋棄式 git repo，**唯讀 import** `compose.ts`／`steward.ts`。
- 期望結果見 `EXPECTED.md`；若 stdout 與 `probe.out` 不一致，**不要改期望遷就**，標 blocked 並記錄差異。

時間戳副本：`probe-20261007-201838.out`；symlink：`probe-latest.out` → 該檔。舊副本：`probe-prev.out`（與本次相同）。

---

## 期望結果表（historic red-baseline）

| 標籤（對應 S 族） | 期望色 | 實際（固化）摘要 |
|-------------------|--------|------------------|
| `disjoint-replace`（S1a） | **綠** | `parallel-safe` → `applied`；`hasA`＋`hasB` |
| `disjoint-insert-top-first`（S1b 一排序） | **紅** | compose 仍 `parallel-safe`；apply **throw** `UnifiedPatchApplicationError`（context mismatch line 8）；A/B 皆無 |
| `disjoint-insert-bottom-first`（S1b 另一排序） | **綠**（作**順序依賴**證據） | `applied`；`hasA`＋`hasB` — 與上一列對照＝排序敏感 |
| `overlap-same-line`（S2） | **紅** | compose `needs-steward`；apply **throw**（非 blocked 收據）；A/B 皆無 |
| `proposer-as-steward`（S3） | **紅** | `ok:true`／`verdict:applied`／`stewardId:agentA` — **不應 allowed，現況 applied** |

詳細契約見 `EXPECTED.md`。修 core（#196／#198／M1）後的綠燈目標**另表**，不可與本目錄混淆。

---

## 檔案

| 檔 | 用途 |
|----|------|
| `probe.mts` | 探針腳本 |
| `probe.out`／`probe.jsonl` | 五情境 JSON 行（同內容） |
| `EXPECTED.md` | historic 期望 |
| `checksums.sha256` | `probe.mts`／`probe.out`／`probe.jsonl` |
| `probe-YYYYMMDD-HHMMSS.out` | 時間戳副本 |
| `probe-latest.out` | → 最新時間戳 |
| `probe-prev.out` | 重跑前備份 |

Checksums：見同目錄 `checksums.sha256`。

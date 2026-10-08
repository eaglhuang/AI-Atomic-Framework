# F2 — 正確性／unsafe accept／false reject／零事件上界表

> **DRAFT — 不宣稱勝出 / not a win claim.** CI ≠ 主實驗。Candidate pin `5692474f…`（待審核升 final）。

| 欄位 | 內容 |
|------|------|
| 產出日 | 2026-10-07 23:30 CST |
| 狀態 | **draft tables** — 彙自 E1–E5 DRAFT；非最終論文排版 |

## 表 A — RQ2 主臂正確性快照（選摘；DRAFT）

| 來源 | arm | workload | correct rate (elig) | lost | note |
|------|-----|----------|---------------------|------|------|
| E2 | steward | cold／hot_disjoint／hot_conflict | 1.0 | 0 | 10 seeds；DRAFT |
| E3 | steward | hot_conflict × windows | 1.0 | 0 | goodput↓ as window↑ |
| E4 | steward MP p8 | hot_conflict | ≈0.53 | 0 | compose 不跨 process caveat |
| E4 | steward SP | hot_conflict | ≈0.89 | 0 | 同 seeds 對照 |
| E5 | clean_steward | hot_conflict | commit／lost=0 | 0 | fault control |

## 表 B — Unsafe acceptance／false reject（口徑）

| 指標 | 定義 | 本包可用證據 |
|------|------|--------------|
| unsafe acceptance | 應拒卻 committed | E5 stale／context 應為 blocked（非 commit）；B3／B5 |
| false rejection | 政策可收卻 blocked | E3／E2 需政策_id；本包標 **partial** — 未做獨立政策矩陣重算 |
| 分母=0 | 報 N/A | METRIC_DEFINITIONS §1.8–1.9 |

## 表 C — 零事件上界（write authority）

| 主張 | 監測 | 結果（DRAFT） | Caveat |
|------|------|---------------|--------|
| Proposer 不直寫 canonical | `proposer_direct_writes` 事件欄 | E4 main MP Σ=0（9/9） | 零事件≠完整權限證明；須報覆蓋率 |
| Identity steward≠proposer | B4／#198 | pass | historic 紅燈在 v0.1.17 probe |

## 表 D — Outcome 堆疊示例（E5）

| class | count (18 cells) |
|-------|------------------|
| blocked（probe+OCC） | 2×context + 2×stale + 3×occ = 7 |
| rolled-back | 2 |
| recovery-required | 2×kill + 2×rb_fail + 2×receipt = 6 |
| commit（clean） | 3 |

## CI 口徑聲明

1. 跨 seed 彙總：mean±σ 或 ratio-of-sums（見 A4／E2）。
2. CI 綠／PR 合 ≠ 主實驗完成（VERSION_ANCHORS §3）。
3. E1／E2 歷史 `logical_id===intent_id` stub；E3+ 已解耦。


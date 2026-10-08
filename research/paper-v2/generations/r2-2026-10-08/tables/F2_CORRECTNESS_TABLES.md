# F2 — 正確性／unsafe accept／false reject／零事件上界表

> **DRAFT — 不宣稱勝出 / not a win claim.** CI ≠ 主實驗。Candidate pin `5692474f…`（待審核升 final）。

| 欄位 | 內容 |
|------|------|
| 產出日 | 2026-10-07 23:30 CST |
| 狀態 | **draft tables** — 彙自 E1–E5 DRAFT；非最終論文排版 |
| r2 更新 | 2026-10-08 CST：E4 反例成立（P0-1）；oracle v2 全 bytes＋frame 重評（P0-2）；E5 改報 logical ops |

## 表 A — RQ2 主臂正確性快照（選摘；DRAFT）

| 來源 | arm | workload | correct rate (elig) | lost | note |
|------|-----|----------|---------------------|------|------|
| E2 | steward | cold／hot_disjoint／hot_conflict | 1.0 | 0 | 10 seeds；DRAFT；oracle v2 重評 0 改判 |
| E3 | steward | hot_conflict × windows | 1.0 | 0 | goodput↓ as window↑（負結果：長窗口無完成率收益）；v2 0 改判 |
| E4 | steward MP p2（r1） | hot_conflict | 63/106＝0.594 | **1**（seed 17／sched 1017） | **反例**：跨 process steward lost update（r2 鑑識） |
| E4 | steward MP p4（r1） | hot_conflict | 60/106＝0.566 | 0 | 同機制未被排除（steward 未加跨 process 鎖） |
| E4 | steward MP p8（r1） | hot_conflict | 56/106＝0.528 | 0 | 同上；**不可**當作 MP 零遺失的代表 |
| E4 | steward SP | hot_conflict | 94/106＝0.887 | 0 | 同 seeds 單 process 對照 |
| E4 r2 | 重播 r1 設定（p2/p4/p8） | hot_conflict | — | 6（75 runs 中 4 runs 失敗；另 1 撕裂檔） | 失敗 4/4 帶競態特徵 |
| E4 r2 | 候選緩解：steward 跨 process 鎖 | hot_conflict | — | 0（75 runs） | 觀察非證明；wall 成本 p8 687→907 ms |
| E5 | clean_steward | hot_conflict | 41/41 | 0 | fault control（3 cells，41 logical ops） |

**E4 停止規則（r2）**：r1 主臂「CAS＋apply-lock on」標籤對 steward 路徑不成立（apply-lock 未包住 steward，spins=0）；r1 `fault_nolock` 消融對 steward 與主臂相同。E4 的 MP 正確性結論撤回，見 `runs/r2-e4-forensics/E4_FORENSICS.md`。比率為 ratio-of-sums（correct／offered），由 `analysis/rebuild_tables.py` 從 raw 重建。

## 表 B — Unsafe acceptance／false reject（口徑）

| 指標 | 定義 | 本包可用證據 |
|------|------|--------------|
| unsafe acceptance | 應拒卻 committed | E5 stale／context 應為 blocked（非 commit）；B3／B5 |
| false rejection | 政策可收卻 blocked | E3／E2 需政策_id；本包標 **partial** — 未做獨立政策矩陣重算 |
| 分母=0 | 報 N/A | METRIC_DEFINITIONS §1.8–1.9 |

## 表 C — 零事件上界（write authority）

| 主張 | 監測 | 結果（DRAFT） | Caveat |
|------|------|---------------|--------|
| Proposer 不直寫 canonical | `proposer_direct_writes` 事件欄 | E4 main MP Σ=0（9/9） | 零事件≠完整權限證明；須報覆蓋率；**但兩個 steward 互相覆寫不在此欄涵蓋內**（E4 反例） |
| Steward 收據完整 | `artifacts/steward/<batch_id>.json` | **r1 E4 不成立**：15 MP cells 中 14 個跨 process 同名 batch id，收據互相覆蓋 | r2 起 batch id 加 worker 前綴（`cb-<file>-w<k>-NNNN`），r2 重播 0 碰撞 |
| Identity steward≠proposer | B4／#198 | pass | historic 紅燈在 v0.1.17 probe |

## 表 D — Outcome 堆疊示例（E5）

> r2 註：下表 18 是**測試情境（cell）分類**，不是 logical operation 終態分布，不可畫成交易成功／失敗比例。logical ops（runner cells）：OCC-exhaust 3 cells＝41 offered／26 correct／15 blocked／0 lost；clean_steward 3 cells＝41／41／0／0（`analysis/rebuild_tables.py`）。

| class | count (18 cells) |
|-------|------------------|
| blocked（probe+OCC） | 2×context + 2×stale + 3×occ = 7 |
| rolled-back | 2 |
| recovery-required | 2×kill + 2×rb_fail + 2×receipt = 6 |
| commit（clean） | 3 |

## CI 口徑聲明

1. 跨 seed 彙總：mean±σ 或 ratio-of-sums（見 A4／E2）。**mean±母體σ 不是 95% CI**；配對效果量與 cluster CI 仍未做（review 第三階段，r2 未處理）。
2. CI 綠／PR 合 ≠ 主實驗完成（VERSION_ANCHORS §3）。
3. E1／E2 歷史 `logical_id===intent_id` stub；E3+ 已解耦。


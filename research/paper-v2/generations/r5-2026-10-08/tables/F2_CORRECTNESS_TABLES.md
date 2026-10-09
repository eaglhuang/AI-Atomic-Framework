# F2 — 正確性／unsafe accept／false reject／零事件上界表

> **DRAFT — 不宣稱勝出 / not a win claim.** CI ≠ 主實驗。Candidate pin `5692474f…`（待審核升 final）。

| 欄位 | 內容 |
|------|------|
| 產出日 | 2026-10-07 23:30 CST |
| 狀態 | **draft tables** — 彙自 E1–E5 DRAFT；非最終論文排版 |
| r2 更新 | 2026-10-08 CST：E4 反例成立（P0-1）；oracle v2 全 bytes＋frame 重評（P0-2）；E5 改報 logical ops |
| r3 更新 | 2026-10-08 CST：ATM PR #213（merge `bea35380`）steward 跨 process 修正之驗證；r1／r2 列保留為歷史 |
| r3 措辭修訂 | 2026-10-08 13:51 後：依作者與外部審閱者協議改為分列指標（表 A-r3）；新增 r4 預留表（表 A-r4）；未封存新 generation |
| r4 更新 | 2026-10-08 CST：ATM PR #214（merge `2118bc66`）steward 完成率最佳化之驗證；表 A-r4 填入；新增表 A 列；r1–r3 列保留為歷史 |

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
| E4 r3 | 同時段對照：ATM 5692474f、harness 鎖 off | hot_conflict | 1519/2610＝0.582 | 12 個遺失效果（合計；75 runs 中 8 runs 失敗；損壞檔 0） | 重現 r1/r2 反例；分列指標見表 A-r3 |
| E4 r3 | **ATM bea35380（PR #213）、harness 鎖 off** | hot_conflict | 1524/2610＝0.584 | **0**（0/75 runs 失敗；損壞檔 0） | 觀察非證明；完成約 58%，非全部成功；見表 A-r3 |
| E4 r3 | ATM bea35380＋harness 鎖 on（次要） | hot_conflict | 1592/2610＝0.610 | 0（0/75 runs 失敗） | wall mean 688.3 ms；p8 894.7 ms |
| E4 r3 | r1 18 cells 重跑：5692474f／bea35380 | 各臂 | — | 1 個遺失效果（fault_naive p8 s23；1/18 cells）／0 | 單 process 兩 pin 完成皆 592/636（各 18 次） |
| barrier r3 | 確定性 2-process 交錯（每案 20 次） | 同 region／上下分離 | — | 5692474f：每案 20 次、每次遺失 1 個效果（合計 20＋20）；bea35380：0＋0 | bea35380 同 region→blocked（只留 leader）；上下分離→re-compose 後兩者皆在 |
| E4 r4 | 同時段對照：ATM 5692474f、harness 鎖 off | hot_conflict | 1580/2610＝0.605 | 6 個遺失效果（合計；75 runs 中 5 runs 失敗；損壞檔 0） | **反例重現**（同 r3 機制） |
| E4 r4 | ATM bea35380（PR #213）、harness 鎖 off | hot_conflict | 1553/2610＝0.595 | 0（0/75 runs 失敗；損壞檔 0） | 同時段對照 |
| E4 r4 | **ATM 2118bc66（PR #214）、harness 鎖 off** | hot_conflict | 1748/2610＝0.670 | **0**（0/75 runs 失敗；損壞檔 0） | 觀察非證明；作者自行執行、未獨立重現；約 33% 仍 blocked |
| E4 r4 | ATM 2118bc66＋harness 鎖 on（次要） | hot_conflict | 1841/2610＝0.705 | 0（0/75 runs 失敗） | wall mean 712.0 ms；p8 950.3 ms |
| E4 r4 | r1 18 cells 重跑：5692474f／bea35380／2118bc66 | 各臂 | MP 309／286／372 of 530 | 2 個遺失效果（fault_naive p8、fault_nolock p8；2/15 MP cells）／0／0 | 單 process 三 pin 皆 98/106 |
| barrier r4 | 確定性 2-process 交錯（每案 20 次；seam／stale-proposal／before-precheck） | 同 region／上下分離 | — | 5692474f seam：合計 20＋20；bea35380：0；2118bc66：0 | 2118bc66 同 region→`steward-final-patch-required` blocked；上下分離→applied，兩者皆在（stale-proposal 時 bea35380 為 `file-hash-drift` blocked） |
| 故障 r4 | F6 不同 PID namespace（`unshare`；同工作樹） | 跨 namespace 持鎖 | — | **2118bc66：每方向 10/10 runs 各遺失 1 個效果**；bea35380：host→ns 方向 10/10、反向 0 | **反例**（§5.7）：存活持鎖者被誤判過期 |
| E5 | clean_steward | hot_conflict | 41/41 | 0 | fault control（3 cells，41 logical ops） |

**E4 停止規則（r2）**：r1 主臂「CAS＋apply-lock on」標籤對 steward 路徑不成立（apply-lock 未包住 steward，spins=0）；r1 `fault_nolock` 消融對 steward 與主臂相同。E4 的 MP 正確性結論撤回，見 `runs/r2-e4-forensics/E4_FORENSICS.md`。**r3 註**：PR #213 後在同配置未再觀察到 lost／損壞（`runs/r3-analysis/r3-2026-10-08/r3-compare/R3_TABLES.md`）；依停止規則，撤回的 MP 結論不因 r3 自動恢復。比率為 ratio-of-sums（correct／offered），由 `analysis/rebuild_tables.py` 從 raw 重建。

## 表 A-r3 — E4 r3 重播分列指標（每臂 75 runs、2,610 intents；oracle v2；DRAFT；措辭依 2026-10-08 13:51 協議）

> 資料來源：作者自行執行的 483 個 r3 run（2026-10-08 10:45–10:55 Asia/Taipei），**未經獨立重現**。下表各欄分開列，不合併成單一成功率。

| 臂 | ATM pin | 完成 intents／總 intents | 失敗 runs／總 runs | 遺失效果（合計） | blocked intents | 損壞檔 |
|----|---------|--------------------------|--------------------|------------------|-----------------|--------|
| old（同時段對照，harness 鎖 off） | 5692474f | 1,519／2,610（58.2%） | 8／75 | 12 | 1,079 | 0 |
| **fix（主比較，harness 鎖 off）** | bea35380 | **1,524／2,610（58.4%）** | **0／75** | **0** | 1,086 | 0 |
| fixlock（次要，harness 鎖 on） | bea35380 | 1,592／2,610（61.0%） | 0／75 | 0 | 1,018 | 0 |

- 恆等式：完成＋遺失＋blocked＝總 intents（old 1,519＋12＋1,079；fix 1,524＋0＋1,086）。
- 措辭：old 為「75 次重播中 8 次 run 失敗，合計遺失 12 個效果」（**不是**「12 次失敗」）；fix 為 0 次失敗、0 個遺失效果。
- 完成數 old 1,519 對 fix 1,524：**本次觀察中完成數未下降**，但兩者皆約 58%；**不可**寫成全部成功，也**不可**寫成已在統計上證明不劣（未做非劣性檢定）。
- 分組：p2／s17（35 runs）old 2/35 runs 失敗、合計遺失 3 個效果；fix 0/35、0。p8 格（15 runs）old 4/15、合計遺失 4 個效果；fix 0/15、0。

**blocked intents 依最終理由（分列）**

| 最終理由 | old 5692474f | fix bea35380 | fixlock |
|----------|-------------:|-------------:|--------:|
| `file-hash-drift` | 782 | 779 | 805 |
| `steward-final-patch-required` | 229 | 218 | 213 |
| 未上鎖早期 stale 檢查（bea35380 不觸發 re-compose） | 66 | 70 | 0 |
| re-compose 後重合成失敗（`compose-context-mismatch`） | — | 15 | 0 |
| 其他 `compose-context-mismatch` | 2 | 4 | 0 |
| **合計** | **1,079** | **1,086** | **1,018** |

- re-compose：fix 臂 18 次事件中**只有 3 次**後續成功提交（已計入完成），15 次後續 blocked（已計入上表）。

**CI（另列；不是論文實驗）**：PR #213 head `4d7c9ed6` 4 個檢查與 merge `bea35380` 6 個 check runs（ATM Dogfood、Product CI、neutrality-scan、sandbox-gate）全部 success（2026-10-08 10:27–11:49 Asia/Taipei）；PR 自述本機 `npm test` 13 validators、0 失敗。CI 只跑框架測試，**不**重跑本文實驗。

**明確未做**：Phase 3 450-run 主矩陣；故障情境 lock timeout、持鎖者被 kill、跨容器、`recovery-required`（r3 期間觸發 0 次，不代表行為正確）。

## 表 A-r4 — steward 完成率最佳化前後（r4；每臂 75 runs、2,610 intents；oracle v2；DRAFT；不主張勝出）

> 資料來源：作者自行執行的 r4 run（2026-10-08 14:37–14:58 Asia/Taipei），**未經獨立重現**。下表各欄分開列，不合併成單一成功率。最佳化 (a) region 錨定 re-compose（CID 錨定未實作）；(b) 未上鎖早期 stale 改走 re-compose；(c) 有上限重試＋退避（4 次、4 ms、jitter 3 ms）；(d) repo 範圍鎖位置＋過期持鎖者處理。**broker 序列化 apply 佇列未實作**（論文 §4.11）。

| 臂 | ATM pin | 完成／總 intents | 失敗／總 runs | 遺失效果（合計） | 損壞檔 | blocked | re-compose 事件／成功 | wall ms mean／p95 |
|----|---------|------------------|---------------|------------------|--------|---------|------------------------|-------------------|
| old（harness 鎖 off） | 5692474f | 1,580／2,610（60.5%） | 5／75 | 6 | 0 | 1,024 | — | 594.7／718.7 |
| fix（harness 鎖 off） | bea35380 | 1,553／2,610（59.5%） | 0／75 | 0 | 0 | 1,057 | 16／2 | 583.9／722.4 |
| **opt（主，harness 鎖 off）** | 2118bc66 | **1,748／2,610（67.0%）** | **0／75** | **0** | 0 | 862 | 91／24 | 597.1／738.7 |
| optlock（次要，harness 鎖 on） | 2118bc66 | 1,841／2,610（70.5%） | 0／75 | 0 | 0 | 769 | 0／0 | 712.0／1,002.3 |
| optr1（消融：重試 1、無退避） | 2118bc66 | 1,752／2,610（67.1%） | 0／75 | 0 | 0 | 858 | 104／33 | 601.3／718.2 |
| optr0（消融：重試 0） | 2118bc66 | 1,718／2,610（65.8%） | 0／75 | 0 | 0 | 892 | 85／0 | 605.3／743.5 |

- 恆等式：完成＋遺失＋blocked＝總 intents（old 1,580＋6＋1,024）。
- 措辭：old 為「75 次重播中 5 次 run 失敗，合計遺失 6 個效果」；opt 為 0 次失敗、0 個遺失效果。完成數 opt 1,748 對 fix 1,553：**本次觀察中較高**（逐 run 配對 55 高／6 同／14 低；描述性）；仍約 33% blocked，**不可**寫成全部成功，也**未**做顯著性或非劣性檢定。同一 fix 臂 r3→r4 為 1,524→1,553（場次間差約 29）。
- 分組：p2／s17（35 runs）old 3/35 runs 失敗、合計遺失 3、完成 771/1,190；fix 0、0、766；opt 0、0、794。p8 格（15 runs）old 1/15、1、296/530；fix 0、0、293；opt 0、0、358。

**blocked intents 依最終理由（分列）**

| 最終理由 | old 5692474f | fix bea35380 | opt 2118bc66 | optlock |
|----------|-------------:|-------------:|-------------:|--------:|
| `file-hash-drift` | 742 | 785 | 0 | 0 |
| 未上鎖早期 stale 檢查 | 62 | 68 | 0 | 0 |
| re-compose 後 `compose-context-mismatch` | — | 16 | 0 | 0 |
| 其他 `compose-context-mismatch` | 5 | 7 | 0 | 0 |
| `steward-final-patch-required`：同批次行號重疊 | 215 | 181 | 181 | 219 |
| `steward-final-patch-required`：區域錨定列已改 | — | — | 479 | 474 |
| 同上，re-compose 之後 | — | — | 81 | 0 |
| `steward-final-patch-required`：同批同區域 | — | — | 121 | 76 |
| `re-compose attempts exhausted`／`recovery-required:` | 0／0 | 0／0 | 0／0 | 0／0 |
| **合計** | **1,024** | **1,057** | **862** | **769** |

- re-compose：opt 91 次事件中 24 次後續成功提交（26 個 intents），67 次後續 blocked（81 個 intents）；fix 16 次中 2 次成功。每 batch 嘗試次數：fix 0:720／1:1,457／2:2；opt 0:512／1:1,659／2:24；optr1 0:503／1:1,658／2:34。**第 3–5 次嘗試與退避在 E4 中未觸發**。optr0 有 99 個 intents 以 `re-compose attempts exhausted` 結束，optr1 1 個。

**消融可行性**：(c) 可經 `applyStewardPlan` 公開輸入 `recomposePolicy` 關閉（optr0／optr1）；(a) 無開關（需改 ATM 程式碼或改提案格式）；(b) 無法與 (c) 分離；(d) `commitLockRoot` 不經 `applyStewardPlan` 轉送，以 pin 對照代替；broker 佇列未實作。

**barrier（每案 20 次）**：seam：5692474f 每次遺失 1 個效果（合計 20＋20）；bea35380／2118bc66 0＋0（同 region blocked、上下分離 re-compose 後兩者皆在）。stale-proposal：bea35380 兩案皆 `file-hash-drift` blocked；2118bc66 同 region `steward-final-patch-required` blocked、上下分離 applied 兩者皆在（20/20）。before-precheck（只能在 2118bc66 測）：同 region blocked 20/20、上下分離 applied 20/20。

**故障情境**：F1 持鎖者被 SIGKILL（取得鎖後／rename 前）：兩 pin 皆回收並 applied 10/10、0 遺失；rename 前被殺留孤兒 temp 檔 10/10。F2 pid 重用（start token 不符）：2118bc66 回收 applied；bea35380 `recovery-required`（安全）。F3 存活持鎖逾時：兩 pin `recovery-required`、0 遺失。F4 不同 TMPDIR：2118bc66 共鎖 0 遺失；**bea35380 每次遺失 1 個效果 10/10**。F5 重試用盡：2118bc66 `exhausted after 5 of 5`、不寫入；bea35380 不可測。**F6 不同 PID namespace：2118bc66 兩方向各 10/10 runs 遺失 1 個效果（反例）**；bea35380 host→ns 10/10 遺失、反向 `recovery-required`。

**CI（另列；不是論文實驗）**：PR #214 CI：Product CI、ATM Dogfood、neutrality-scan、sandbox-gate 皆綠（feature `b5729456` 14:17–14:26、merge `2118bc66` 14:27–14:39 Asia/Taipei）；PR 自述 `npm test` 13/13。CI 只跑框架測試，**不**重跑本文實驗。

**明確未做**：Phase 3 450-run 主矩陣；真實容器／網路檔案系統；fsync／斷電；外部寫入者；broker 序列化 apply 佇列；CID 錨定 re-compose；孤兒 temp 檔清理；獨立重現。

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

## 表 A-r5　提交層同場重跑（r5，2026-10-08；DRAFT；作者自行執行、未獨立重現；Wilson 95% 描述性）

E4 重播（每臂 75 runs、2,610 intents；harness 鎖 off）：

| 臂 | 完成（95% CI） | 失敗 runs | 遺失 | blocked（hash-drift） | 例外未完成 | re-compose 事件／成功 |
|---|---|---|---:|---|---:|---|
| 5692474f | 1,515（58.1%；0.561–0.599） | 6／75 | 6 | 1,089（795） | 0 | 0／0 |
| bea35380 | 1,534（58.8%；0.569–0.607） | 0／75 | 0 | 1,076（768） | 0 | 19／2 |
| 2118bc66 | 1,727（66.2%；0.643–0.680） | 0／75 | 0 | 883（0） | 0 | 103／29 |
| 37847584 queue on | 1,716（65.8%；0.639–0.675） | 0／75 | 0 | 894（0） | 3 | 0／0 |
| 37847584 queue off | 1,705（65.3%；0.635–0.671） | 0／75 | 0 | 905（0） | 0 | 105／35 |
| queue on＋maxRecompose 0 | 1,719（65.9%） | 0／75 | 0 | 891（0） | 2 | 0／0 |
| queue on＋maxRecompose 1 | 1,746（66.9%） | 0／75 | 0 | 864（0） | 2 | 0／0 |
| † queue off 參照（探索性） | 1,759（67.4%） | 0／75 | 0 | 851（0） | 0 | 110／33 |
| † queue off＋maxRecompose 0 | 1,679（64.3%） | 0／75 | 0 | 931（0） | 0 | 96／0 |
| † queue off＋maxRecompose 1 | 1,723（66.0%） | 0／75 | 0 | 887（0） | 0 | 89／22 |

故障情境（遺失次數／次數）：跨 PID namespace 2118bc66 20／20、37847584 qon 0／20、qoff 0／20；偽造 owner 10／10、0／10、0／10；rename 前被殺之孤兒 temp 留存 10／10、0／10、0／10。完整表：`runs/r5-analysis/r5-2026-10-08/r5-compare/R5_TABLES.md`。

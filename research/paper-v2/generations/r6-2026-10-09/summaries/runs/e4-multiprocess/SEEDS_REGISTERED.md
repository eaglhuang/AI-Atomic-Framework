# E4 — Seeds 預登記（跑前）

> **DRAFT evidence — 不宣稱勝出**。本檔與 `seeds.json` 寫於任何 E4 cell 之前。

| 欄位 | 內容 |
|------|------|
| 登記時間 | 2026-10-07 23:25:31 CST |
| ATM pin | `5692474f…` READ-ONLY |
| 主臂 | steward + CAS + apply-lock **on**；procs **2／4／8** |
| 對照 | single-process steward（同 seeds） |
| Fault 臂（隔離標籤） | `naive` registry；`apply-lock off`（皆 p8） |
| Workload | **hot_conflict** only（MP 壓力；E2 已覆蓋三元於單進程） |
| Seeds | wl `{11,17,23}`；sched `wl+1000` |
| agents×trials | **8×5** |
| **預期格數** | **18** = 9 MP main + 3 SP + 3 naive + 3 nolock |
| run_id | `e4-hot_conflict-steward-p{N}-s{seed}`／`…-sp-s{seed}`／`…-fault_naive-p8-s{seed}`／`…-fault_nolock-p8-s{seed}` |

## 不變量（主臂）

- `registry_residue_active_intents == 0`（0 殭屍 lease）
- 收據對帳：decision 數＝intent 數；worker exit 0
- 寫入監測：steward `proposer_direct_writes` Σ＝0（若欄位存在）

## Banner

Paper stays DRAFT. Fault 臂不作正確性競爭者。

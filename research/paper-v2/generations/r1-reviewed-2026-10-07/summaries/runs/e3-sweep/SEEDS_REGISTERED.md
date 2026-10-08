# E3 — Seeds 預登記（跑前）

> **DRAFT evidence — 不宣稱勝出**。本檔與 `seeds.json` 寫於任何 E3 cell 之前。

| 欄位 | 內容 |
|------|------|
| 登記時間 | 2026-10-07 23:15:36 CST |
| ATM pin | `5692474f7db70ab52a7a71c8af4867609e7e4b43`（READ-ONLY） |
| 主臂 | `--arm steward`（D5 RQ2 freeze） |
| 對照臂 | `bare_composer`（僅 `hot_conflict`） |
| Window 格 | `0, 25, 50, 100, 200, 400` ms（**必含 0**） |
| Workloads | E1/E2 三元：cold／hot_disjoint／hot_conflict（全留） |
| Workload seeds | `11, 17, 23, 29, 31`（5；子集於 E2 十粒） |
| Scheduler | `workload_seed + 1000` → `1011…1031`（≠ workload） |
| agents×trials | 3×5（E1/E2 parity） |
| **預期格數** | **120** = steward 3×6×5 (90) + bare_composer 1×6×5 (30) |
| run_id | `e3-<wl>-<arm>-w<ms>-s<seed>` |

## 為何 120 而非 150

E3 目標是 **window 延遲↔覆蓋 tradeoff**，不是五臂主矩陣。縮小 seeds（5）與對照臂範圍，換取 6 點 window 曲線；仍大於 E1 pilot 規模。

## 配對規則

同一 `(wl, seed, scheduler, window)` 在 steward 三 workload 各一格；bare_composer 只在 hot_conflict 對齊同 seeds／windows。

## Banner

Paper stays DRAFT. Report metrics only — **不宣稱勝出**.

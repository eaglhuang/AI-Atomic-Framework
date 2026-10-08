# E1 Pilot — 凍結工作負載（2026-10-07 Asia/Taipei）

**Banner: pilot only — no win claims / no RQ2 main result**

## 共同參數（與 D5 smoke 對齊一格）

| 參數 | 值 |
|------|-----|
| agents × trials | **3 × 5**（與 D5 同，便於 hot_conflict×seed11 對照） |
| compose-window-ms | **100**（D5 凍結；全 workload 不改） |
| hold_ms | **8–25** |
| tick_interval_ms | **15** |
| jitter_ms | **6** |
| atm-backend | **real** |
| ATM pin | `5692474f…` |
| seeds | **{11, 17, 23}** |

## 三 workloads

| id | 語意 | CLI |
|----|------|-----|
| **cold** | 低爭用／冷檔 | `--hot-ratio 0 --overlap low` |
| **hot_disjoint** | 熱檔但低重疊（不相交傾向） | `--hot-ratio 1 --overlap low` |
| **hot_conflict** | 熱＋混衝突（D5 同風格） | `--hot-ratio 1 --overlap high` |

`overlap=low` → P(打 contended)=0.25；`high` → 0.8（見 `src/scenario.mjs` OVERLAP_P）。

## 五主臂（RQ2 competitors）

steward / file_lock / occ / git_three_way / bare_composer

診斷臂不進主表；可選 seed11×hot_conflict 單次 smoke（若執行會另記）。

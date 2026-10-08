# STEWARD_WRITER_E4 — Multi-process chronicle

> **DRAFT evidence — not a win claim / 不宣稱勝出**

| 欄位 | 內容 |
|------|------|
| 完成 | 2026-10-07 23:26 CST（Asia/Taipei） |
| Checklist | **E4** |
| ATM | pin `5692474f…` 唯讀 |
| Main | steward + CAS + apply-lock on；procs 2／4／8 |
| 產出 | `runs/e4-multiprocess/`（18 cells＋SUMMARY＋compare） |

## 做了什麼

1. **跑前**登記 seeds（3 wl；sched=wl+1000）。
2. Harness：`run-mp` 支援 `--arm`／`--scheduler-seed`／fault 標籤；`mp-runner` 對 steward `initWorktreeGit`。
3. 跑 **18** cells：9 MP main + 3 SP + 3 naive + 3 nolock。
4. 驗證：主臂 **0 殭屍 lease**、收據對帳、`proposer_direct_writesΣ=0`、distinct_pids；fault naive 再現 zombie；nolock 偶發 lost。
5. Checklist E4→done；下一階預設 **E5**（不自動開工）。

## 通過判準

- Seeds 早於 runs → **是**
- procs 2/4/8 + fault 隔離 → **是**
- 0 zombie（主臂）+ 收據／寫入監測 → **是**
- 無 win claim → **E4 done**

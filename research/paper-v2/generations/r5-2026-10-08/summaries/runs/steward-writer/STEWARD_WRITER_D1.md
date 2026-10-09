# D1 — Per-file lock serialization baseline

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07 21:28 Asia/Taipei（CST, UTC+8） |
| 實作 | `src/arms.mjs`（`file_lock`＋`FileLockTable`）；`src/runner.mjs` writer 路徑 |
| Oracle | C3 effect_id + bytes（與 steward 相同裁判） |
| ATM pin | `5692474f…` |

## Story（凍結）

1. **ATM admit**（real／mock broker 皆可）— 與其他 atm 臂相同准入。
2. **No composer apply** — 不走 PatchProposal／compose window。
3. **Per-file async mutex** — 同檔一次只允許一個 writer；**鎖涵蓋 `hold_ms` + RMW apply**（保守正確成本）。
4. **RMW** = `applyEditSync`（與 sync 寫入語意相同，但在鎖內）。
5. 不同檔可平行。

`arm_role: baseline_serial`，`diagnostic: false`，`correctness_competitor: true`（序列化 foil，**不是** RQ2 主方法；主方法仍是 `steward`）。

## CLI

```bash
node src/cli.mjs start --arm file_lock --run-id … --seed N --atm-backend real …
# aliases: --arm per_file_lock | --arm serial | --atm-writer file_lock
```

| `--arm` | maps to | role |
|---------|---------|------|
| `file_lock` | `mode=atm` + `atm_writer=file_lock` | `baseline_serial` |
| `steward` | `mode=atm` + `atm_writer=steward` | `main_method` |

Events／meta 帶：`arm`、`arm_role`、`diagnostic`、`correctness_competitor`、`lock_wait_ms`（file_lock）。

## Compare smoke vs steward

同 C4 規模：seed=11，agents=3，trials=5，hot_ratio=1，overlap=high，hold 8–25ms，tick=15ms，ATM real。

| arm | role | offered | committed | **correct** | **lost** | wall_clock_ms | mean_lock_wait_ms | mean_overhead_ms |
|-----|------|---------|-----------|-------------|----------|---------------|-------------------|------------------|
| **file_lock** | baseline_serial | 15 | 15 | **15** | **0** | 232.6 | 6.82 | 21.5 |
| **steward** | main_method | 15 | 15 | **15** | **0** | 549.6 | 0 | 57.9 |

Runs：`runs/d1-file_lock/`、`runs/d1-steward/`。原始：`runs/steward-writer/d1_compare_raw.json`。

> 兩者本 smoke 皆 0 lost（正確性 foil 達標）。wall 差異含 steward compose window（80ms）等待，**不**據此宣稱 file_lock「更快／更好」——D1 回答的是「保守序列化正確成本」可觀測（`lock_wait_ms`），主方法仍是 steward。更高併發／更長 hold 時 serial 成本會更顯著（留給 E 矩陣）。

Also copied note path: `runs/baselines/D1.md` → 同內容 symlink／副本。

## Gaps → D2

- **D2**：optimistic CAS＋retry（失敗重建／rebase）基線。
- file_lock 目前 in-process only（mp 跨 process 需共享鎖；D1 不涵蓋）。
- 主矩陣需固定 seeds／reps 再報成本分佈。

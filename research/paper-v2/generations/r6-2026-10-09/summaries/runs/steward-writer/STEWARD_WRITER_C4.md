# C4 — Diagnostic arms（動機／上界／raw；非正確性競爭者）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-07 21:25 Asia/Taipei（CST, UTC+8） |
| 實作 | `src/arms.mjs`；CLI `--arm`；events／meta 帶 `arm`／`arm_role`／`diagnostic`／`correctness_competitor` |
| Oracle | 四臂皆走 C3 `expected_effects` + effect_id bytes（同一裁判） |
| ATM pin | `5692474f…` |

## Arm → CLI mapping

| `--arm` | aliases | Under the hood | `arm_role` | `diagnostic` | 正確性競爭者？ |
|---------|---------|----------------|------------|--------------|----------------|
| **`steward`** | `main` | `mode=atm` + `atm_writer=steward` | `main_method` | **false** | **YES（主方法）** |
| **`ideal_sync`** | `sync` | `mode=atm` + `atm_writer=sync` | `upper_bound` | true | **NO** |
| **`admission_only`** | `stale` | `mode=atm` + `atm_writer=stale` | `motivation` | true | **NO** |
| **`raw_overwrite`** | `control`／`raw` | `mode=control`（ControlWriter） | `baseline_raw` | true | **NO** |

```bash
node src/cli.mjs start --arm steward --run-id … --seed N --atm-backend real …
node src/cli.mjs start --arm ideal_sync …    # or --arm sync
node src/cli.mjs start --arm admission_only … # or --arm stale
node src/cli.mjs start --arm raw_overwrite …  # or --arm control
```

不加 `--arm` 時，仍可由 `--mode` + `--atm-writer` **推斷**並蓋章（control→raw_overwrite；atm+steward→steward；atm+stale→admission_only；atm+sync→ideal_sync）。

**論文／表註**：僅 `steward`（`correctness_competitor:true`）可報為正確性主方法。其餘臂僅作動機／上界／raw 基線，**不得**與 steward 比「誰更正確」。

## Compare smoke（同 seed／同 workload）

| 參數 | 值 |
|------|-----|
| seed | 11 |
| agents × trials | 3 × 5（offered=15） |
| hot_ratio / overlap | 1 / high |
| compose_window_ms | 80（僅 steward 有意義） |
| ATM | real / pin `5692474f…` |
| runs | `c4-steward`／`c4-ideal_sync`／`c4-admission_only`／`c4-raw_overwrite` |

| arm | role | diagnostic | offered | committed | **correct** | **lost** | 備註 |
|-----|------|------------|---------|-----------|-------------|----------|------|
| **steward** | main_method | no | 15 | 15 | **15** | **0** | 主方法 |
| ideal_sync | upper_bound | **yes** | 15 | 15 | 15 | 0 | 理想 RMW 上界參考；**非**競爭者 |
| admission_only | motivation | **yes** | 15 | 15 | 9 | **6** | 無 composer apply → lost 動機 |
| raw_overwrite | baseline_raw | **yes** | 15 | 15 | 8 | **7** | 無 ATM 併發覆寫基線 |

> 本表**不宣稱** ideal_sync「勝過」steward（兩者本 smoke 皆 0 lost）。ideal_sync 僅標 upper_bound；正確性主張只綁 steward。

事件抽樣：四臂 decision 皆帶 `arm`／`arm_role`／`diagnostic`／`correctness_competitor`（見各 run `meta.json` 與 agent JSONL）。

## Gaps → D1

- **D1** per-file lock 序列化基線（強正確性對照，非診斷標籤）。
- 主矩陣仍須固定 seeds／reps；C4 僅小 smoke。
- `artifact_manifest.json`／reproduce 仍缺（A5／F3）。

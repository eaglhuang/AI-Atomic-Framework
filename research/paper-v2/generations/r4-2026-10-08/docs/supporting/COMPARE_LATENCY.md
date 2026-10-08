# COMPARE_LATENCY — ATM（real）比 no-ATM 慢多少？

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei） |
| Harness | atm-bench **0.3.0-latency**（`writer=mock`，in-process） |
| ATM | `atm_backend=real`：`@ai-atomic-framework/core@0.1.2`（`/workspace/AI-Atomic-Framework/packages/core`） |
| Control | `atm_backend=none`（無 broker、直接寫檔） |
| 共同設定 | `scenario_seed=42`, `n_agents=6`, `trial_count=30`, `hot_ratio=0.4`, `overlap=med`, `cold_policy=queue`, composer=on |
| Node | v24.21.0，單一 process（6 個 agent = 6 個 async worker 共用一個 event loop） |
| 計時 | `performance.now()`（單調時鐘，ms，2 位小數）；百分位 = nearest-rank |

## TL;DR（標題數字）

| 情境 | wall clock ATM / control | 慢多少（wall） | throughput ATM / control（intents/s） | 每筆 total_ms mean / p95 ATM vs control | 每筆額外成本（ATM − control） |
|---|---|---|---|---|---|
| **A. 依規格節奏（paced，要求的 small run，rep1）** | 1557.15 / 1517.18 ms | **1.03×（+39.97 ms）** | 107.89 / 110.73 | 44.94 / 65.50 vs 40.57 / 58.82 ms | mean **+4.37 ms**、p95 **+6.68 ms**（1.11×） |
| A′. 同上 ×5 reps | 1560.05 / 1516.23 ms | 1.03×（+43.82 ms） | 107.69 / 110.80 | 44.96 / 64.81 vs 40.58 / 58.44 ms | mean +4.38 ms、p95 +6.37 ms |
| **B. 無節奏壓測（unpaced：tick=0, hold=0, jitter=0）×5 reps** | 747.27 / 81.73 ms | **9.14×（+665.54 ms）** | 225.35 / 2056.53 | 15.43 / 20.85 vs 1.45 / 2.00 ms | mean **+13.98 ms**、p95 **+18.85 ms**（≈10.6×） |

**ATM 本身的成本（非模擬思考時間）**：每筆 intent 的 `overhead_ms`（= total − hold）ATM 約 **5.2 ms mean / 7.1 ms p95**，control 約 **0.2 / 0.3 ms**（≈ **+5 ms/intent**）。拆開：
- `latency_ms`（submit→ATM 決策）≈ **3.0 ms mean / 4.3 ms p95**（全是 broker 計算＋registry I/O；`wait_ms`=0，本跑沒有原生 `queue`）。
- `apply_ms`（寫檔＋`releaseTask`＋`saveRegistry`）≈ **2.2 ms** vs control **0.11 ms**。

**解讀**
1. **有真實思考時間時（A），ATM 幾乎不拖慢整體**：wall 只慢 ~3%（~40 ms / 1.5 s），因為 wall 由排程節奏（30 trials × 50 ms tick）決定，ATM 每筆 ~5 ms 被 20–60 ms 的 hold 吸收；但**每筆 total 慢 ~11%**，`schedule_lag_ms` p95 從 18.6 → 76.3 ms（排程尾端開始積壓）。
2. **沒有思考時間時（B），ATM 是瓶頸**：throughput 降到 ~225 intents/s（control ~2057），**9.1× 慢**。ATM 每筆 ~4.3 ms 的同步工作在單一 event loop 上是**串行**的：Σoverhead_ms ≈ 720 ms ≈ wall 747 ms → 吞吐上限 ≈ 1000/4.4 ≈ 225/s，與實測吻合。
3. **換來的是正確性**：paced 下 goodput（oracle-pass/s）ATM **103.4 vs control 71.2（1.45×）**——control 168 筆有 60 筆 lost update；ATM 0 lost update（7 筆 reject）。unpaced 下 control 太快，goodput 仍是 control 高（ATM/control = 0.15×），但 control 依然有 lost update（每 rep 168 筆中僅 122 筆存活）。
4. **冷 vs 熱**：ATM 的 per-intent 成本冷熱差不多（overhead p50 冷 5.28 / 熱 5.06 ms；latency p95 冷 4.29 / 熱 4.74 ms）。決策類別中 `composer_merge` 稍貴（latency p50 3.08 ms）、`reject` 最便宜（~0.9 ms，而且省掉 hold，所以 paired Δtotal 為負）。本跑**沒有冷檔排隊**（`wait_ms` 全 0），所以「冷排隊造成的等待延遲」**尚未被量到**——見 Gaps。

## 欄位定義（events `decision` 事件新增）

| 欄位 | 意義 |
|---|---|
| `latency_ms` | submit → 決策可用（ATM：`broker.admit()` 回傳，含 lock＋queue 等待；control：無准入步驟，≈0） |
| `wait_ms` | 排隊等待（既有；含 provisional promotion 等待） |
| `broker_ms` | `latency_ms − wait_ms`（broker 計算＋critical section＋registry I/O） |
| `hold_ms` | 模擬思考/編輯時間（`sleep(hold_ms)` 實測值；兩邊相同 scenario） |
| `promotion_wait_ms` | hot provisional 等待 promotion（本跑皆 ≈0） |
| `apply_ms` | 寫檔＋version bump＋`ticket.release()`（real 會 `releaseTask`+`saveRegistry`） |
| `total_ms` | submit → decision 事件寫出 |
| `overhead_ms` | `total_ms − hold_ms`：**ATM 可能拖慢的部分** |
| `schedule_lag_ms` | 實際 submit 時間 − 排程時間（per-agent 積壓） |
| `t_submit_ms` / `t_done_ms` | 相對 run t0 的時間戳（畫圖用） |
| run-level | `wall_clock_ms`（首個 submit → 最後一個 decision）、`throughput_intents_per_s`、`throughput_committed_per_s`、`goodput_oracle_pass_per_s`（寫入 `export/summary.json → modes.<m>.latency` 與 `meta.json → modes.<m>`） |

匯出：`runs/<run>/export/timings.csv`（每筆 decision 一列）、`trials.csv`（新增 atm_/control_ latency/apply/total/overhead 欄）、`decisions.csv`（新增 p50/p95 latency/total/overhead）。

---

## A. Paced（要求的 small dual run；rep1：`small-atm-seed42` vs `small-control-seed42`）


### Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `small-atm-seed42` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |

### Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 1557.15 ms | 1517.18 ms | 39.97 ms | 1.03× |
| throughput (intents/s) | 107.89 | 110.73 | — | 1.03× (control/ATM) |
| goodput (oracle-pass intents/s) | 103.39 | 71.18 | — | ATM/control = 1.45× |
| per-intent total_ms mean | 44.94 | 40.57 | 4.37 ms | 1.11× |
| per-intent total_ms p95 | 65.5 | 58.82 | 6.68 ms | 1.11× |
| per-intent overhead_ms mean (total − hold) | 5.3 | 0.2 | 5.1 ms | 26.5× |
| per-intent overhead_ms p95 | 7.07 | 0.29 | 6.78 ms | 24.38× |

Per-rep wall ms — ATM: 1557.15 · control: 1517.18
Per-rep throughput — ATM: 107.89 · control: 110.73

### Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 3.02 | 2.92 | 4.31 | 6.08 | 0 | 0 | 0 | 0 | 3.02 | 4.31 |
| wait_ms | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| broker_ms | 3.02 | 2.92 | 4.31 | 6.08 | 0 | 0 | 0 | 0 | 3.02 | 4.31 |
| hold_ms | 39.64 | 41.22 | 59.98 | 61.64 | 40.37 | 41.21 | 58.63 | 60.41 | -0.73 | 1.35 |
| apply_ms | 2.19 | 2.13 | 3.33 | 5.09 | 0.11 | 0.11 | 0.18 | 0.27 | 2.08 | 3.15 |
| total_ms | 44.94 | 46.35 | 65.5 | 67.34 | 40.57 | 41.44 | 58.82 | 60.57 | 4.37 | 6.68 |
| overhead_ms | 5.3 | 5.25 | 7.07 | 9.44 | 0.2 | 0.19 | 0.29 | 0.71 | 5.1 | 6.78 |
| schedule_lag_ms | 21.01 | 12.68 | 76.26 | 125.41 | 3.96 | 1.04 | 18.62 | 30.96 | 17.05 | 57.64 |

### Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 112/112 | latency_ms | 2.98 | 4.29 | 0 | 0 | 2.98 | 4.29 |
| cold | 112/112 | apply_ms | 2.15 | 3.41 | 0.11 | 0.17 | 2.04 | 3.24 |
| cold | 112/112 | overhead_ms | 5.28 | 6.97 | 0.19 | 0.28 | 5.09 | 6.69 |
| cold | 112/112 | total_ms | 45.74 | 65.5 | 40.17 | 58.82 | 5.57 | 6.68 |
| hot | 56/56 | latency_ms | 2.77 | 4.74 | 0 | 0 | 2.77 | 4.74 |
| hot | 56/56 | apply_ms | 2.05 | 3.14 | 0.11 | 0.22 | 1.94 | 2.92 |
| hot | 56/56 | overhead_ms | 5.06 | 7.73 | 0.19 | 0.36 | 4.87 | 7.37 |
| hot | 56/56 | total_ms | 47.28 | 65.88 | 44.61 | 58.87 | 2.67 | 7.01 |

### ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 61 | 2.88 | 4.25 | 0 | 5.13 | 6.97 | 47.33 | 65.69 |
| composer_merge | 62 | 3.08 | 4.29 | 0 | 5.48 | 7.25 | 45.73 | 64.65 |
| hot_provisional | 38 | 2.78 | 4.74 | 0 | 5.25 | 7.73 | 48.31 | 65.93 |
| reject | 7 | 0.88 | 1.45 | 0 | 0.96 | 1.63 | 0.96 | 1.63 |

### Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 168 | 4.38 | 5.77 | 10.26 | 5.1 | 6.89 |
| temperature:cold | 112 | 6.42 | 5.81 | 11.25 | 5.28 | 6.79 |
| temperature:hot | 56 | 0.29 | 5.41 | 10.23 | 4.74 | 7.44 |
| atm_decision:admit | 61 | 6.45 | 5.81 | 11.25 | 5.16 | 6.79 |
| atm_decision:composer_merge | 62 | 6.39 | 5.83 | 9.81 | 5.48 | 7.08 |
| atm_decision:hot_provisional | 38 | 6.08 | 5.44 | 12.57 | 5.15 | 7.44 |
| atm_decision:reject | 7 | -40.78 | -43.73 | -20 | 0.88 | 1.48 |


## A′. Paced ×5 reps（rep1 + `-r2`…`-r5`，同 seed）


### Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `small-atm-seed42` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `small-atm-seed42-r2` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `small-atm-seed42-r3` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `small-atm-seed42-r4` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `small-atm-seed42-r5` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42-r2` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42-r3` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42-r4` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42-r5` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |

### Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 1560.05 ms | 1516.23 ms | 43.82 ms | 1.03× |
| throughput (intents/s) | 107.69 | 110.8 | — | 1.03× (control/ATM) |
| goodput (oracle-pass intents/s) | 103.08 | 71.1 | — | ATM/control = 1.45× |
| per-intent total_ms mean | 44.96 | 40.58 | 4.38 ms | 1.11× |
| per-intent total_ms p95 | 64.81 | 58.44 | 6.37 ms | 1.11× |
| per-intent overhead_ms mean (total − hold) | 5.21 | 0.2 | 5.01 ms | 26.05× |
| per-intent overhead_ms p95 | 7.14 | 0.29 | 6.85 ms | 24.62× |

Per-rep wall ms — ATM: 1557.15, 1571.88, 1556.79, 1552.14, 1562.3 · control: 1517.18, 1516.43, 1516.14, 1516.3, 1515.09
Per-rep throughput — ATM: 107.89, 106.88, 107.91, 108.24, 107.53 · control: 110.73, 110.79, 110.81, 110.8, 110.88

### Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 2.92 | 2.86 | 4.34 | 7.93 | 0 | 0 | 0 | 0.01 | 2.92 | 4.34 |
| wait_ms | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| broker_ms | 2.92 | 2.86 | 4.34 | 7.93 | 0 | 0 | 0 | 0 | 2.92 | 4.34 |
| hold_ms | 39.75 | 41.23 | 59.68 | 66.54 | 40.37 | 41.14 | 58.21 | 60.69 | -0.62 | 1.47 |
| apply_ms | 2.2 | 2.13 | 3.55 | 5.48 | 0.11 | 0.11 | 0.18 | 0.64 | 2.09 | 3.37 |
| total_ms | 44.96 | 46.25 | 64.81 | 71.83 | 40.58 | 41.33 | 58.44 | 60.91 | 4.38 | 6.37 |
| overhead_ms | 5.21 | 5.17 | 7.14 | 10.93 | 0.2 | 0.19 | 0.29 | 0.8 | 5.01 | 6.85 |
| schedule_lag_ms | 21.06 | 12.16 | 74.15 | 145.88 | 3.94 | 0.99 | 18.88 | 31.16 | 17.12 | 55.27 |

### Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 560/560 | latency_ms | 2.9 | 4.25 | 0 | 0 | 2.9 | 4.25 |
| cold | 560/560 | apply_ms | 2.15 | 3.49 | 0.11 | 0.18 | 2.04 | 3.31 |
| cold | 560/560 | overhead_ms | 5.18 | 7.02 | 0.19 | 0.28 | 4.99 | 6.74 |
| cold | 560/560 | total_ms | 45.74 | 64.63 | 40.06 | 58.31 | 5.68 | 6.32 |
| hot | 280/280 | latency_ms | 2.78 | 4.72 | 0 | 0 | 2.78 | 4.72 |
| hot | 280/280 | apply_ms | 2.08 | 3.58 | 0.11 | 0.2 | 1.97 | 3.38 |
| hot | 280/280 | overhead_ms | 5.13 | 7.66 | 0.2 | 0.36 | 4.93 | 7.3 |
| hot | 280/280 | total_ms | 47.62 | 65.38 | 45.12 | 58.7 | 2.5 | 6.68 |

### ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 311 | 2.73 | 4.23 | 0 | 5.09 | 6.97 | 46.54 | 65.54 |
| composer_merge | 309 | 3.04 | 4.34 | 0 | 5.36 | 7.16 | 46.32 | 62.99 |
| hot_provisional | 184 | 2.84 | 4.78 | 0 | 5.19 | 7.91 | 49.96 | 66 |
| reject | 36 | 0.83 | 1.47 | 0 | 0.88 | 1.64 | 0.88 | 1.64 |

### Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 840 | 4.38 | 5.74 | 11.05 | 5.01 | 6.93 |
| temperature:cold | 560 | 6.33 | 5.81 | 10.78 | 5.15 | 6.79 |
| temperature:hot | 280 | 0.48 | 5.56 | 11.97 | 4.73 | 7.17 |
| atm_decision:admit | 311 | 6.3 | 5.66 | 10.95 | 5.03 | 6.78 |
| atm_decision:composer_merge | 309 | 6.29 | 5.87 | 10.29 | 5.33 | 6.92 |
| atm_decision:hot_provisional | 184 | 6.68 | 5.72 | 12.95 | 5.23 | 7.34 |
| atm_decision:reject | 36 | -40.39 | -44.15 | -19.24 | 0.84 | 1.48 |


## B. Unpaced 壓測 ×5 reps（`--tick-interval-ms 0 --hold-ms-min 0 --hold-ms-max 0 --jitter-ms 0`）

> 這組改了 timing 參數 → scenario_hash 與 A 不同（意圖序列/路徑相同，hold/jitter 值為 0）。僅用來量「沒有思考時間時 ATM 的吞吐上限」。


### Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `unpaced-atm-seed42-r1` | real | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| ATM | `unpaced-atm-seed42-r2` | real | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| ATM | `unpaced-atm-seed42-r3` | real | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| ATM | `unpaced-atm-seed42-r4` | real | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| ATM | `unpaced-atm-seed42-r5` | real | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| control | `unpaced-control-seed42-r1` | none | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| control | `unpaced-control-seed42-r2` | none | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| control | `unpaced-control-seed42-r3` | none | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| control | `unpaced-control-seed42-r4` | none | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |
| control | `unpaced-control-seed42-r5` | none | 42 | `1c17108e92e1…` | agents=6, trials=30, tick=0ms, hold=0–0ms, jitter=0ms |

### Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 747.27 ms | 81.73 ms | 665.54 ms | 9.14× |
| throughput (intents/s) | 225.35 | 2056.53 | — | 9.13× (control/ATM) |
| goodput (oracle-pass intents/s) | 216.7 | 1493.43 | — | ATM/control = 0.15× |
| per-intent total_ms mean | 15.43 | 1.45 | 13.98 ms | 10.64× |
| per-intent total_ms p95 | 20.85 | 2 | 18.85 ms | 10.43× |
| per-intent overhead_ms mean (total − hold) | 4.29 | 0.09 | 4.2 ms | 47.67× |
| per-intent overhead_ms p95 | 6.03 | 0.18 | 5.85 ms | 33.5× |

Per-rep wall ms — ATM: 758.59, 748.59, 747.23, 796.91, 685.04 · control: 84.08, 78.52, 81.5, 82.92, 81.65
Per-rep throughput — ATM: 221.46, 224.42, 224.83, 210.81, 245.24 · control: 1998.1, 2139.58, 2061.35, 2026.05, 2057.56

### Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 2.4 | 2.31 | 3.71 | 9.18 | 0 | 0 | 0 | 0.01 | 2.4 | 3.71 |
| wait_ms | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| broker_ms | 2.4 | 2.31 | 3.71 | 9.18 | 0 | 0 | 0 | 0 | 2.4 | 3.71 |
| hold_ms | 11.15 | 11.45 | 15.39 | 23.77 | 1.36 | 1.37 | 1.85 | 2.45 | 9.79 | 13.54 |
| apply_ms | 1.82 | 1.76 | 2.77 | 5.07 | 0.05 | 0.04 | 0.1 | 0.66 | 1.77 | 2.67 |
| total_ms | 15.43 | 15.75 | 20.85 | 33.28 | 1.45 | 1.46 | 2 | 2.66 | 13.98 | 18.85 |
| overhead_ms | 4.29 | 4.2 | 6.03 | 10.83 | 0.09 | 0.07 | 0.18 | 0.92 | 4.2 | 5.85 |
| schedule_lag_ms | 380.8 | 381.25 | 714.36 | 791.43 | 40.36 | 40.25 | 75.62 | 83.75 | 340.44 | 638.74 |

### Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 560/560 | latency_ms | 2.34 | 3.6 | 0 | 0 | 2.34 | 3.6 |
| cold | 560/560 | apply_ms | 1.77 | 2.76 | 0.04 | 0.1 | 1.73 | 2.66 |
| cold | 560/560 | overhead_ms | 4.22 | 5.84 | 0.07 | 0.18 | 4.15 | 5.66 |
| cold | 560/560 | total_ms | 15.93 | 20.03 | 1.46 | 1.85 | 14.47 | 18.18 |
| hot | 280/280 | latency_ms | 2.26 | 4.16 | 0 | 0 | 2.26 | 4.16 |
| hot | 280/280 | apply_ms | 1.73 | 2.85 | 0.04 | 0.11 | 1.69 | 2.74 |
| hot | 280/280 | overhead_ms | 4.13 | 6.51 | 0.08 | 0.2 | 4.05 | 6.31 |
| hot | 280/280 | total_ms | 15.39 | 21.9 | 1.46 | 2.1 | 13.93 | 19.8 |

### ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 393 | 2.21 | 3.49 | 0 | 4.15 | 5.65 | 15.73 | 19.91 |
| composer_merge | 207 | 2.53 | 4.01 | 0 | 4.42 | 6.16 | 16.37 | 21.22 |
| hot_provisional | 208 | 2.26 | 4.17 | 0 | 4.29 | 6.54 | 15.68 | 22.03 |
| reject | 32 | 0.64 | 2.26 | 0 | 0.69 | 2.43 | 0.69 | 2.43 |

### Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 840 | 13.98 | 14.3 | 19.06 | 4.19 | 5.95 |
| temperature:cold | 560 | 14.46 | 14.43 | 18.68 | 4.28 | 5.76 |
| temperature:hot | 280 | 13.01 | 13.85 | 19.9 | 4.02 | 6.45 |
| atm_decision:admit | 393 | 14.2 | 14.17 | 18.5 | 4.19 | 5.54 |
| atm_decision:composer_merge | 207 | 15.05 | 14.87 | 19.81 | 4.53 | 6.07 |
| atm_decision:hot_provisional | 208 | 14.74 | 14.31 | 20.68 | 4.39 | 6.48 |
| atm_decision:reject | 32 | -0.6 | -0.84 | 0.4 | 0.76 | 2.29 |


---

## 誠實註記 / Gaps

1. **單一 process**：6 個 agent 共用一個 Node event loop。ATM 的同步 fs 工作（`toWriteIntent` 讀檔、`saveRegistry` 每次讀+寫 registry store、每筆 2 次）會阻塞其他 agent → 在 B 中表現為 ATM 的 `hold_ms`（sleep(0)）被拉到 ~11 ms、`schedule_lag_ms` 暴增。所以 B 的 `overhead_ms` 低估了 ATM 的總影響，**以 `total_ms` / wall / throughput 為準**。多 process / 跨機 agent 的數字可能不同（未量）。
2. **`hold_ms` 是模擬思考時間**（20–60 ms sleep），不是真 LLM 延遲。真 LLM 每步是秒級，ATM ~5 ms/intent 的相對成本會更小；B 是最壞情況上界。
3. **control 的 `latency_ms`≈0 是定義使然**（沒有准入步驟），所以 latency 比值無意義，請看絕對 ms。
4. **沒有量到冷排隊延遲**：real ATM 在這個 fixture 上冷檔重疊多回 `compose`，`wait_ms` 全為 0；`cold_policy=queue` overlay 也沒觸發。「冷排隊要多等多久」需要另設會觸發 `queue` / `true-conflict` 的情境。
5. **推測（未 profile）**：broker_ms ~3 ms 的主要來源推測是 `saveRegistry`（`createBrokerRegistryStore().read()+write()` 同步 I/O）與每次 `readFileSync` 取 region span，而非 `calculateBrokerDecision` 本身。
6. **時序非決定性**：同 seed 每次決策直方圖略有浮動（例如 rep1 本次 `admit=61, composer_merge=62, hot_provisional=38, reject=7`；control `racy_overwrite=63`、lost=60）。重跑覆寫了 `small-*-seed42`，COMPARE_SMALL.md 已同步更新。
7. 未跑：CloudAgent、npm publish、Claim Plane、跨 process tick 准入。

## 重跑指令

```bash
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH   # Node ≥22（real 必備）
cd /workspace/reports/atm-v2-harness

# A：要求的 dual run（rep1）
node src/cli.mjs run-small --mode atm     --seed 42 --run-id small-atm-seed42     --agents 6 --trials 30 --atm-backend real --force
node src/cli.mjs run-small --mode control --seed 42 --run-id small-control-seed42 --agents 6 --trials 30 --force
node src/cli.mjs compare-latency --atm-run small-atm-seed42 --control-run small-control-seed42 \
  --report runs/compare/paced_rep1.md --json runs/compare/paced_rep1.json

# A′：再跑 r2..r5（run-id 加 -r2…-r5），然後
node src/cli.mjs compare-latency --atm-run small-atm-seed42,small-atm-seed42-r2,small-atm-seed42-r3,small-atm-seed42-r4,small-atm-seed42-r5 \
  --control-run small-control-seed42,small-control-seed42-r2,small-control-seed42-r3,small-control-seed42-r4,small-control-seed42-r5 \
  --report runs/compare/paced_5rep.md --json runs/compare/paced_5rep.json

# B：unpaced（r1..r5）
U="--tick-interval-ms 0 --hold-ms-min 0 --hold-ms-max 0 --jitter-ms 0"
node src/cli.mjs run-small --mode atm     --seed 42 --run-id unpaced-atm-seed42-r1     --agents 6 --trials 30 --atm-backend real $U --force
node src/cli.mjs run-small --mode control --seed 42 --run-id unpaced-control-seed42-r1 --agents 6 --trials 30 $U --force
# …r2..r5…；compare-latency --atm-run unpaced-atm-seed42-r1,…  --control-run unpaced-control-seed42-r1,…
```

Generator footers:
- A: Generated 2026-10-06T17:42:36.686+08:00 by `node src/cli.mjs compare-latency --atm-run small-atm-seed42 --control-run small-control-seed42` (Node v24.21.0).
- A′: Generated 2026-10-06T17:42:36.863+08:00 by `node src/cli.mjs compare-latency --atm-run small-atm-seed42,small-atm-seed42-r2,small-atm-seed42-r3,small-atm-seed42-r4,small-atm-seed42-r5 --control-run small-control-seed42,small-control-seed42-r2,small-control-seed42-r3,small-control-seed42-r4,small-control-seed42-r5` (Node v24.21.0).
- B: Generated 2026-10-06T17:42:37.057+08:00 by `node src/cli.mjs compare-latency --atm-run unpaced-atm-seed42-r1,unpaced-atm-seed42-r2,unpaced-atm-seed42-r3,unpaced-atm-seed42-r4,unpaced-atm-seed42-r5 --control-run unpaced-control-seed42-r1,unpaced-control-seed42-r2,unpaced-control-seed42-r3,unpaced-control-seed42-r4,unpaced-control-seed42-r5` (Node v24.21.0).

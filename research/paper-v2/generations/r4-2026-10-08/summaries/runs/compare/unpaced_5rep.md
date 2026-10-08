# COMPARE_LATENCY — ATM (real) vs control

## Runs

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

## Headline — ATM slowdown vs control

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

## Per-intent phases (pooled over reps; ms)

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

## Cold vs hot (by fixture temperature; ms)

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

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 393 | 2.21 | 3.49 | 0 | 4.15 | 5.65 | 15.73 | 19.91 |
| composer_merge | 207 | 2.53 | 4.01 | 0 | 4.42 | 6.16 | 16.37 | 21.22 |
| hot_provisional | 208 | 2.26 | 4.17 | 0 | 4.29 | 6.54 | 15.68 | 22.03 |
| reject | 32 | 0.64 | 2.26 | 0 | 0.69 | 2.43 | 0.69 | 2.43 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

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
Generated 2026-10-06T17:42:37.057+08:00 by `node src/cli.mjs compare-latency --atm-run unpaced-atm-seed42-r1,unpaced-atm-seed42-r2,unpaced-atm-seed42-r3,unpaced-atm-seed42-r4,unpaced-atm-seed42-r5 --control-run unpaced-control-seed42-r1,unpaced-control-seed42-r2,unpaced-control-seed42-r3,unpaced-control-seed42-r4,unpaced-control-seed42-r5` (Node v24.21.0).

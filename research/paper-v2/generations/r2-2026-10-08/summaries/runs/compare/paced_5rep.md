# COMPARE_LATENCY — ATM (real) vs control

## Runs

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

## Headline — ATM slowdown vs control

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

## Per-intent phases (pooled over reps; ms)

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

## Cold vs hot (by fixture temperature; ms)

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

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 311 | 2.73 | 4.23 | 0 | 5.09 | 6.97 | 46.54 | 65.54 |
| composer_merge | 309 | 3.04 | 4.34 | 0 | 5.36 | 7.16 | 46.32 | 62.99 |
| hot_provisional | 184 | 2.84 | 4.78 | 0 | 5.19 | 7.91 | 49.96 | 66 |
| reject | 36 | 0.83 | 1.47 | 0 | 0.88 | 1.64 | 0.88 | 1.64 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 840 | 4.38 | 5.74 | 11.05 | 5.01 | 6.93 |
| temperature:cold | 560 | 6.33 | 5.81 | 10.78 | 5.15 | 6.79 |
| temperature:hot | 280 | 0.48 | 5.56 | 11.97 | 4.73 | 7.17 |
| atm_decision:admit | 311 | 6.3 | 5.66 | 10.95 | 5.03 | 6.78 |
| atm_decision:composer_merge | 309 | 6.29 | 5.87 | 10.29 | 5.33 | 6.92 |
| atm_decision:hot_provisional | 184 | 6.68 | 5.72 | 12.95 | 5.23 | 7.34 |
| atm_decision:reject | 36 | -40.39 | -44.15 | -19.24 | 0.84 | 1.48 |

---
Generated 2026-10-06T17:42:36.863+08:00 by `node src/cli.mjs compare-latency --atm-run small-atm-seed42,small-atm-seed42-r2,small-atm-seed42-r3,small-atm-seed42-r4,small-atm-seed42-r5 --control-run small-control-seed42,small-control-seed42-r2,small-control-seed42-r3,small-control-seed42-r4,small-control-seed42-r5` (Node v24.21.0).

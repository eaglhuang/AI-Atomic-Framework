# COMPARE_LATENCY — ATM (real) vs control

## Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `cq-real-a8-r1` | real | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-real-a8-r2` | real | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-real-a8-r3` | real | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a8-r1` | none | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a8-r2` | none | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a8-r3` | none | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |

## Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 6154.53 ms | 3024.96 ms | 3129.57 ms | 2.03× |
| throughput (intents/s) | 71.66 | 145.79 | — | 2.03× (control/ATM) |
| goodput (oracle-pass intents/s) | 71.66 | 20.5 | — | ATM/control = 3.5× |
| per-intent total_ms mean | 95.66 | 40.28 | 55.38 ms | 2.37× |
| per-intent total_ms p95 | 272.79 | 59.06 | 213.73 ms | 4.62× |
| per-intent overhead_ms mean (total − hold) | 54.43 | 0.18 | 54.25 ms | 302.39× |
| per-intent overhead_ms p95 | 228.86 | 0.3 | 228.56 ms | 762.87× |

Per-rep wall ms — ATM: 6214.14, 6148.24, 6101.2 · control: 3025.85, 3023.85, 3025.17
Per-rep throughput — ATM: 70.97, 71.73, 72.28 · control: 145.74, 145.84, 145.78

## Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 51.98 | 11.72 | 225.58 | 343.56 | 0 | 0 | 0 | 0 | 51.98 | 225.58 |
| wait_ms | 49.46 | 10 | 224 | 342 | 0 | 0 | 0 | 0 | 49.46 | 224 |
| broker_ms | 2.53 | 2.43 | 3.78 | 7.01 | 0 | 0 | 0 | 0 | 2.53 | 3.78 |
| hold_ms | 41.23 | 41.52 | 59.55 | 68.06 | 40.1 | 40.27 | 58.88 | 60.96 | 1.13 | 0.67 |
| apply_ms | 2.38 | 2.21 | 3.76 | 6.36 | 0.11 | 0.1 | 0.19 | 0.73 | 2.27 | 3.57 |
| total_ms | 95.66 | 63.49 | 272.79 | 390.91 | 40.28 | 40.46 | 59.06 | 61.12 | 55.38 | 213.73 |
| overhead_ms | 54.43 | 13.42 | 228.86 | 345.62 | 0.18 | 0.16 | 0.3 | 0.82 | 54.25 | 228.56 |
| schedule_lag_ms | 1546.29 | 1526.97 | 2962.16 | 3223.05 | 3.12 | 0.43 | 18.16 | 32.29 | 1543.17 | 2944 |

## Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 1323/1323 | latency_ms | 11.72 | 225.58 | 0 | 0 | 11.72 | 225.58 |
| cold | 1323/1323 | apply_ms | 2.21 | 3.76 | 0.1 | 0.19 | 2.11 | 3.57 |
| cold | 1323/1323 | overhead_ms | 13.42 | 228.86 | 0.16 | 0.3 | 13.26 | 228.56 |
| cold | 1323/1323 | total_ms | 63.49 | 272.79 | 40.46 | 59.06 | 23.03 | 213.73 |

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 616 | 2.41 | 3.62 | 0 | 4.86 | 6.74 | 45.62 | 64.84 |
| cold_queue | 707 | 65.7 | 270.53 | 268 | 68.08 | 273.84 | 111.99 | 314.96 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 1323 | 55.38 | 16.21 | 228.46 | 54.25 | 228.69 |
| temperature:cold | 1323 | 55.38 | 16.21 | 228.46 | 54.25 | 228.69 |
| atm_decision:admit | 616 | 6.07 | 5.42 | 11.24 | 4.85 | 6.59 |
| atm_decision:cold_queue | 707 | 98.34 | 69.81 | 273.93 | 97.3 | 273.67 |

---
Generated 2026-10-06T17:55:40.248+08:00 by `node src/cli.mjs compare-latency --atm-run cq-real-a8-r1,cq-real-a8-r2,cq-real-a8-r3 --control-run cq-control-a8-r1,cq-control-a8-r2,cq-control-a8-r3` (Node v24.21.0).

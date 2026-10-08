# COMPARE_LATENCY — ATM (real) vs control

## Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `cq-mock-a8-r1` | mock | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-mock-a8-r2` | mock | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-mock-a8-r3` | mock | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a8-r1` | none | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a8-r2` | none | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a8-r3` | none | 42 | `75dd85234758…` | agents=8, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |

## Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 5436.49 ms | 3024.96 ms | 2411.53 ms | 1.8× |
| throughput (intents/s) | 81.13 | 145.79 | — | 1.8× (control/ATM) |
| goodput (oracle-pass intents/s) | 81.13 | 20.5 | — | ATM/control = 3.96× |
| per-intent total_ms mean | 86.12 | 40.28 | 45.84 ms | 2.14× |
| per-intent total_ms p95 | 253.82 | 59.06 | 194.76 ms | 4.3× |
| per-intent overhead_ms mean (total − hold) | 45.99 | 0.18 | 45.81 ms | 255.5× |
| per-intent overhead_ms p95 | 216.09 | 0.3 | 215.79 ms | 720.3× |

Per-rep wall ms — ATM: 5440.05, 5497.36, 5372.05 · control: 3025.85, 3023.85, 3025.17
Per-rep throughput — ATM: 81.07, 80.22, 82.09 · control: 145.74, 145.84, 145.78

## Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 45.76 | 12.52 | 215.72 | 300.36 | 0 | 0 | 0 | 0 | 45.76 | 215.72 |
| wait_ms | 45.69 | 13 | 216 | 300 | 0 | 0 | 0 | 0 | 45.69 | 216 |
| broker_ms | 0.14 | 0.01 | 0.7 | 1.2 | 0 | 0 | 0 | 0 | 0.14 | 0.7 |
| hold_ms | 40.12 | 40.46 | 58.85 | 61.19 | 40.1 | 40.27 | 58.88 | 60.96 | 0.02 | -0.03 |
| apply_ms | 0.15 | 0.14 | 0.25 | 0.92 | 0.11 | 0.1 | 0.19 | 0.73 | 0.04 | 0.06 |
| total_ms | 86.12 | 58.88 | 253.82 | 346.01 | 40.28 | 40.46 | 59.06 | 61.12 | 45.84 | 194.76 |
| overhead_ms | 45.99 | 12.76 | 216.09 | 300.61 | 0.18 | 0.16 | 0.3 | 0.82 | 45.81 | 215.79 |
| schedule_lag_ms | 1179.54 | 1114.16 | 2336.7 | 2531.3 | 3.12 | 0.43 | 18.16 | 32.29 | 1176.42 | 2318.54 |

## Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 1323/1323 | latency_ms | 12.52 | 215.72 | 0 | 0 | 12.52 | 215.72 |
| cold | 1323/1323 | apply_ms | 0.14 | 0.25 | 0.1 | 0.19 | 0.04 | 0.06 |
| cold | 1323/1323 | overhead_ms | 12.76 | 216.09 | 0.16 | 0.3 | 12.6 | 215.79 |
| cold | 1323/1323 | total_ms | 58.88 | 253.82 | 40.46 | 59.06 | 18.42 | 194.76 |

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 570 | 0.01 | 0.01 | 0 | 0.21 | 0.36 | 39.13 | 59.05 |
| cold_queue | 753 | 53.3 | 240.89 | 241 | 53.5 | 241.16 | 95.37 | 279.17 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 1323 | 45.84 | 12.52 | 216.06 | 45.82 | 215.78 |
| temperature:cold | 1323 | 45.84 | 12.52 | 216.06 | 45.82 | 215.78 |
| atm_decision:admit | 570 | 0.06 | 0.03 | 1.02 | 0.05 | 0.22 |
| atm_decision:cold_queue | 753 | 80.49 | 53.3 | 241.76 | 80.46 | 241.02 |

---
Generated 2026-10-06T17:55:40.476+08:00 by `node src/cli.mjs compare-latency --atm-run cq-mock-a8-r1,cq-mock-a8-r2,cq-mock-a8-r3 --control-run cq-control-a8-r1,cq-control-a8-r2,cq-control-a8-r3` (Node v24.21.0).

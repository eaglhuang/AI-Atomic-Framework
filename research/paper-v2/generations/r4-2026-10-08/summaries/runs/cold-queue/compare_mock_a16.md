# COMPARE_LATENCY — ATM (real) vs control

## Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `cq-mock-a16-r1` | mock | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-mock-a16-r2` | mock | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-mock-a16-r3` | mock | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a16-r1` | none | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a16-r2` | none | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a16-r3` | none | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |

## Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 7990.23 ms | 3028.31 ms | 4961.92 ms | 2.64× |
| throughput (intents/s) | 110.01 | 290.26 | — | 2.64× (control/ATM) |
| goodput (oracle-pass intents/s) | 110.01 | 21.13 | — | ATM/control = 5.21× |
| per-intent total_ms mean | 121.79 | 40.16 | 81.63 ms | 3.03× |
| per-intent total_ms p95 | 306.86 | 58.25 | 248.61 ms | 5.27× |
| per-intent overhead_ms mean (total − hold) | 81.79 | 0.14 | 81.65 ms | 584.21× |
| per-intent overhead_ms p95 | 265.03 | 0.26 | 264.77 ms | 1019.35× |

Per-rep wall ms — ATM: 8046.43, 7944.54, 7979.73 · control: 3028.9, 3028.25, 3027.79
Per-rep throughput — ATM: 109.24, 110.64, 110.15 · control: 290.2, 290.27, 290.31

## Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 81.58 | 45.29 | 264.75 | 558.73 | 0 | 0 | 0 | 0.01 | 81.58 | 264.75 |
| wait_ms | 81.49 | 45 | 265 | 559 | 0 | 0 | 0 | 0 | 81.49 | 265 |
| broker_ms | 0.17 | 0.01 | 0.72 | 1.18 | 0 | 0 | 0 | 0 | 0.17 | 0.72 |
| hold_ms | 40 | 40.36 | 58.13 | 61.01 | 40.02 | 40.19 | 58.14 | 60.94 | -0.02 | -0.01 |
| apply_ms | 0.13 | 0.13 | 0.21 | 0.81 | 0.09 | 0.08 | 0.19 | 0.66 | 0.04 | 0.02 |
| total_ms | 121.79 | 87.29 | 306.86 | 583.01 | 40.16 | 40.34 | 58.25 | 61.04 | 81.63 | 248.61 |
| overhead_ms | 81.79 | 45.57 | 265.03 | 558.97 | 0.14 | 0.13 | 0.26 | 0.69 | 81.65 | 264.77 |
| schedule_lag_ms | 2186.84 | 2051.1 | 4421.05 | 5030.85 | 2.76 | 0.52 | 15.51 | 35.79 | 2184.08 | 4405.54 |

## Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 2637/2637 | latency_ms | 45.29 | 264.75 | 0 | 0 | 45.29 | 264.75 |
| cold | 2637/2637 | apply_ms | 0.13 | 0.21 | 0.08 | 0.19 | 0.05 | 0.02 |
| cold | 2637/2637 | overhead_ms | 45.57 | 265.03 | 0.13 | 0.26 | 45.44 | 264.77 |
| cold | 2637/2637 | total_ms | 87.29 | 306.86 | 40.34 | 58.25 | 46.95 | 248.61 |

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 810 | 0 | 0.01 | 0 | 0.18 | 0.31 | 39.45 | 58.59 |
| cold_queue | 1827 | 93.99 | 297.4 | 297 | 94.23 | 297.65 | 135.23 | 342.53 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 2637 | 81.63 | 45.49 | 265.27 | 81.65 | 264.86 |
| temperature:cold | 2637 | 81.63 | 45.49 | 265.27 | 81.65 | 264.86 |
| atm_decision:admit | 810 | 0.05 | 0.05 | 1.03 | 0.06 | 0.19 |
| atm_decision:cold_queue | 1827 | 117.79 | 93.77 | 298.12 | 117.82 | 297.56 |

---
Generated 2026-10-06T17:55:41.494+08:00 by `node src/cli.mjs compare-latency --atm-run cq-mock-a16-r1,cq-mock-a16-r2,cq-mock-a16-r3 --control-run cq-control-a16-r1,cq-control-a16-r2,cq-control-a16-r3` (Node v24.21.0).

# COMPARE_LATENCY — ATM (real) vs control

## Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `cq-real-a16-r1` | real | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-real-a16-r2` | real | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| ATM | `cq-real-a16-r3` | real | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a16-r1` | none | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a16-r2` | none | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `cq-control-a16-r3` | none | 42 | `02660e85e1d4…` | agents=16, trials=60, tick=50ms, hold=20–60ms, jitter=15ms |

## Headline — ATM slowdown vs control

| metric | ATM | control | Δ (ATM − control) | slowdown |
|---|---|---|---|---|
| wall clock (mean over reps) | 9571.11 ms | 3028.31 ms | 6542.8 ms | 3.16× |
| throughput (intents/s) | 91.85 | 290.26 | — | 3.16× (control/ATM) |
| goodput (oracle-pass intents/s) | 91.85 | 21.13 | — | ATM/control = 4.35× |
| per-intent total_ms mean | 144.02 | 40.16 | 103.86 ms | 3.59× |
| per-intent total_ms p95 | 367.77 | 58.25 | 309.52 ms | 6.31× |
| per-intent overhead_ms mean (total − hold) | 100.94 | 0.14 | 100.8 ms | 721× |
| per-intent overhead_ms p95 | 324.2 | 0.26 | 323.94 ms | 1246.92× |

Per-rep wall ms — ATM: 9667.22, 9551.44, 9494.68 · control: 3028.9, 3028.25, 3027.79
Per-rep throughput — ATM: 90.93, 92.03, 92.58 · control: 290.2, 290.27, 290.31

## Per-intent phases (pooled over reps; ms)

| field | ATM mean | ATM p50 | ATM p95 | ATM max | ctrl mean | ctrl p50 | ctrl p95 | ctrl max | Δ mean | Δ p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| latency_ms | 98.54 | 56.88 | 322.07 | 654.84 | 0 | 0 | 0 | 0.01 | 98.54 | 322.07 |
| wait_ms | 95.82 | 54 | 319 | 652 | 0 | 0 | 0 | 0 | 95.82 | 319 |
| broker_ms | 2.72 | 2.61 | 4.06 | 7.7 | 0 | 0 | 0 | 0 | 2.72 | 4.06 |
| hold_ms | 43.08 | 43.32 | 61.32 | 72.59 | 40.02 | 40.19 | 58.14 | 60.94 | 3.06 | 3.18 |
| apply_ms | 2.34 | 2.17 | 3.64 | 9.34 | 0.09 | 0.08 | 0.19 | 0.66 | 2.25 | 3.45 |
| total_ms | 144.02 | 103.53 | 367.77 | 681.69 | 40.16 | 40.34 | 58.25 | 61.04 | 103.86 | 309.52 |
| overhead_ms | 100.94 | 59.21 | 324.2 | 657.51 | 0.14 | 0.13 | 0.26 | 0.69 | 100.8 | 323.94 |
| schedule_lag_ms | 2994.39 | 2851.62 | 5892.29 | 6641.35 | 2.76 | 0.52 | 15.51 | 35.79 | 2991.63 | 5876.78 |

## Cold vs hot (by fixture temperature; ms)

| temp | n (ATM/ctrl) | field | ATM p50 | ATM p95 | ctrl p50 | ctrl p95 | Δ p50 | Δ p95 |
|---|---|---|---|---|---|---|---|---|
| cold | 2637/2637 | latency_ms | 56.88 | 322.07 | 0 | 0 | 56.88 | 322.07 |
| cold | 2637/2637 | apply_ms | 2.17 | 3.64 | 0.08 | 0.19 | 2.09 | 3.45 |
| cold | 2637/2637 | overhead_ms | 59.21 | 324.2 | 0.13 | 0.26 | 59.08 | 323.94 |
| cold | 2637/2637 | total_ms | 103.53 | 367.77 | 40.34 | 58.25 | 63.19 | 309.52 |

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 799 | 2.62 | 3.9 | 0 | 4.99 | 6.76 | 49.28 | 66.97 |
| cold_queue | 1838 | 114.13 | 364.66 | 363 | 116.53 | 366.5 | 158.94 | 405.13 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 2637 | 103.86 | 63.34 | 326.22 | 100.8 | 324.13 |
| temperature:cold | 2637 | 103.86 | 63.34 | 326.22 | 100.8 | 324.13 |
| atm_decision:admit | 799 | 8.77 | 7.49 | 18.01 | 5 | 6.62 |
| atm_decision:cold_queue | 1838 | 145.2 | 119.68 | 368.61 | 142.44 | 366.37 |

---
Generated 2026-10-06T17:55:41.073+08:00 by `node src/cli.mjs compare-latency --atm-run cq-real-a16-r1,cq-real-a16-r2,cq-real-a16-r3 --control-run cq-control-a16-r1,cq-control-a16-r2,cq-control-a16-r3` (Node v24.21.0).

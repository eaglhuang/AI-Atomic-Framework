# COMPARE_LATENCY — ATM (real) vs control

## Runs

| side | run_id | atm_backend | seed | scenario_hash | params (timing) |
|---|---|---|---|---|---|
| ATM | `small-atm-seed42` | real | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |
| control | `small-control-seed42` | none | 42 | `80d54e045f6d…` | agents=6, trials=30, tick=50ms, hold=20–60ms, jitter=15ms |

## Headline — ATM slowdown vs control

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

## Per-intent phases (pooled over reps; ms)

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

## Cold vs hot (by fixture temperature; ms)

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

## ATM latency by decision class (ms)

| decision | n | latency p50 | latency p95 | wait p95 | overhead p50 | overhead p95 | total p50 | total p95 |
|---|---|---|---|---|---|---|---|---|
| admit | 61 | 2.88 | 4.25 | 0 | 5.13 | 6.97 | 47.33 | 65.69 |
| composer_merge | 62 | 3.08 | 4.29 | 0 | 5.48 | 7.25 | 45.73 | 64.65 |
| hot_provisional | 38 | 2.78 | 4.74 | 0 | 5.25 | 7.73 | 48.31 | 65.93 |
| reject | 7 | 0.88 | 1.45 | 0 | 0.96 | 1.63 | 0.96 | 1.63 |

## Paired per-intent Δ (same intent_id, ATM − control; ms)

| group | n | Δtotal mean | Δtotal p50 | Δtotal p95 | Δoverhead mean | Δoverhead p95 |
|---|---|---|---|---|---|---|
| all | 168 | 4.38 | 5.77 | 10.26 | 5.1 | 6.89 |
| temperature:cold | 112 | 6.42 | 5.81 | 11.25 | 5.28 | 6.79 |
| temperature:hot | 56 | 0.29 | 5.41 | 10.23 | 4.74 | 7.44 |
| atm_decision:admit | 61 | 6.45 | 5.81 | 11.25 | 5.16 | 6.79 |
| atm_decision:composer_merge | 62 | 6.39 | 5.83 | 9.81 | 5.48 | 7.08 |
| atm_decision:hot_provisional | 38 | 6.08 | 5.44 | 12.57 | 5.15 | 7.44 |
| atm_decision:reject | 7 | -40.78 | -43.73 | -20 | 0.88 | 1.48 |

---
Generated 2026-10-06T17:42:36.686+08:00 by `node src/cli.mjs compare-latency --atm-run small-atm-seed42 --control-run small-control-seed42` (Node v24.21.0).

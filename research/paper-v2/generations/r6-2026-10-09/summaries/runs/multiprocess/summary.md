
### Scenario A

| arm | wall ms | thr int/s | goodput/s | commits/rep | lost/rep (rate) | rejects | timeouts | errors | hist/rep | total mean/p95 | overhead mean/p95 | latency p50/p95 | wait p95/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control-sp | 1516.61 | 110.77 | 71.43 | 168 | 59.7 (35.5%) | 0 | 0 | 0 | direct_write 168 | 40.55 / 58.42 | 0.2 / 0.3 | 0 / 0 | 0 / 0 |
| control-p6 | 1516.17 | 110.81 | 71.23 | 168 | 60 (35.7%) | 0 | 0 | 0 | direct_write 168 | 40.88 / 58.67 | 0.45 / 0.64 | 0 / 0 | 0 / 0 |
| atm-sp | 1538.63 | 109.19 | 104.21 | 160.3 | 0 (0.0%) | 7.7 | 0 | 0 | reject 7.7, admit 62.3, composer_merge 60.7, hot_provisional 37.3 | 44.55 / 64.28 | 4.98 / 6.62 | 2.74 / 4.06 | 0 / 0 |
| atm-p6 | 1549.46 | 108.43 | 103.7 | 160.7 | 0 (0.0%) | 7.3 | 0 | 0 | reject 7.3, admit 62, composer_merge 59.7, hot_provisional 39 | 47.85 / 67.73 | 9.35 / 19.69 | 4.24 / 14.66 | 0 / 0 |

| arm (mp only) | distinct pids/rep | init ms | registry txns/rep | txns retried/rep | CAS conflicts (lock-busy / stale-gen) | naive lock-busy | max retries | polls | apply-lock spins | residue | overlapping holds same-file / same-region / same-region cross-proc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| control-p6 | 6,6,6 | 0 | 0 | 0 | 0 (0 / 0) | 0 | 0 | 0 | 0 | ,, | 105.7 / 89.7 / 89.7 |
| atm-p6 | 6,6,6 | 99.3 | 328.7 | 154.7 | 478.7 (444 / 34.7) | 0 | 14 | 0 | 0 | 0,0,0 | 85 / 74 / 74 |

per-rep wall: control-sp [1516.16, 1515.89, 1517.79]; control-p6 [1515.79, 1516.92, 1515.81]; atm-sp [1547.95, 1530.71, 1537.22]; atm-p6 [1559.87, 1554.84, 1533.67]

### Scenario B

| arm | wall ms | thr int/s | goodput/s | commits/rep | lost/rep (rate) | rejects | timeouts | errors | hist/rep | total mean/p95 | overhead mean/p95 | latency p50/p95 | wait p95/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control-sp | 2023.99 | 139.33 | 40.02 | 282 | 201 (71.3%) | 0 | 0 | 0 | direct_write 282 | 40.46 / 58.94 | 0.18 / 0.3 | 0 / 0 | 0 / 0 |
| control-p8 | 2024.1 | 139.32 | 40.02 | 282 | 201 (71.3%) | 0 | 0 | 0 | direct_write 282 | 40.79 / 59.56 | 0.44 / 0.62 | 0 / 0 | 0 / 0 |
| atm-sp | 2046.91 | 137.77 | 105.36 | 215.7 | 0 (0.0%) | 66.3 | 0 | 0 | composer_merge 170.3, hot_provisional 45.3, reject 66.3 | 37.06 / 65.55 | 4.43 / 7.08 | 2.73 / 4.54 | 0 / 0 |
| atm-p8 | 2038.98 | 138.3 | 99.56 | 203 | 0 (0.0%) | 79 | 0 | 0 | reject 79, hot_provisional 50, composer_merge 153 | 37.73 / 69.59 | 8.69 / 21.63 | 3.97 / 17.28 | 0 / 0 |
| atm-p4 | 2039.22 | 138.29 | 100.69 | 205.3 | 0 (0.0%) | 76.7 | 0 | 0 | reject 76.7, hot_provisional 51.7, composer_merge 153.7 | 36.36 / 67.65 | 6.97 / 15.75 | 3.45 / 12.22 | 0 / 0 |
| atmloop-sp | 2327.28 | 121.18 | 121.18 | 282 | 0 (0.0%) | 0 | 0 | 0 | composer_merge 239, hot_provisional 43 | 56.92 / 95.28 | 13.36 / 47.36 | 3.4 / 45.09 | 41 / 108 |
| atmloop-p8 | 2448.59 | 115.54 | 115.54 | 282 | 0 (0.0%) | 0 | 0 | 0 | composer_merge 232, hot_provisional 50 | 62.03 / 108.15 | 21.7 / 66.1 | 8.54 / 60.11 | 59 / 281 |
| atmnaive-p8 | 2132.12 | 132.34 | 91.83 | 195.7 | 0 (0.0%) | 86.3 | 0 | 0 | composer_merge 186.3, hot_provisional 9.3, reject 86.3 | 42.05 / 77.77 | 14.59 / 36.29 | 7.05 / 27.97 | 0 / 0 |
| atmnolock-p8 | 2040.22 | 138.22 | 98.35 | 202.7 | 2 (1.0%) | 79.3 | 0 | 0 | composer_merge 153.7, hot_provisional 49, reject 79.3 | 37.62 / 69.22 | 8.68 / 21.29 | 4.04 / 17 | 0 / 0 |

| arm (mp only) | distinct pids/rep | init ms | registry txns/rep | txns retried/rep | CAS conflicts (lock-busy / stale-gen) | naive lock-busy | max retries | polls | apply-lock spins | residue | overlapping holds same-file / same-region / same-region cross-proc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| control-p8 | 8,8,8 | 0 | 0 | 0 | 0 (0 / 0) | 0 | 0 | 0 | 0 | ,, | 760 / 245 / 245 |
| atm-p8 | 8,8,8 | 124.5 | 485 | 225.3 | 750.3 (694.3 / 56) | 0 | 15 | 0 | 2.3 | 0,0,0 | 399.3 / 107.7 / 107.7 |
| atm-p4 | 4,4,4 | 75.6 | 487.3 | 188 | 545 (496.7 / 48.3) | 0 | 15 | 0 | 3 | 0,0,0 | 408.3 / 111.3 / 98.7 |
| atmloop-p8 | 8,8,8 | 130.5 | 711.7 | 340.7 | 1237.3 (1127.3 / 110) | 0 | 20 | 729.7 | 4 | 0,0,0 | 566.7 / 121.7 / 121.7 |
| atmnaive-p8 | 8,8,8 | 128.1 | 477.7 | 205.3 | 0 (0 / 0) | 570.7 | 14 | 0 | 1.3 | 37,26,32 | 396 / 182.3 / 182.3 |
| atmnolock-p8 | 8,8,8 | 128.5 | 484.7 | 224.3 | 736 (678.3 / 57.7) | 0 | 18 | 0 | 0 | 0,0,0 | 380.7 / 101.3 / 101.3 |

per-rep wall: control-sp [2024.54, 2023.5, 2023.93]; control-p8 [2023.73, 2024.49, 2024.08]; atm-sp [2052.01, 2039.41, 2049.3]; atm-p8 [2039.1, 2041.42, 2036.41]; atm-p4 [2033.24, 2043.94, 2040.47]; atmloop-sp [2328.79, 2344.7, 2308.35]; atmloop-p8 [2359.7, 2648.46, 2337.62]; atmnaive-p8 [2191.62, 2069.56, 2135.19]; atmnolock-p8 [2036.85, 2035.87, 2047.95]

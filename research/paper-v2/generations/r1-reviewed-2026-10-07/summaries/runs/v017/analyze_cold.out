| group | arm | reps | wall ms (mean) | slowdown wall vs ctrl | thr int/s | goodput pass/s | total_ms mean / p50 / p95 | Δtotal mean vs ctrl | waited n (frac) | wait_ms p50 / p95 / p99 / max (waited) | commits / pass / lost per rep | reject / timeout per rep |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a8 | control a8 | 3 | 3024.25 | 1× | 145.82 | 20.61 | 40.37 / 40.58 / 59.03 | 0 (1×) | 0 (0) | 0 / 0 / 0 / 0 | 441 / 62.3 / 378.7 | 0 / 0 |
| a8 | REAL ATM (region atom id + loop overlay) a8 | 3 | 3393.93 | 1.12× | 129.99 | 129.99 | 51.01 / 50.8 / 70.62 | 10.64 (1.26×) | 0 (0) | 0 / 0 / 0 / 0 | 441 / 441 / 0 | 0 / 0 |
| a8 | MOCK ATM cold_queue a8 | 3 | 5472.01 | 1.81× | 80.59 | 80.59 | 86.58 / 58.41 / 242.54 | 46.21 (2.14×) | 745 (0.563) | 57 / 224 / 272 / 300 | 441 / 441 / 0 | 0 / 0 |
| a8 | REAL ATM legacy (intent atom id) a8 | 1 | 4459.09 | 1.47× | 98.9 | 98.9 | 69.02 / 65.83 / 110.45 | 28.65 (1.71×) | 286 (0.649) | 29 / 56 / 63 / 64 | 441 / 441 / 0 | 0 / 0 |
| a16 | control a16 | 3 | 3029.56 | 1× | 290.14 | 21.24 | 40.2 / 40.43 / 58.39 | 0 (1×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 64.3 / 814.7 | 0 / 0 |
| a16 | REAL ATM (region atom id + loop overlay) a16 | 3 | 6639.03 | 2.19× | 132.4 | 132.4 | 91.19 / 92.24 / 120.23 | 50.99 (2.27×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 879 / 0 | 0 / 0 |
| a16 | MOCK ATM cold_queue a16 | 3 | 7996.15 | 2.64× | 109.93 | 109.93 | 122.85 / 85.55 / 306.82 | 82.65 (3.06×) | 1880 (0.713) | 90 / 295 / 452 / 555 | 879 / 879 / 0 | 0 / 0 |
| a16 | REAL ATM legacy (intent atom id) a16 | 1 | 7026.09 | 2.32× | 125.11 | 125.11 | 100.47 / 100.63 / 142.37 | 60.27 (2.5×) | 774 (0.881) | 31 / 64 / 78 / 86 | 879 / 879 / 0 | 0 / 0 |
| one_file_a16 | control 1-file a16 | 1 | 3027.5 | 1× | 290.34 | 19.82 | 40.21 / 40.41 / 58.34 | 0 (1×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 60 / 819 | 0 / 0 |
| one_file_a16 | REAL 1-file a16 | 1 | 7354.3 | 2.43× | 119.52 | 119.52 | 100.11 / 101.25 / 131.76 | 59.9 (2.49×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 879 / 0 | 0 / 0 |
| one_file_a16 | MOCK 1-file a16 | 1 | 35786.77 | 11.82× | 24.56 | 24.56 | 630.72 / 643.06 / 724.79 | 590.51 (15.69×) | 878 (0.999) | 603 / 681 / 703 / 717 | 879 / 879 / 0 | 0 / 0 |

### wait_ms histogram (pooled decisions; counts)

| group | arm | 0 | (0,25] | (25,50] | (50,100] | (100,200] | (200,400] | (400,800] | (800,1600] | >1600 |
|---|---|---|---|---|---|---|---|---|---|---|
| a8 | control a8 | 1323 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a8 | REAL ATM (region atom id + loop overlay) a8 | 1323 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a8 | MOCK ATM cold_queue a8 | 578 | 188 | 151 | 179 | 150 | 77 | 0 | 0 | 0 |
| a8 | REAL ATM legacy (intent atom id) a8 | 155 | 128 | 130 | 28 | 0 | 0 | 0 | 0 | 0 |
| a16 | control a16 | 2637 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a16 | REAL ATM (region atom id + loop overlay) a16 | 2637 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a16 | MOCK ATM cold_queue a16 | 757 | 312 | 318 | 379 | 545 | 286 | 40 | 0 | 0 |
| a16 | REAL ATM legacy (intent atom id) a16 | 105 | 313 | 315 | 146 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | control 1-file a16 | 879 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | REAL 1-file a16 | 879 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | MOCK 1-file a16 | 1 | 0 | 1 | 1 | 7 | 16 | 853 | 0 | 0 |

### Decision / first-ATM-disposition histograms

| group | arm | decision_hist | atm_first_disposition | queue_rounds (waited) mean / p95 / max | schedule_lag p95 |
|---|---|---|---|---|---|
| a8 | control a8 | {"direct_write":1323} | {} | — | 17.91 |
| a8 | REAL ATM (region atom id + loop overlay) a8 | {"cold_queue":1096,"admit":227} | {"queue":1096,"direct":227} | — | 269.3 |
| a8 | MOCK ATM cold_queue a8 | {"cold_queue":746,"admit":577} | {} | — | 2397.61 |
| a8 | REAL ATM legacy (intent atom id) a8 | {"admit":441} | {} | — | 1340.25 |
| a16 | control a16 | {"direct_write":2637} | {} | — | 15.82 |
| a16 | REAL ATM (region atom id + loop overlay) a16 | {"admit":228,"cold_queue":2409} | {"direct":228,"queue":2409} | — | 3448.51 |
| a16 | MOCK ATM cold_queue a16 | {"admit":756,"cold_queue":1881} | {} | — | 4370.8 |
| a16 | REAL ATM legacy (intent atom id) a16 | {"admit":879} | {} | — | 3694.56 |
| one_file_a16 | control 1-file a16 | {"direct_write":879} | {} | — | 15.35 |
| one_file_a16 | REAL 1-file a16 | {"admit":1,"cold_queue":878} | {"direct":1,"queue":878} | — | 4107.34 |
| one_file_a16 | MOCK 1-file a16 | {"admit":1,"cold_queue":878} | {} | — | 30501.12 |

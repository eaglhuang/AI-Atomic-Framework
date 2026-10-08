| group | arm | reps | wall ms (mean) | slowdown wall vs ctrl | thr int/s | goodput pass/s | total_ms mean / p50 / p95 | Δtotal mean vs ctrl | waited n (frac) | wait_ms p50 / p95 / p99 / max (waited) | commits / pass / lost per rep | reject / timeout per rep |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a8 | control a8 | 3 | 3024.96 | 1× | 145.79 | 20.5 | 40.28 / 40.46 / 59.06 | 0 (1×) | 0 (0) | 0 / 0 / 0 / 0 | 441 / 62 / 379 | 0 / 0 |
| a8 | REAL ATM (region atom id + loop overlay) a8 | 3 | 6154.53 | 2.03× | 71.66 | 71.66 | 95.66 / 63.49 / 272.79 | 55.38 (2.37×) | 707 (0.534) | 63 / 268 / 304 / 342 | 441 / 441 / 0 | 0 / 0 |
| a8 | MOCK ATM cold_queue a8 | 3 | 5436.49 | 1.8× | 81.13 | 81.13 | 86.12 / 58.88 / 253.82 | 45.84 (2.14×) | 753 (0.569) | 53 / 241 / 274 / 300 | 441 / 441 / 0 | 0 / 0 |
| a8 | REAL ATM legacy (intent atom id) a8 | 1 | 3166.18 | 1.05× | 139.28 | 139.28 | 48.09 / 48.02 / 66.34 | 7.81 (1.19×) | 0 (0) | 0 / 0 / 0 / 0 | 441 / 441 / 0 | 0 / 0 |
| a16 | control a16 | 3 | 3028.31 | 1× | 290.26 | 21.13 | 40.16 / 40.34 / 58.25 | 0 (1×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 64 / 815 | 0 / 0 |
| a16 | REAL ATM (region atom id + loop overlay) a16 | 3 | 9571.11 | 3.16× | 91.84 | 91.84 | 144.02 / 103.53 / 367.77 | 103.86 (3.59×) | 1838 (0.697) | 111 / 363 / 503 / 652 | 879 / 879 / 0 | 0 / 0 |
| a16 | MOCK ATM cold_queue a16 | 3 | 7990.23 | 2.64× | 110.01 | 110.01 | 121.79 / 87.29 / 306.86 | 81.63 (3.03×) | 1827 (0.693) | 93 / 297 / 464 / 559 | 879 / 879 / 0 | 0 / 0 |
| a16 | REAL ATM legacy (intent atom id) a16 | 1 | 5858.48 | 1.93× | 150.04 | 150.04 | 80.56 / 81.6 / 106.38 | 40.4 (2.01×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 879 / 0 | 0 / 0 |
| one_file_a16 | control 1-file a16 | 1 | 3028.75 | 1× | 290.22 | 19.81 | 40.17 / 40.41 / 58.37 | 0 (1×) | 0 (0) | 0 / 0 / 0 / 0 | 879 / 60 / 819 | 0 / 0 |
| one_file_a16 | REAL 1-file a16 | 1 | 39962.3 | 13.19× | 22 | 22 | 700.59 / 715.21 / 801.65 | 660.42 (17.44×) | 878 (0.999) | 669 / 754 / 779 / 791 | 879 / 879 / 0 | 0 / 0 |
| one_file_a16 | MOCK 1-file a16 | 1 | 35671.11 | 11.78× | 24.64 | 24.64 | 628.73 / 641.73 / 723.21 | 588.56 (15.65×) | 878 (0.999) | 601 / 680 / 701 / 721 | 879 / 879 / 0 | 0 / 0 |

### wait_ms histogram (pooled decisions; counts)

| group | arm | 0 | (0,25] | (25,50] | (50,100] | (100,200] | (200,400] | (400,800] | (800,1600] | >1600 |
|---|---|---|---|---|---|---|---|---|---|---|
| a8 | control a8 | 1323 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a8 | REAL ATM (region atom id + loop overlay) a8 | 616 | 148 | 148 | 157 | 158 | 96 | 0 | 0 | 0 |
| a8 | MOCK ATM cold_queue a8 | 570 | 193 | 170 | 161 | 151 | 78 | 0 | 0 | 0 |
| a8 | REAL ATM legacy (intent atom id) a8 | 441 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a16 | control a16 | 2637 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a16 | REAL ATM (region atom id + loop overlay) a16 | 799 | 235 | 249 | 368 | 549 | 361 | 76 | 0 | 0 |
| a16 | MOCK ATM cold_queue a16 | 810 | 276 | 287 | 409 | 537 | 278 | 40 | 0 | 0 |
| a16 | REAL ATM legacy (intent atom id) a16 | 879 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | control 1-file a16 | 879 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | REAL 1-file a16 | 1 | 0 | 1 | 1 | 5 | 12 | 859 | 0 | 0 |
| one_file_a16 | MOCK 1-file a16 | 1 | 0 | 1 | 1 | 7 | 15 | 854 | 0 | 0 |

### Decision / first-ATM-disposition histograms

| group | arm | decision_hist | atm_first_disposition | queue_rounds (waited) mean / p95 / max | schedule_lag p95 |
|---|---|---|---|---|---|
| a8 | control a8 | {"direct_write":1323} | {} | — | 18.16 |
| a8 | REAL ATM (region atom id + loop overlay) a8 | {"cold_queue":707,"admit":616} | {"true-conflict":707,"direct":616} | 2.39 / 6 / 7 | 2962.16 |
| a8 | MOCK ATM cold_queue a8 | {"cold_queue":753,"admit":570} | {} | — | 2336.7 |
| a8 | REAL ATM legacy (intent atom id) a8 | {"composer_merge":383,"admit":58} | {} | — | 101.54 |
| a16 | control a16 | {"direct_write":2637} | {} | — | 15.51 |
| a16 | REAL ATM (region atom id + loop overlay) a16 | {"admit":799,"cold_queue":1838} | {"direct":799,"true-conflict":1838} | 3.31 / 8 / 15 | 5892.29 |
| a16 | MOCK ATM cold_queue a16 | {"admit":810,"cold_queue":1827} | {} | — | 4421.05 |
| a16 | REAL ATM legacy (intent atom id) a16 | {"admit":81,"composer_merge":798} | {} | — | 2671.8 |
| one_file_a16 | control 1-file a16 | {"direct_write":879} | {} | — | 15.13 |
| one_file_a16 | REAL 1-file a16 | {"admit":1,"cold_queue":878} | {"direct":1,"true-conflict":878} | 14.55 / 15 / 15 | 34399.31 |
| one_file_a16 | MOCK 1-file a16 | {"admit":1,"cold_queue":878} | {} | — | 30390.54 |

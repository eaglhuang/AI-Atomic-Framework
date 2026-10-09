| group | arm | cold_retry | reps | wall ms | vs ctrl | thr int/s | goodput | waited frac | wait p50/p95/max | commits/pass/lost | reject/timeout | first_disp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a8 | control a8 | once | 3 | 3024.78 | 1× | 145.8 | 20.5 | 0 | 0/0/0 | 441/62/379 | 0/0 | {} |
| a8 | native (once, region) a8 | once | 3 | 4299.97 | 1.42× | 102.57 | 102.57 | 0.689 | 25/55/70 | 441/441/0 | 0/0 | {} |
| a8 | native-queue-wait a8 | native-queue | 3 | 6208.2 | 2.05× | 71.04 | 71.04 | 0.559 | 62/259/350 | 441/441/0 | 0/0 | {"queue":740,"direct":583} |
| a16 | control a16 | once | 3 | 3027.87 | 1× | 290.3 | 21.14 | 0 | 0/0/0 | 879/64/815 | 0/0 | {} |
| a16 | native (once, region) a16 | once | 3 | 5873.42 | 1.94× | 149.66 | 149.66 | 0.889 | 29/60/85 | 879/879/0 | 0/0 | {} |
| a16 | native-queue-wait a16 | native-queue | 3 | 9416.48 | 3.11× | 93.35 | 93.35 | 0.705 | 105/343/637 | 879/879/0 | 0/0 | {"direct":778,"queue":1859} |
| one_file_a16 | control 1-file a16 | once | 1 | 3030.19 | 1× | 290.08 | 20.13 | 0 | 0/0/0 | 879/61/818 | 0/0 | {} |
| one_file_a16 | native 1-file a16 | once | 1 | 5549.11 | 1.83× | 158.4 | 158.4 | 0.997 | 22/56/68 | 879/879/0 | 0/0 | {} |
| one_file_a16 | nqwait 1-file a16 | native-queue | 1 | 40368.98 | 13.32× | 21.77 | 21.77 | 0.999 | 679/759/794 | 879/879/0 | 0/0 | {"direct":1,"queue":878} |

### wait_ms histogram

| group | arm | 0 | (0,25] | (25,50] | (50,100] | (100,200] | (200,400] | (400,800] | (800,1600] | >1600 |
|---|---|---|---|---|---|---|---|---|---|---|
| a8 | control a8 | 1323 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a8 | native (once, region) a8 | 411 | 458 | 360 | 94 | 0 | 0 | 0 | 0 | 0 |
| a8 | native-queue-wait a8 | 583 | 158 | 151 | 171 | 163 | 97 | 0 | 0 | 0 |
| a16 | control a16 | 2637 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a16 | native (once, region) a16 | 293 | 1028 | 998 | 318 | 0 | 0 | 0 | 0 | 0 |
| a16 | native-queue-wait a16 | 778 | 281 | 258 | 362 | 520 | 374 | 64 | 0 | 0 |
| one_file_a16 | control 1-file a16 | 879 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | native 1-file a16 | 3 | 488 | 272 | 116 | 0 | 0 | 0 | 0 | 0 |
| one_file_a16 | nqwait 1-file a16 | 1 | 0 | 1 | 1 | 5 | 12 | 859 | 0 | 0 |

### Decision / queue_rounds / queue_position

| group | arm | decision_hist | final_disp | queue_rounds mean/p95/max | queue_position mean/p95/max |
|---|---|---|---|---|---|
| a8 | control a8 | {"direct_write":1323} | {} | — | — |
| a8 | native (once, region) a8 | {"admit":1323} | {"direct":1323} | — | 1.48/3/5 |
| a8 | native-queue-wait a8 | {"cold_queue":740,"admit":583} | {"direct":1323} | 2.37/6/7 | 1/1/1 |
| a16 | control a16 | {"direct_write":2637} | {} | — | — |
| a16 | native (once, region) a16 | {"admit":2637} | {"direct":2637} | — | 2.09/5/12 |
| a16 | native-queue-wait a16 | {"admit":778,"cold_queue":1859} | {"direct":2637} | 3.26/8/15 | 1/1/1 |
| one_file_a16 | control 1-file a16 | {"direct_write":879} | {} | — | — |
| one_file_a16 | native 1-file a16 | {"admit":879} | {"direct":879} | — | 6.79/14/15 |
| one_file_a16 | nqwait 1-file a16 | {"admit":1,"cold_queue":878} | {"direct":879} | 14.55/15/15 | 1/1/1 |

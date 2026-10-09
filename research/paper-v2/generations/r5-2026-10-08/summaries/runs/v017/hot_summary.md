
### h1-a8

| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 2521.12 | 140.41 | 40.06 | 354 | 253 (71.5%) | 0 | 0 | direct_write 354 | 40.74 / 59.28 | 0.21 / 0.34 | 0 | — |
| native | 2556.76 | 138.46 | 104.56 | 267.3 | 0 (0.0%) | 86.7 | 0 | composer_merge 206.3, hot_provisional 61, reject 86.7 | 37.71 / 67.08 | 4.88 / 8.43 | 0 | — |
| loop | 3037.36 | 116.55 | 116.55 | 354 | 0 (0.0%) | 0 | 0 | composer_merge 299.3, hot_provisional 54.7 | 58.59 / 94.48 | 13.76 / 46.12 | 21 / 52 / 171 (0.301) | 1.54 / 6 |
| nativestale | 2552.9 | 138.67 | 35.91 | 261.7 | 170 (65.0%) | 92.3 | 0 | composer_merge 208, hot_provisional 53.7, reject 92.3 | 36.92 / 66.87 | 4.85 / 8.63 | 0 | — |
| loopstale | 3043.83 | 116.49 | 42.39 | 354 | 225 (63.6%) | 0 | 0 | composer_merge 294, hot_provisional 60 | 57.94 / 95.73 | 13.65 / 48.41 | 21 / 71 / 140 (0.282) | 1.59 / 5 |
| mock | 2520.17 | 140.47 | 111.63 | 281.3 | 0 (0.0%) | 72.7 | 0 | reject 72.7, admit 64.7, hot_provisional 108.7, composer_merge 108 | 33.94 / 58.96 | 1.47 / 10.44 | 33 / 54 / 59 (0.302) | — |

| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|---|---|
| control | direct_write | 354 | 1062 | 759 | 0 / 0 | 0 / 0 / 0 | 0.19 / 0.34 | 41.23 / 59.28 |
| native | composer_merge | 206.3 | 619 | 0 | 3.36 / 5.48 | 0 / 0 / 0 | 5.96 / 8.73 | 50.07 / 67.74 |
| native | hot_provisional | 61 | 183 | 0 | 2.99 / 5.14 | 0 / 0 / 0 | 5.63 / 8.51 | 48.75 / 69.41 |
| native | reject | 86.7 | 0 | 0 | 0.92 / 1.62 | 0 / 0 / 0 | 0.98 / 1.72 | 0.98 / 1.72 |
| loop | composer_merge | 299.3 | 898 | 0 | 4.04 / 42.47 | 0 / 37 / 171 | 6.96 / 44.66 | 55.95 / 93.37 |
| loop | hot_provisional | 54.7 | 164 | 0 | 3.86 / 52.07 | 0 / 48 / 116 | 7.15 / 54.32 | 55.2 / 99.35 |
| nativestale | composer_merge | 208 | 624 | 436 | 3.24 / 5.61 | 0 / 0 / 0 | 5.98 / 8.79 | 50.15 / 67.36 |
| nativestale | hot_provisional | 53.7 | 161 | 74 | 3.2 / 6.02 | 0 / 0 / 0 | 6.26 / 9.48 | 50.23 / 69.57 |
| nativestale | reject | 92.3 | 0 | 0 | 0.83 / 1.53 | 0 / 0 / 0 | 0.88 / 1.64 | 0.88 / 1.64 |
| loopstale | composer_merge | 294 | 882 | 618 | 3.83 / 43.74 | 0 / 38 / 140 | 6.57 / 46.48 | 55.2 / 91.47 |
| loopstale | hot_provisional | 60 | 180 | 57 | 3.83 / 50.9 | 0 / 48 / 138 | 6.57 / 53.6 | 56.51 / 107.09 |
| mock | reject | 72.7 | 0 | 0 | 0.01 / 0.02 | 0 / 0 / 0 | 0.04 / 0.14 | 0.04 / 0.14 |
| mock | admit | 64.7 | 194 | 0 | 0.01 / 0.03 | 0 / 0 / 0 | 0.24 / 0.49 | 40.54 / 59.11 |
| mock | hot_provisional | 108.7 | 326 | 0 | 0.01 / 0.04 | 33 / 54 / 59 | 0.42 / 18.62 | 45.93 / 59.58 |
| mock | composer_merge | 108 | 324 | 0 | 0.01 / 0.02 | 0 / 0 / 0 | 0.22 / 0.41 | 43.25 / 58.89 |

| arm | wait hist (all decisions) |
|---|---|
| control | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| native | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loop | 0:742 (0,25]:185 (25,50]:116 (50,100]:17 (100,200]:2 (200,400]:0 (400,800]:0 >800:0 |
| nativestale | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loopstale | 0:762 (0,25]:179 (25,50]:91 (50,100]:22 (100,200]:8 (200,400]:0 (400,800]:0 >800:0 |
| mock | 0:741 (0,25]:114 (25,50]:165 (50,100]:42 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |

| arm | reason_code hist (pooled) | atm_first_disposition |
|---|---|---|
| control | racy_overwrite:857, clean:134, concurrent_no_clobber:71 | — |
| native | atm_compose+cas_rebase:573, atm_true_conflict:260, atm_provisional_write_lease:146, atm_compose:46, atm_provisional_write_lease+cas_rebase:37 | — |
| loop | atm_compose+cas_rebase:601, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:263, atm_provisional_write_lease:101, overlay_wait_on_atm_true-conflict_then_proposal-required:42, atm_compose:27, atm_provisional_write_lease+cas_rebase:13, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:8, overlay_wait_on_atm_true-conflict_then_compose:7 | compose:628, proposal-required:114, true-conflict:320 |
| nativestale | atm_compose+cas_rebase:585, atm_true_conflict:277, atm_provisional_write_lease:126, atm_compose:39, atm_provisional_write_lease+cas_rebase:35 | — |
| loopstale | atm_compose+cas_rebase:610, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:232, atm_provisional_write_lease:109, overlay_wait_on_atm_true-conflict_then_proposal-required:48, atm_compose:29, atm_provisional_write_lease+cas_rebase:14, overlay_wait_on_atm_true-conflict_then_compose:11, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:9 | compose:639, proposal-required:123, true-conflict:300 |
| mock | hot_same_region_speculative+cas_rebase:326, hot_disjoint_region_cowrite+cas_rebase:270, provisional_depth_exceeded:218, hot_no_overlap:151, hot_disjoint_region_cowrite:54, hot_no_overlap+cas_rebase:43 | — |

hash 2cb8ffa82f1d; per-rep wall: control [2521.61, 2521.68, 2520.07]; native [2559.73, 2555.65, 2554.9]; loop [3036.96, 3024.52, 3050.59]; nativestale [2548.25, 2553.14, 2557.3]; loopstale [3069.3, 2883.65, 3178.55]; mock [2519.17, 2521.34, 2520.01]

### h1-a6

| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 2528.96 | 106.37 | 37.96 | 269 | 173 (64.3%) | 0 | 0 | direct_write 269 | 41.6 / 59.18 | 0.23 / 0.37 | 0 | — |
| native | 2544.24 | 105.73 | 80.7 | 205.3 | 0 (0.0%) | 63.7 | 0 | composer_merge 137, reject 63.7, hot_provisional 68.3 | 37.26 / 66.21 | 4.95 / 8.62 | 0 | — |
| loop | 2894.53 | 92.94 | 92.94 | 269 | 0 (0.0%) | 0 | 0 | composer_merge 201.7, hot_provisional 67.3 | 55.19 / 90.71 | 12.34 / 45.1 | 23 / 61 / 125 (0.238) | 1.33 / 4 |
| nativestale | 2557.66 | 105.18 | 37.54 | 209.3 | 113.3 (54.1%) | 59.7 | 0 | composer_merge 142.7, reject 59.7, hot_provisional 66.7 | 38.39 / 66.6 | 5.09 / 8.54 | 0 | — |
| loopstale | 2943.34 | 91.39 | 41.34 | 269 | 147.3 (54.8%) | 0 | 0 | composer_merge 201, hot_provisional 68 | 57 / 96.5 | 13.83 / 49.99 | 24 / 70 / 132 (0.264) | 1.39 / 4 |

| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|---|---|
| control | direct_write | 269 | 807 | 519 | 0 / 0 | 0 / 0 / 0 | 0.21 / 0.37 | 41.62 / 59.18 |
| native | composer_merge | 137 | 411 | 0 | 3.1 / 5.08 | 0 / 0 / 0 | 5.92 / 8.74 | 49.5 / 67.07 |
| native | reject | 63.7 | 0 | 0 | 0.77 / 1.33 | 0 / 0 / 0 | 0.83 / 1.39 | 0.83 / 1.39 |
| native | hot_provisional | 68.3 | 205 | 0 | 3.13 / 5.14 | 0 / 0 / 0 | 6.11 / 9.37 | 48.09 / 66.75 |
| loop | composer_merge | 201.7 | 605 | 0 | 3.27 / 37.41 | 0 / 33 / 125 | 6.2 / 39.55 | 53.24 / 81.93 |
| loop | hot_provisional | 67.3 | 202 | 0 | 3.29 / 54.12 | 0 / 51 / 94 | 6.23 / 56.46 | 56.14 / 99.62 |
| nativestale | composer_merge | 142.7 | 428 | 256 | 3.23 / 5.2 | 0 / 0 / 0 | 6.06 / 8.62 | 49.47 / 67.5 |
| nativestale | reject | 59.7 | 0 | 0 | 0.75 / 1.44 | 0 / 0 / 0 | 0.8 / 1.65 | 0.8 / 1.65 |
| nativestale | hot_provisional | 66.7 | 200 | 84 | 3.09 / 5.33 | 0 / 0 / 0 | 6.12 / 9.53 | 49.99 / 66.5 |
| loopstale | composer_merge | 201 | 603 | 380 | 3.5 / 42.12 | 0 / 39 / 132 | 6.64 / 44.48 | 54.69 / 92.69 |
| loopstale | hot_provisional | 68 | 204 | 62 | 3.87 / 54.68 | 0 / 52 / 98 | 6.91 / 57.61 | 56.01 / 102.7 |

| arm | wait hist (all decisions) |
|---|---|
| control | 0:807 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| native | 0:807 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loop | 0:615 (0,25]:100 (25,50]:73 (50,100]:17 (100,200]:2 (200,400]:0 (400,800]:0 >800:0 |
| nativestale | 0:807 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loopstale | 0:594 (0,25]:110 (25,50]:71 (50,100]:30 (100,200]:2 (200,400]:0 (400,800]:0 >800:0 |

| arm | reason_code hist (pooled) | atm_first_disposition |
|---|---|---|
| control | racy_overwrite:607, clean:148, concurrent_no_clobber:52 | — |
| native | atm_compose+cas_rebase:375, atm_true_conflict:191, atm_provisional_write_lease:174, atm_compose:36, atm_provisional_write_lease+cas_rebase:31 | — |
| loop | atm_compose+cas_rebase:442, atm_provisional_write_lease:130, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:120, overlay_wait_on_atm_true-conflict_then_proposal-required:51, atm_compose:31, atm_provisional_write_lease+cas_rebase:12, overlay_wait_on_atm_true-conflict_then_compose:12, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:9 | compose:473, proposal-required:142, true-conflict:192 |
| nativestale | atm_compose+cas_rebase:388, atm_true_conflict:179, atm_provisional_write_lease:170, atm_compose:40, atm_provisional_write_lease+cas_rebase:30 | — |
| loopstale | atm_compose+cas_rebase:427, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:121, atm_provisional_write_lease:110, overlay_wait_on_atm_true-conflict_then_proposal-required:65, atm_compose:38, atm_provisional_write_lease+cas_rebase:19, overlay_wait_on_atm_true-conflict_then_compose:17, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:10 | compose:465, proposal-required:129, true-conflict:213 |

hash 45e8fc470f05; per-rep wall: control [2528.94, 2530.27, 2527.68]; native [2550.48, 2539.88, 2542.36]; loop [2877.63, 2916.48, 2889.49]; nativestale [2544.9, 2553.3, 2574.77]; loopstale [2926.92, 2946.41, 2956.68]

### h08-a8

| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 2525.34 | 140.18 | 45.01 | 354 | 240.3 (67.9%) | 0 | 0 | direct_write 354 | 40.97 / 59.12 | 0.2 / 0.34 | 0 | — |
| native | 2683.38 | 131.94 | 106.1 | 284.7 | 0 (0.0%) | 69.3 | 0 | admit 98, hot_provisional 61, reject 69.3, composer_merge 125.7 | 46.89 / 95.2 | 12.07 / 52.34 | 33 / 57 / 62 (0.2) | — |
| loop | 3177.59 | 111.49 | 111.49 | 354 | 0 (0.0%) | 0 | 0 | admit 98, hot_provisional 69, composer_merge 187 | 60.58 / 103.76 | 16.52 / 54.1 | 27 / 60 / 137 (0.353) | 1.4 / 5 |
| nativestale | 2653.94 | 133.39 | 54.75 | 295 | 149.7 (50.7%) | 59 | 0 | admit 98, hot_provisional 59.7, reject 59, composer_merge 137.3 | 47.88 / 92.49 | 11.73 / 50.9 | 29 / 55 / 62 (0.205) | — |
| loopstale | 3111.23 | 113.82 | 62.27 | 354 | 160.3 (45.3%) | 0 | 0 | admit 98, hot_provisional 69, composer_merge 187 | 59.51 / 100.86 | 15.25 / 51.95 | 27 / 53 / 102 (0.322) | 1.41 / 5 |

| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|---|---|
| control | direct_write | 354 | 1062 | 721 | 0 / 0 | 0 / 0 / 0 | 0.18 / 0.34 | 41.57 / 59.12 |
| native | admit | 98 | 294 | 0 | 32.23 / 61.25 | 26 / 54 / 62 | 34.9 / 64.2 | 74.12 / 111.8 |
| native | hot_provisional | 61 | 183 | 0 | 2.98 / 4.97 | 0 / 0 / 0 | 5.89 / 8.7 | 51.13 / 69.77 |
| native | reject | 69.3 | 0 | 0 | 0.88 / 1.52 | 0 / 0 / 0 | 0.93 / 1.59 | 0.93 / 1.59 |
| native | composer_merge | 125.7 | 377 | 0 | 3.36 / 5.11 | 0 / 0 / 0 | 5.95 / 8.31 | 51.37 / 68.09 |
| loop | admit | 98 | 294 | 0 | 11.29 / 54.89 | 7 / 47 / 63 | 14.51 / 57.98 | 63.67 / 107.36 |
| loop | hot_provisional | 69 | 207 | 0 | 3.33 / 48.61 | 0 / 46 / 88 | 6.37 / 51.57 | 57.41 / 96.17 |
| loop | composer_merge | 187 | 561 | 0 | 3.71 / 48.55 | 0 / 44 / 137 | 6.48 / 51.06 | 55.52 / 101.32 |
| nativestale | admit | 98 | 294 | 116 | 28.81 / 57.68 | 22 / 54 / 62 | 31.26 / 60.65 | 70.75 / 107.66 |
| nativestale | hot_provisional | 59.7 | 179 | 70 | 2.97 / 5.3 | 0 / 0 / 0 | 5.58 / 8.25 | 50.03 / 68.35 |
| nativestale | reject | 59 | 0 | 0 | 0.88 / 1.41 | 0 / 0 / 0 | 0.93 / 1.47 | 0.93 / 1.47 |
| nativestale | composer_merge | 137.3 | 412 | 263 | 3.15 / 5.2 | 0 / 0 / 0 | 5.69 / 8.21 | 51.81 / 68.73 |
| loopstale | admit | 98 | 294 | 57 | 10.06 / 55.38 | 6 / 46 / 62 | 13.18 / 57.98 | 62.46 / 106.08 |
| loopstale | hot_provisional | 69 | 207 | 58 | 3.32 / 35.55 | 0 / 33 / 61 | 6.14 / 39.56 | 55.26 / 98.94 |
| loopstale | composer_merge | 187 | 561 | 366 | 3.58 / 44.09 | 0 / 41 / 102 | 6.35 / 46.87 | 55.07 / 93.2 |

| arm | wait hist (all decisions) |
|---|---|
| control | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| native | 0:850 (0,25]:62 (25,50]:124 (50,100]:26 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loop | 0:687 (0,25]:177 (25,50]:160 (50,100]:36 (100,200]:2 (200,400]:0 (400,800]:0 >800:0 |
| nativestale | 0:844 (0,25]:86 (25,50]:113 (50,100]:19 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loopstale | 0:720 (0,25]:156 (25,50]:163 (50,100]:22 (100,200]:1 (200,400]:0 (400,800]:0 >800:0 |

| arm | reason_code hist (pooled) | atm_first_disposition |
|---|---|---|
| control | racy_overwrite:783, clean:200, concurrent_no_clobber:79 | — |
| native | atm_compose+cas_rebase:350, atm_true_conflict:208, atm_direct:182, atm_provisional_write_lease:163, atm_direct+cas_rebase:112, atm_compose:27, atm_provisional_write_lease+cas_rebase:20 | — |
| loop | atm_compose+cas_rebase:379, atm_direct:233, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:147, atm_provisional_write_lease:132, atm_direct+cas_rebase:61, overlay_wait_on_atm_true-conflict_then_proposal-required:54, atm_compose:28, atm_provisional_write_lease+cas_rebase:17, overlay_wait_on_atm_true-conflict_then_compose:7, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:4 | proposal-required:149, compose:407, true-conflict:212 |
| nativestale | atm_compose+cas_rebase:382, atm_direct:178, atm_true_conflict:177, atm_provisional_write_lease:155, atm_direct+cas_rebase:116, atm_compose:30, atm_provisional_write_lease+cas_rebase:24 | — |
| loopstale | atm_compose+cas_rebase:390, atm_direct:237, atm_provisional_write_lease:142, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:126, atm_direct+cas_rebase:57, overlay_wait_on_atm_true-conflict_then_proposal-required:39, atm_compose:35, atm_provisional_write_lease+cas_rebase:20, overlay_wait_on_atm_true-conflict_then_compose:10, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:6 | proposal-required:162, compose:425, true-conflict:181 |

hash 7422724bbf62; per-rep wall: control [2525.18, 2525.06, 2525.77]; native [2703.15, 2701.88, 2645.11]; loop [3053.19, 3236.85, 3242.72]; nativestale [2670.41, 2664.06, 2627.34]; loopstale [3155.56, 3141.94, 3036.19]

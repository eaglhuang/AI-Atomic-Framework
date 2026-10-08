
### h1-a8

| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 2522.18 | 140.35 | 40.04 | 354 | 253 (71.5%) | 0 | 0 | direct_write 354 | 40.7 / 59.03 | 0.18 / 0.27 | 0 | — |
| native | 2549.13 | 138.87 | 105.92 | 270 | 0 (0.0%) | 84 | 0 | composer_merge 210, hot_provisional 60, reject 84 | 36.78 / 65.13 | 4.21 / 6.75 | 0 | — |
| loop | 2907.84 | 121.79 | 121.79 | 354 | 0 (0.0%) | 0 | 0 | composer_merge 299.7, hot_provisional 54.3 | 56.81 / 92.73 | 13.4 / 47.92 | 21 / 61 / 124 (0.318) | 1.62 / 5 |
| nativestale | 2550.26 | 138.81 | 36.6 | 266 | 172.7 (64.9%) | 88 | 0 | composer_merge 206, hot_provisional 60, reject 88 | 36.61 / 65.83 | 4.36 / 7.15 | 0 | — |
| loopstale | 2882.25 | 122.86 | 42.78 | 354 | 230.7 (65.2%) | 0 | 0 | composer_merge 297, hot_provisional 57 | 56.21 / 93.72 | 12.77 / 47.43 | 23 / 52 / 84 (0.292) | 1.6 / 6 |
| mock | 2521.77 | 140.38 | 111.69 | 281.7 | 0 (0.0%) | 72.3 | 0 | reject 72.3, admit 65.7, hot_provisional 106.7, composer_merge 109.3 | 33.92 / 58.75 | 1.38 / 10.48 | 34 / 55 / 59 (0.301) | — |

| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|---|---|
| control | direct_write | 354 | 1062 | 759 | 0 / 0 | 0 / 0 / 0 | 0.17 / 0.27 | 41.22 / 59.03 |
| native | composer_merge | 210 | 630 | 0 | 2.91 / 4.22 | 0 / 0 / 0 | 5.07 / 7.04 | 48.96 / 65.68 |
| native | hot_provisional | 60 | 180 | 0 | 2.66 / 4.39 | 0 / 0 / 0 | 5.11 / 7.1 | 47 / 67.85 |
| native | reject | 84 | 0 | 0 | 0.84 / 1.56 | 0 / 0 / 0 | 0.88 / 1.67 | 0.88 / 1.67 |
| loop | composer_merge | 299.7 | 899 | 0 | 3.4 / 42.9 | 0 / 40 / 124 | 5.86 / 45.05 | 55.12 / 92.6 |
| loop | hot_provisional | 54.3 | 163 | 0 | 3.29 / 56.64 | 0 / 54 / 101 | 5.76 / 58.62 | 53.89 / 101.17 |
| nativestale | composer_merge | 206 | 618 | 440 | 2.96 / 4.74 | 0 / 0 / 0 | 5.34 / 7.58 | 49.13 / 66.54 |
| nativestale | hot_provisional | 60 | 180 | 78 | 2.69 / 4.19 | 0 / 0 / 0 | 5.09 / 7.01 | 47.16 / 68.07 |
| nativestale | reject | 88 | 0 | 0 | 0.83 / 1.41 | 0 / 0 / 0 | 0.89 / 1.53 | 0.89 / 1.53 |
| loopstale | composer_merge | 297 | 891 | 629 | 3.3 / 45.61 | 0 / 41 / 84 | 5.63 / 47.88 | 53.96 / 94.45 |
| loopstale | hot_provisional | 57 | 171 | 63 | 3.45 / 44.96 | 0 / 43 / 73 | 6.07 / 47.43 | 54.27 / 90.01 |
| mock | reject | 72.3 | 0 | 0 | 0.01 / 0.02 | 0 / 0 / 0 | 0.05 / 0.13 | 0.05 / 0.13 |
| mock | admit | 65.7 | 197 | 0 | 0.01 / 0.02 | 0 / 0 / 0 | 0.2 / 0.34 | 41.43 / 59.19 |
| mock | hot_provisional | 106.7 | 320 | 0 | 0.01 / 0.03 | 34 / 55 / 59 | 0.37 / 16.57 | 46.38 / 59.68 |
| mock | composer_merge | 109.3 | 328 | 0 | 0.01 / 0.02 | 0 / 0 / 0 | 0.2 / 0.3 | 42.24 / 58.16 |

| arm | wait hist (all decisions) |
|---|---|
| control | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| native | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loop | 0:724 (0,25]:203 (25,50]:101 (50,100]:32 (100,200]:2 (200,400]:0 (400,800]:0 >800:0 |
| nativestale | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loopstale | 0:752 (0,25]:173 (25,50]:117 (50,100]:20 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| mock | 0:742 (0,25]:111 (25,50]:169 (50,100]:40 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |

| arm | reason_code hist (pooled) | atm_first_disposition |
|---|---|---|
| control | racy_overwrite:859, clean:136, concurrent_no_clobber:67 | — |
| native | atm_compose+cas_rebase:582, atm_true_conflict:252, atm_provisional_write_lease:138, atm_compose:48, atm_provisional_write_lease+cas_rebase:42 | — |
| loop | atm_compose+cas_rebase:577, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:274, atm_provisional_write_lease:92, overlay_wait_on_atm_true-conflict_then_proposal-required:45, atm_compose:36, atm_provisional_write_lease+cas_rebase:19, overlay_wait_on_atm_true-conflict_then_compose:12, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:7 | compose:613, proposal-required:111, true-conflict:338 |
| nativestale | atm_compose+cas_rebase:567, atm_true_conflict:264, atm_provisional_write_lease:136, atm_compose:51, atm_provisional_write_lease+cas_rebase:44 | — |
| loopstale | atm_compose+cas_rebase:606, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:245, atm_provisional_write_lease:99, overlay_wait_on_atm_true-conflict_then_proposal-required:51, atm_compose:32, atm_provisional_write_lease+cas_rebase:15, overlay_wait_on_atm_true-conflict_then_compose:8, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:6 | compose:638, proposal-required:114, true-conflict:310 |
| mock | hot_same_region_speculative+cas_rebase:320, hot_disjoint_region_cowrite+cas_rebase:268, provisional_depth_exceeded:217, hot_no_overlap:147, hot_disjoint_region_cowrite:60, hot_no_overlap+cas_rebase:50 | — |

hash 2cb8ffa82f1d; per-rep wall: control [2523.31, 2522.2, 2521.03]; native [2551.41, 2544.34, 2551.63]; loop [2978.59, 2833.77, 2911.16]; nativestale [2541.25, 2551.77, 2557.77]; loopstale [2956.9, 2858.45, 2831.41]; mock [2523.79, 2522.05, 2519.47]

### h1-a6

| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 2529.47 | 106.35 | 38.35 | 269 | 172 (63.9%) | 0 | 0 | direct_write 269 | 41.54 / 59.14 | 0.19 / 0.29 | 0 | — |
| native | 2548.88 | 105.54 | 82.39 | 210 | 0 (0.0%) | 59 | 0 | composer_merge 139.3, reject 59, hot_provisional 70.7 | 37.55 / 64.88 | 4.38 / 6.93 | 0 | — |
| loop | 2783.15 | 96.67 | 96.67 | 269 | 0 (0.0%) | 0 | 0 | composer_merge 198.3, hot_provisional 70.7 | 54.12 / 92.31 | 11.55 / 43.01 | 24 / 59 / 98 (0.243) | 1.42 / 4 |
| nativestale | 2541.85 | 105.83 | 36.72 | 209.7 | 116.3 (55.5%) | 59.3 | 0 | composer_merge 138.3, reject 59.3, hot_provisional 71.3 | 37.06 / 65.42 | 4.24 / 6.68 | 0 | — |
| loopstale | 2765.81 | 97.29 | 44.35 | 269 | 146.3 (54.4%) | 0 | 0 | composer_merge 200.3, hot_provisional 68.7 | 53.44 / 90.72 | 11.03 / 41.74 | 22 / 56 / 107 (0.235) | 1.49 / 4 |

| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|---|---|
| control | direct_write | 269 | 807 | 516 | 0 / 0 | 0 / 0 / 0 | 0.18 / 0.29 | 41.69 / 59.14 |
| native | composer_merge | 139.3 | 418 | 0 | 2.85 / 4.2 | 0 / 0 / 0 | 5.28 / 7.21 | 49.13 / 65.48 |
| native | reject | 59 | 0 | 0 | 0.74 / 1.35 | 0 / 0 / 0 | 0.8 / 1.52 | 0.8 / 1.52 |
| native | hot_provisional | 70.7 | 212 | 0 | 2.69 / 4.11 | 0 / 0 / 0 | 5.13 / 7.15 | 46.67 / 65.17 |
| loop | composer_merge | 198.3 | 595 | 0 | 3.04 / 42.14 | 0 / 39 / 98 | 5.53 / 44.06 | 53.72 / 93.85 |
| loop | hot_provisional | 70.7 | 212 | 0 | 2.98 / 39.39 | 0 / 36 / 79 | 5.51 / 42.84 | 52.9 / 89.38 |
| nativestale | composer_merge | 138.3 | 415 | 257 | 2.7 / 4.05 | 0 / 0 / 0 | 5.06 / 6.91 | 48.35 / 65.94 |
| nativestale | reject | 59.3 | 0 | 0 | 0.75 / 1.37 | 0 / 0 / 0 | 0.81 / 1.51 | 0.81 / 1.51 |
| nativestale | hot_provisional | 71.3 | 214 | 92 | 2.62 / 4.28 | 0 / 0 / 0 | 5.05 / 7.5 | 47.13 / 65.92 |
| loopstale | composer_merge | 200.3 | 601 | 377 | 3.01 / 38.51 | 0 / 37 / 107 | 5.4 / 41.38 | 52.98 / 91.61 |
| loopstale | hot_provisional | 68.7 | 206 | 62 | 2.91 / 41.1 | 0 / 38 / 81 | 5.38 / 44.29 | 53.6 / 86.77 |

| arm | wait hist (all decisions) |
|---|---|
| control | 0:807 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| native | 0:807 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loop | 0:611 (0,25]:110 (25,50]:69 (50,100]:17 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| nativestale | 0:807 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loopstale | 0:617 (0,25]:110 (25,50]:66 (50,100]:13 (100,200]:1 (200,400]:0 (400,800]:0 >800:0 |

| arm | reason_code hist (pooled) | atm_first_disposition |
|---|---|---|
| control | racy_overwrite:607, clean:143, concurrent_no_clobber:57 | — |
| native | atm_compose+cas_rebase:368, atm_true_conflict:177, atm_provisional_write_lease:174, atm_compose:50, atm_provisional_write_lease+cas_rebase:38 | — |
| loop | atm_compose+cas_rebase:415, atm_provisional_write_lease:137, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:134, overlay_wait_on_atm_true-conflict_then_proposal-required:48, atm_compose:41, atm_provisional_write_lease+cas_rebase:18, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:9, overlay_wait_on_atm_true-conflict_then_compose:5 | compose:456, proposal-required:155, true-conflict:196 |
| nativestale | atm_compose+cas_rebase:367, atm_true_conflict:178, atm_provisional_write_lease:175, atm_compose:48, atm_provisional_write_lease+cas_rebase:39 | — |
| loopstale | atm_compose+cas_rebase:419, atm_provisional_write_lease:135, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:135, overlay_wait_on_atm_true-conflict_then_proposal-required:40, atm_compose:40, atm_provisional_write_lease+cas_rebase:23, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:8, overlay_wait_on_atm_true-conflict_then_compose:7 | compose:459, proposal-required:158, true-conflict:190 |

hash 45e8fc470f05; per-rep wall: control [2529.66, 2531.02, 2527.74]; native [2559.49, 2541.45, 2545.7]; loop [2773.45, 2832.27, 2743.72]; nativestale [2543.91, 2542.94, 2538.71]; loopstale [2833.08, 2737.83, 2726.53]

### h08-a8

| arm | wall ms | thr int/s | goodput pass/s | commits/rep | lost/rep (rate) | rejects/rep | timeouts | hist (per rep) | total mean/p95 | overhead mean/p95 | wait p50/p95/max (waited frac) | rounds mean/max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| control | 2524.89 | 140.2 | 44.89 | 354 | 240.7 (68.0%) | 0 | 0 | direct_write 354 | 40.93 / 59.18 | 0.18 / 0.28 | 0 | — |
| native | 2569.79 | 137.76 | 111.29 | 286 | 0 (0.0%) | 68 | 0 | composer_merge 202.3, hot_provisional 57.7, reject 68, admit 26 | 38.9 / 65.98 | 4.53 / 7.02 | 0 | — |
| loop | 2767.7 | 127.93 | 127.93 | 354 | 0 (0.0%) | 0 | 0 | composer_merge 258.3, hot_provisional 58, admit 37.7 | 53.46 / 89.51 | 10.33 / 45.06 | 24 / 58 / 96 (0.189) | 1.46 / 6 |
| nativestale | 2559.7 | 138.3 | 40.37 | 292 | 188.7 (64.6%) | 62 | 0 | composer_merge 208, hot_provisional 57.7, reject 62, admit 26.3 | 39.47 / 65.06 | 4.49 / 6.78 | 0 | — |
| loopstale | 2768.91 | 127.85 | 56.22 | 354 | 198.3 (56.0%) | 0 | 0 | composer_merge 256.7, hot_provisional 58.3, admit 39 | 54.81 / 91.48 | 11.32 / 46.1 | 26 / 66 / 98 (0.201) | 1.46 / 5 |

| arm | decision | n/rep | commits | lost | latency p50/p95 | wait p50/p95/max | overhead p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|---|---|
| control | direct_write | 354 | 1062 | 722 | 0 / 0 | 0 / 0 / 0 | 0.17 / 0.28 | 41.42 / 59.18 |
| native | composer_merge | 202.3 | 607 | 0 | 3 / 4.44 | 0 / 0 / 0 | 5.25 / 7.36 | 48.05 / 66.67 |
| native | hot_provisional | 57.7 | 173 | 0 | 2.76 / 3.88 | 0 / 0 / 0 | 5.02 / 6.84 | 52.52 / 66.3 |
| native | reject | 68 | 0 | 0 | 0.81 / 1.39 | 0 / 0 / 0 | 0.86 / 1.5 | 0.86 / 1.5 |
| native | admit | 26 | 78 | 0 | 2.66 / 4.27 | 0 / 0 / 0 | 5.03 / 8.17 | 44.79 / 64.82 |
| loop | composer_merge | 258.3 | 775 | 0 | 3.19 / 45.3 | 0 / 42 / 96 | 5.51 / 47.54 | 52.4 / 92.5 |
| loop | hot_provisional | 58 | 174 | 0 | 3.07 / 40.34 | 0 / 38 / 82 | 5.36 / 43.14 | 51.89 / 91.61 |
| loop | admit | 37.7 | 113 | 0 | 2.86 / 3.84 | 0 / 0 / 0 | 4.96 / 6.42 | 45.81 / 65.42 |
| nativestale | composer_merge | 208 | 624 | 456 | 2.95 / 4.36 | 0 / 0 / 0 | 5.14 / 6.96 | 47.95 / 65.3 |
| nativestale | hot_provisional | 57.7 | 173 | 73 | 2.75 / 3.92 | 0 / 0 / 0 | 5.01 / 6.71 | 51.67 / 66.04 |
| nativestale | reject | 62 | 0 | 0 | 0.84 / 1.35 | 0 / 0 / 0 | 0.9 / 1.48 | 0.9 / 1.48 |
| nativestale | admit | 26.3 | 79 | 37 | 2.49 / 6.41 | 0 / 0 / 0 | 4.92 / 10.16 | 43.02 / 65.9 |
| loopstale | composer_merge | 256.7 | 770 | 514 | 3.26 / 48.37 | 0 / 42 / 98 | 5.62 / 50.17 | 53.58 / 93.74 |
| loopstale | hot_provisional | 58.3 | 175 | 46 | 3.16 / 45.08 | 0 / 43 / 72 | 5.71 / 47.38 | 54.19 / 89.64 |
| loopstale | admit | 39 | 117 | 35 | 2.86 / 4.38 | 0 / 0 / 0 | 5.18 / 6.61 | 48.04 / 66.57 |

| arm | wait hist (all decisions) |
|---|---|
| control | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| native | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loop | 0:861 (0,25]:105 (25,50]:79 (50,100]:17 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| nativestale | 0:1062 (0,25]:0 (25,50]:0 (50,100]:0 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |
| loopstale | 0:849 (0,25]:105 (25,50]:78 (50,100]:30 (100,200]:0 (200,400]:0 (400,800]:0 >800:0 |

| arm | reason_code hist (pooled) | atm_first_disposition |
|---|---|---|
| control | racy_overwrite:785, clean:195, concurrent_no_clobber:82 | — |
| native | atm_compose+cas_rebase:554, atm_true_conflict:204, atm_provisional_write_lease:140, atm_direct:62, atm_compose:53, atm_provisional_write_lease+cas_rebase:33, atm_direct+cas_rebase:16 | — |
| loop | atm_compose+cas_rebase:567, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:154, atm_provisional_write_lease:125, atm_direct:101, atm_compose:45, overlay_wait_on_atm_true-conflict_then_proposal-required:28, atm_direct+cas_rebase:12, atm_provisional_write_lease+cas_rebase:11, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:10, overlay_wait_on_atm_true-conflict_then_compose:9 | proposal-required:136, compose:431, true-conflict:201 |
| nativestale | atm_compose+cas_rebase:570, atm_true_conflict:186, atm_provisional_write_lease:143, atm_direct:62, atm_compose:54, atm_provisional_write_lease+cas_rebase:30, atm_direct+cas_rebase:17 | — |
| loopstale | atm_compose+cas_rebase:555, overlay_wait_on_atm_true-conflict_then_compose+cas_rebase:154, atm_provisional_write_lease:118, atm_direct:102, atm_compose:48, overlay_wait_on_atm_true-conflict_then_proposal-required:42, atm_direct+cas_rebase:15, overlay_wait_on_atm_true-conflict_then_compose:13, atm_provisional_write_lease+cas_rebase:11, overlay_wait_on_atm_true-conflict_then_proposal-required+cas_rebase:4 | proposal-required:129, compose:426, true-conflict:213 |

hash 7422724bbf62; per-rep wall: control [2525.55, 2524.68, 2524.45]; native [2577.98, 2567.88, 2563.51]; loop [2713.68, 2799.36, 2790.05]; nativestale [2559.34, 2563.62, 2556.15]; loopstale [2774.6, 2743.6, 2788.52]

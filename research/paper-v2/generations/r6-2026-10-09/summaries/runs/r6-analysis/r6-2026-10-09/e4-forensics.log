| group | cfg | procs | seed | runs | runs v1 lost>0 | v1 lost | runs v2 fail>0 | v2 lost | v2 frame-viol files | interleave sig | runs w/ interleave | steward lock spins | batch-id collisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B_grid | r1cfg | 2 | 11 | 5 | 2 | 2 | 2 | 2 | 0 | 2 | 2 | 0 | 0 |
| B_grid | slock | 2 | 11 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3155 | 0 |
| B_grid | r1cfg | 2 | 17 | 5 | 1 | 2 | 1 | 2 | 1 | 1 | 1 | 0 | 0 |
| B_grid | slock | 2 | 17 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2534 | 0 |
| A_exact_cell | r1cfg | 2 | 17 | 30 | 1 | 2 | 1 | 2 | 0 | 1 | 1 | 0 | 0 |
| A_exact_cell | slock | 2 | 17 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14055 | 0 |
| B_grid | r1cfg | 2 | 23 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 2 | 23 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 |
| B_grid | r1cfg | 4 | 11 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 4 | 11 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11708 | 0 |
| B_grid | r1cfg | 4 | 17 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 4 | 17 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9257 | 0 |
| B_grid | r1cfg | 4 | 23 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 4 | 23 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5054 | 0 |
| B_grid | r1cfg | 8 | 11 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 8 | 11 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 42458 | 0 |
| B_grid | r1cfg | 8 | 17 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 8 | 17 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 27496 | 0 |
| B_grid | r1cfg | 8 | 23 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_grid | slock | 8 | 23 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 26107 | 0 |

| cfg | runs | runs v2 fail>0 | v1 lost | v2 lost | v2 frame-viol files | interleave sig | runs w/ interleave |
|---|---|---|---|---|---|---|---|
| r1cfg | 75 | 4 | 6 | 6 | 1 | 4 | 4 |
| slock | 75 | 0 | 0 | 0 | 0 | 0 | 0 |

failure runs with interleave signature (receipt_before != pre_apply): 4/4
failure runs with ANY race signature (interleave or post_write_drift): 4/4
runs with any race signature by cfg: {'r1cfg': 4, 'slock': 0}; post_write_drift events by cfg: {'r1cfg': 6, 'slock': 0}
lost intents in exact cell (p2 s17 r1cfg, 30 reps, not grid): {'s17-t002-i4': 1, 's17-t002-i6': 1}

failure runs: [{"cell": "r2f-e4-p2-s11-g-r1cfg-r3", "lost": ["s11-t000-i2"], "interleave": 1, "frame_viol_files": 0}, {"cell": "r2f-e4-p2-s11-g-r1cfg-r5", "lost": ["s11-t004-i6"], "interleave": 1, "frame_viol_files": 0}, {"cell": "r2f-e4-p2-s17-g-r1cfg-r4", "lost": ["s17-t000-i0", "s17-t002-i5"], "interleave": 1, "frame_viol_files": 1}, {"cell": "r2f-e4-p2-s17-r1cfg-r28", "lost": ["s17-t002-i4", "s17-t002-i6"], "interleave": 1, "frame_viol_files": 0}]

| procs | cfg | runs | mean v1 correct | mean blocked | mean wall_clock_ms |
|---|---|---|---|---|---|
| 2 | r1cfg | 45 | 21.22 | 13.07 | 572.1 |
| 2 | slock | 45 | 22.07 | 12.38 | 608.6 |
| 4 | r1cfg | 15 | 20 | 15.33 | 620.8 |
| 4 | slock | 15 | 19.73 | 15.6 | 699.9 |
| 8 | r1cfg | 15 | 18.8 | 16.53 | 687.0 |
| 8 | slock | 15 | 21.13 | 14.2 | 906.6 |

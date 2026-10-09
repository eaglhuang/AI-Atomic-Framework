| project | PRs in window | eligible PRs | PR exclusions | pairs considered | drift | other pair excl. | candidates | O1 (identical / divergent) | O2 | O3 | O0 available | 50 reachable (dry-run) | greedy cap (max 2/PR) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| django | 1547 | 761 | non-default-base 40, source-file-deleted 3, src-file-count 740, src-lines-gt-400 3 | 492 | 253 | 0 | 239 | 0 (0 / 0) | 8 | 231 | 20113 | yes (50) | 124 |
| sympy | 867 | 641 | ff-nonlinear 3, non-default-base 38, source-file-deleted 1, src-file-count 159, src-lines-gt-400 25 | 140 | 41 | 0 | 99 | 6 (5 / 1) | 2 | 91 | 8063 | yes (50) | 69 |
| xarray | 1094 | 587 | ff-nonlinear 1, mode-change 1, non-default-base 3, source-file-deleted 21, src-file-count 462, src-lines-gt-400 19 | 971 | 401 | common-file-not-in-base 2 | 568 | 0 (0 / 0) | 9 | 559 | 6152 | yes (50) | 211 |
| pytest | 1126 | 312 | mode-change 1, non-default-base 269, source-file-deleted 5, src-file-count 537, src-lines-gt-400 2 | 167 | 59 | 0 | 108 | 0 (0 / 0) | 8 | 100 | 1490 | yes (50) | 65 |
| sphinx | 1127 | 555 | source-file-deleted 8, src-file-count 541, src-lines-gt-400 23 | 535 | 311 | common-file-not-in-base 1 | 223 | 1 (1 / 0) | 4 | 218 | 8525 | yes (50) | 112 |
| fastapi | 1515 | 195 | non-default-base 3, source-file-deleted 12, src-file-count 1300, src-lines-gt-400 5 | 336 | 140 | 0 | 196 | 0 (0 / 0) | 2 | 194 | 3101 | yes (50) | 56 |

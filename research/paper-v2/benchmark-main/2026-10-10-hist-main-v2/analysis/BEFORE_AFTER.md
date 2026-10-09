# Before/after: 20effd45 (stopped generation) vs b1fd9d22 (EOF fix), overlapping Django+SymPy main runs

Author-executed, not independently reproduced, descriptive only. Same pairs, seeds and harness. Runs are concurrent, so some changes can come from scheduling rather than the ATM change.

Overlapping runs: 2500 (projects: django, sympy)

| arm | runs | completed before → after | lost before → after | blocked before → after | corrupted before → after | failed runs before → after | failed pairs before → after | runs with same counts | runs with same final bytes |
|---|---|---|---|---|---|---|---|---|---|
| steward | 500 | 9037 → 9011 | 4 → 0 | 1799 → 1829 | 4 → 0 | 4 → 0 | 1 → 0 | 445 | 441 |
| file_lock | 500 | 9269 → 9252 | 0 → 0 | 1571 → 1588 | 0 → 0 | 0 → 0 | 0 → 0 | 495 | 493 |
| occ | 500 | 9221 → 9261 | 24 → 1 | 1595 → 1578 | 0 → 0 | 4 → 1 | 3 → 1 | 488 | 488 |
| git_three_way | 500 | 9707 → 9696 | 24 → 7 | 1109 → 1137 | 0 → 0 | 5 → 4 | 5 → 4 | 447 | 447 |
| bare_composer | 500 | 8783 → 8799 | 1 → 0 | 2054 → 2038 | 3 → 3 | 3 → 2 | 2 → 1 | 391 | 381 |

Focus pair sympy:26412_26438 (the §5.7 counterexample in the stopped generation):

| arm | seed | before (completed/lost/blocked/corrupted/failed) | after |
|---|---|---|---|
| bare_composer | 0 | 5/1/2/1/1 | 6/0/2/0/0 |
| bare_composer | 1 | 4/0/4/0/0 | 6/0/2/0/0 |
| bare_composer | 2 | 4/0/4/0/0 | 4/0/4/0/0 |
| bare_composer | 3 | 4/0/4/0/0 | 6/0/2/0/0 |
| bare_composer | 4 | 4/0/4/0/0 | 6/0/2/0/0 |
| file_lock | 0 | 6/0/2/0/0 | 6/0/2/0/0 |
| file_lock | 1 | 6/0/2/0/0 | 4/0/4/0/0 |
| file_lock | 2 | 4/0/4/0/0 | 4/0/4/0/0 |
| file_lock | 3 | 6/0/2/0/0 | 6/0/2/0/0 |
| file_lock | 4 | 6/0/2/0/0 | 4/0/4/0/0 |
| git_three_way | 0 | 6/0/2/0/0 | 6/0/2/0/0 |
| git_three_way | 1 | 6/0/2/0/0 | 6/0/2/0/0 |
| git_three_way | 2 | 4/0/4/0/0 | 4/0/4/0/0 |
| git_three_way | 3 | 6/0/2/0/0 | 6/0/2/0/0 |
| git_three_way | 4 | 6/0/2/0/0 | 6/0/2/0/0 |
| occ | 0 | 6/0/2/0/0 | 6/0/2/0/0 |
| occ | 1 | 6/0/2/0/0 | 6/0/2/0/0 |
| occ | 2 | 4/0/4/0/0 | 4/0/4/0/0 |
| occ | 3 | 6/0/2/0/0 | 6/0/2/0/0 |
| occ | 4 | 6/0/2/0/0 | 6/0/2/0/0 |
| steward | 0 | 5/1/2/1/1 | 6/0/2/0/0 |
| steward | 1 | 5/1/2/1/1 | 6/0/2/0/0 |
| steward | 2 | 4/0/4/0/0 | 4/0/4/0/0 |
| steward | 3 | 5/1/2/1/1 | 6/0/2/0/0 |
| steward | 4 | 5/1/2/1/1 | 6/0/2/0/0 |

Runs whose outcome counts changed: 234 (listed in before_after.json)


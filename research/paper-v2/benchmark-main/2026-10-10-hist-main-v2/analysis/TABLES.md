# HIST main run — tables (author-executed, not independently reproduced; descriptive only)

## set: main

| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs (Wilson; CP upper if 0) | lost effects | blocked intents | corrupted files | structure viol. | extra files |
|---|---|---|---|---|---|---|---|---|
| steward | 29077/34300 = 84.8% (81.2–88.0%) | 0/1500 (0.0–0.3%) | 0/300 (0.0–1.3%; CP≤1.2%) | 0 | 5223 | 0 | 0 | 0 |
| file_lock | 29691/34300 = 86.6% (82.8–89.8%) | 0/1500 (0.0–0.3%) | 0/300 (0.0–1.3%; CP≤1.2%) | 0 | 4609 | 0 | 0 | 0 |
| occ | 29710/34300 = 86.6% (83.0–89.8%) | 10/1500 (0.4–1.2%) | 10/300 (1.8–6.0%) | 32 | 4558 | 0 | 0 | 0 |
| git_three_way | 31215/34300 = 91.0% (87.6–93.7%) | 16/1500 (0.7–1.7%) | 16/300 (3.3–8.5%) | 36 | 3049 | 0 | 0 | 0 |
| bare_composer | 28303/34300 = 82.5% (78.9–85.6%) | 2/1500 (0.0–0.5%) | 1/300 (0.1–1.9%) | 0 | 5994 | 3 | 0 | 0 |

Blocked intents by final reason (harness relocation = fail-closed stop in the shared harness BEFORE any ATM call; ATM categories come from ATM itself):

| arm | harness_relocation | atm_hash_drift | atm_recompose_mismatch | new_file | git_merge_conflict | git_base_drift | other |
|---|---|---|---|---|---|---|---|
| steward | 4468 | 483 | 140 | 120 | 0 | 0 | 12 |
| file_lock | 4597 | 0 | 0 | 0 | 0 | 0 | 12 |
| occ | 4546 | 0 | 0 | 0 | 0 | 0 | 12 |
| git_three_way | 0 | 0 | 0 | 0 | 2770 | 279 | 0 |
| bare_composer | 2815 | 1408 | 1639 | 120 | 0 | 0 | 12 |

Per stratum (completed/total; failed runs; lost; blocked: relocation / ATM hash drift / ATM recompose / new file / git / other):

| arm | stratum | completed/total | failed runs | lost | corrupted | reloc | hash-drift | recompose | new-file | git | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| steward | O1 | 7817/11445 (68.3%) | 0/360 | 0 | 0 | 3587 | 0 | 1 | 40 | 0 | 0 |
| steward | O2 | 6600/7580 (87.1%) | 0/255 | 0 | 0 | 881 | 30 | 22 | 35 | 0 | 12 |
| steward | O3 | 14660/15275 (96.0%) | 0/885 | 0 | 0 | 0 | 453 | 117 | 45 | 0 | 0 |
| file_lock | O1 | 7813/11445 (68.3%) | 0/360 | 0 | 0 | 3632 | 0 | 0 | 0 | 0 | 0 |
| file_lock | O2 | 6603/7580 (87.1%) | 0/255 | 0 | 0 | 965 | 0 | 0 | 0 | 0 | 12 |
| file_lock | O3 | 15275/15275 (100.0%) | 0/885 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| occ | O1 | 7863/11445 (68.7%) | 0/360 | 0 | 0 | 3582 | 0 | 0 | 0 | 0 | 0 |
| occ | O2 | 6603/7580 (87.1%) | 1/255 | 1 | 0 | 964 | 0 | 0 | 0 | 0 | 12 |
| occ | O3 | 15244/15275 (99.8%) | 9/885 | 31 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| git_three_way | O1 | 8738/11445 (76.3%) | 0/360 | 0 | 0 | 0 | 0 | 0 | 0 | 2707 | 0 |
| git_three_way | O2 | 7505/7580 (99.0%) | 1/255 | 2 | 0 | 0 | 0 | 0 | 0 | 73 | 0 |
| git_three_way | O3 | 14972/15275 (98.0%) | 15/885 | 34 | 0 | 0 | 0 | 0 | 0 | 269 | 0 |
| bare_composer | O1 | 7875/11445 (68.8%) | 2/360 | 0 | 3 | 2239 | 483 | 805 | 40 | 0 | 0 |
| bare_composer | O2 | 6380/7580 (84.2%) | 0/255 | 0 | 0 | 576 | 253 | 324 | 35 | 0 | 12 |
| bare_composer | O3 | 14048/15275 (92.0%) | 0/885 | 0 | 0 | 0 | 672 | 510 | 45 | 0 | 0 |

Per project:

| arm | project | completed/total | failed runs | lost | corrupted | blocked |
|---|---|---|---|---|---|---|
| steward | django | 3995/4440 (90.0%) | 0/250 | 0 | 0 | 445 |
| steward | fastapi | 3120/3710 (84.1%) | 0/250 | 0 | 0 | 590 |
| steward | pytest | 4592/5155 (89.1%) | 0/250 | 0 | 0 | 563 |
| steward | sphinx | 4715/5590 (84.3%) | 0/250 | 0 | 0 | 875 |
| steward | sympy | 5016/6400 (78.4%) | 0/250 | 0 | 0 | 1384 |
| steward | xarray | 7639/9005 (84.8%) | 0/250 | 0 | 0 | 1366 |
| file_lock | django | 4122/4440 (92.8%) | 0/250 | 0 | 0 | 318 |
| file_lock | fastapi | 3258/3710 (87.8%) | 0/250 | 0 | 0 | 452 |
| file_lock | pytest | 4750/5155 (92.1%) | 0/250 | 0 | 0 | 405 |
| file_lock | sphinx | 4806/5590 (86.0%) | 0/250 | 0 | 0 | 784 |
| file_lock | sympy | 5130/6400 (80.2%) | 0/250 | 0 | 0 | 1270 |
| file_lock | xarray | 7625/9005 (84.7%) | 0/250 | 0 | 0 | 1380 |
| occ | django | 4108/4440 (92.5%) | 1/250 | 1 | 0 | 331 |
| occ | fastapi | 3242/3710 (87.4%) | 4/250 | 6 | 0 | 462 |
| occ | pytest | 4743/5155 (92.0%) | 2/250 | 10 | 0 | 402 |
| occ | sphinx | 4803/5590 (85.9%) | 2/250 | 4 | 0 | 783 |
| occ | sympy | 5153/6400 (80.5%) | 0/250 | 0 | 0 | 1247 |
| occ | xarray | 7661/9005 (85.1%) | 1/250 | 11 | 0 | 1333 |
| git_three_way | django | 4179/4440 (94.1%) | 4/250 | 7 | 0 | 254 |
| git_three_way | fastapi | 3405/3710 (91.8%) | 4/250 | 6 | 0 | 299 |
| git_three_way | pytest | 4829/5155 (93.7%) | 4/250 | 15 | 0 | 311 |
| git_three_way | sphinx | 5173/5590 (92.5%) | 1/250 | 1 | 0 | 416 |
| git_three_way | sympy | 5517/6400 (86.2%) | 0/250 | 0 | 0 | 883 |
| git_three_way | xarray | 8112/9005 (90.1%) | 3/250 | 7 | 0 | 886 |
| bare_composer | django | 3910/4440 (88.1%) | 2/250 | 0 | 3 | 527 |
| bare_composer | fastapi | 2953/3710 (79.6%) | 0/250 | 0 | 0 | 757 |
| bare_composer | pytest | 4350/5155 (84.4%) | 0/250 | 0 | 0 | 805 |
| bare_composer | sphinx | 4633/5590 (82.9%) | 0/250 | 0 | 0 | 957 |
| bare_composer | sympy | 4889/6400 (76.4%) | 0/250 | 0 | 0 | 1511 |
| bare_composer | xarray | 7568/9005 (84.0%) | 0/250 | 0 | 0 | 1437 |

Per writer version (pre-rebase = option P pairs):

| arm | writer_version | completed/total | failed runs | lost | corrupted | reloc blocks |
|---|---|---|---|---|---|---|
| steward | final | 16346/17900 (91.3%) | 0/945 | 0 | 0 | 931 |
| steward | pre-rebase | 12731/16400 (77.6%) | 0/555 | 0 | 0 | 3537 |
| file_lock | final | 16979/17900 (94.9%) | 0/945 | 0 | 0 | 921 |
| file_lock | pre-rebase | 12712/16400 (77.5%) | 0/555 | 0 | 0 | 3676 |
| occ | final | 16949/17900 (94.7%) | 9/945 | 29 | 0 | 922 |
| occ | pre-rebase | 12761/16400 (77.8%) | 1/555 | 3 | 0 | 3624 |
| git_three_way | final | 17158/17900 (95.9%) | 14/945 | 32 | 0 | 0 |
| git_three_way | pre-rebase | 14057/16400 (85.7%) | 2/555 | 4 | 0 | 0 |
| bare_composer | final | 15731/17900 (87.9%) | 0/945 | 0 | 0 | 649 |
| bare_composer | pre-rebase | 12572/16400 (76.7%) | 2/555 | 0 | 3 | 2166 |

Paired per (pair, seed), completed intents (descriptive, no test):

| comparison | steward higher | same | steward lower | sum of differences |
|---|---|---|---|---|
| steward_vs_file_lock | 23 | 1148 | 329 | -614 |
| steward_vs_occ | 25 | 1153 | 322 | -633 |
| steward_vs_git_three_way | 68 | 968 | 464 | -2138 |
| steward_vs_bare_composer | 291 | 1090 | 119 | 774 |

## set: o0

| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs (Wilson; CP upper if 0) | lost effects | blocked intents | corrupted files | structure viol. | extra files |
|---|---|---|---|---|---|---|---|---|
| steward | 1825/1845 = 98.9% (97.1–100.0%) | 0/150 (0.0–2.5%) | 0/30 (0.0–11.4%; CP≤11.6%) | 0 | 20 | 0 | 0 | 0 |
| file_lock | 1845/1845 = 100.0% (100.0–100.0%) | 0/150 (0.0–2.5%) | 0/30 (0.0–11.4%; CP≤11.6%) | 0 | 0 | 0 | 0 | 0 |
| occ | 1845/1845 = 100.0% (100.0–100.0%) | 0/150 (0.0–2.5%) | 0/30 (0.0–11.4%; CP≤11.6%) | 0 | 0 | 0 | 0 | 0 |
| git_three_way | 1845/1845 = 100.0% (100.0–100.0%) | 0/150 (0.0–2.5%) | 0/30 (0.0–11.4%; CP≤11.6%) | 0 | 0 | 0 | 0 | 0 |
| bare_composer | 1825/1845 = 98.9% (97.1–100.0%) | 0/150 (0.0–2.5%) | 0/30 (0.0–11.4%; CP≤11.6%) | 0 | 20 | 0 | 0 | 0 |

Blocked intents by final reason (harness relocation = fail-closed stop in the shared harness BEFORE any ATM call; ATM categories come from ATM itself):

| arm | harness_relocation | atm_hash_drift | atm_recompose_mismatch | new_file | git_merge_conflict | git_base_drift | other |
|---|---|---|---|---|---|---|---|
| steward | 0 | 0 | 0 | 20 | 0 | 0 | 0 |
| file_lock | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| occ | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| git_three_way | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| bare_composer | 0 | 0 | 0 | 20 | 0 | 0 | 0 |

Per stratum (completed/total; failed runs; lost; blocked: relocation / ATM hash drift / ATM recompose / new file / git / other):

| arm | stratum | completed/total | failed runs | lost | corrupted | reloc | hash-drift | recompose | new-file | git | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| steward | O0 | 1825/1845 (98.9%) | 0/150 | 0 | 0 | 0 | 0 | 0 | 20 | 0 | 0 |
| file_lock | O0 | 1845/1845 (100.0%) | 0/150 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| occ | O0 | 1845/1845 (100.0%) | 0/150 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| git_three_way | O0 | 1845/1845 (100.0%) | 0/150 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| bare_composer | O0 | 1825/1845 (98.9%) | 0/150 | 0 | 0 | 0 | 0 | 0 | 20 | 0 | 0 |

Per project:

| arm | project | completed/total | failed runs | lost | corrupted | blocked |
|---|---|---|---|---|---|---|
| steward | django | 170/180 (94.4%) | 0/25 | 0 | 0 | 10 |
| steward | fastapi | 290/300 (96.7%) | 0/25 | 0 | 0 | 10 |
| steward | pytest | 245/245 (100.0%) | 0/25 | 0 | 0 | 0 |
| steward | sphinx | 340/340 (100.0%) | 0/25 | 0 | 0 | 0 |
| steward | sympy | 315/315 (100.0%) | 0/25 | 0 | 0 | 0 |
| steward | xarray | 465/465 (100.0%) | 0/25 | 0 | 0 | 0 |
| file_lock | django | 180/180 (100.0%) | 0/25 | 0 | 0 | 0 |
| file_lock | fastapi | 300/300 (100.0%) | 0/25 | 0 | 0 | 0 |
| file_lock | pytest | 245/245 (100.0%) | 0/25 | 0 | 0 | 0 |
| file_lock | sphinx | 340/340 (100.0%) | 0/25 | 0 | 0 | 0 |
| file_lock | sympy | 315/315 (100.0%) | 0/25 | 0 | 0 | 0 |
| file_lock | xarray | 465/465 (100.0%) | 0/25 | 0 | 0 | 0 |
| occ | django | 180/180 (100.0%) | 0/25 | 0 | 0 | 0 |
| occ | fastapi | 300/300 (100.0%) | 0/25 | 0 | 0 | 0 |
| occ | pytest | 245/245 (100.0%) | 0/25 | 0 | 0 | 0 |
| occ | sphinx | 340/340 (100.0%) | 0/25 | 0 | 0 | 0 |
| occ | sympy | 315/315 (100.0%) | 0/25 | 0 | 0 | 0 |
| occ | xarray | 465/465 (100.0%) | 0/25 | 0 | 0 | 0 |
| git_three_way | django | 180/180 (100.0%) | 0/25 | 0 | 0 | 0 |
| git_three_way | fastapi | 300/300 (100.0%) | 0/25 | 0 | 0 | 0 |
| git_three_way | pytest | 245/245 (100.0%) | 0/25 | 0 | 0 | 0 |
| git_three_way | sphinx | 340/340 (100.0%) | 0/25 | 0 | 0 | 0 |
| git_three_way | sympy | 315/315 (100.0%) | 0/25 | 0 | 0 | 0 |
| git_three_way | xarray | 465/465 (100.0%) | 0/25 | 0 | 0 | 0 |
| bare_composer | django | 170/180 (94.4%) | 0/25 | 0 | 0 | 10 |
| bare_composer | fastapi | 290/300 (96.7%) | 0/25 | 0 | 0 | 10 |
| bare_composer | pytest | 245/245 (100.0%) | 0/25 | 0 | 0 | 0 |
| bare_composer | sphinx | 340/340 (100.0%) | 0/25 | 0 | 0 | 0 |
| bare_composer | sympy | 315/315 (100.0%) | 0/25 | 0 | 0 | 0 |
| bare_composer | xarray | 465/465 (100.0%) | 0/25 | 0 | 0 | 0 |

Per writer version (pre-rebase = option P pairs):

| arm | writer_version | completed/total | failed runs | lost | corrupted | reloc blocks |
|---|---|---|---|---|---|---|
| steward | final | 1825/1845 (98.9%) | 0/150 | 0 | 0 | 0 |
| file_lock | final | 1845/1845 (100.0%) | 0/150 | 0 | 0 | 0 |
| occ | final | 1845/1845 (100.0%) | 0/150 | 0 | 0 | 0 |
| git_three_way | final | 1845/1845 (100.0%) | 0/150 | 0 | 0 | 0 |
| bare_composer | final | 1825/1845 (98.9%) | 0/150 | 0 | 0 | 0 |

Paired per (pair, seed), completed intents (descriptive, no test):

| comparison | steward higher | same | steward lower | sum of differences |
|---|---|---|---|---|
| steward_vs_file_lock | 0 | 135 | 15 | -20 |
| steward_vs_occ | 0 | 135 | 15 | -20 |
| steward_vs_git_three_way | 0 | 135 | 15 | -20 |
| steward_vs_bare_composer | 0 | 150 | 0 | 0 |

## set: old_pin

| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs (Wilson; CP upper if 0) | lost effects | blocked intents | corrupted files | structure viol. | extra files |
|---|---|---|---|---|---|---|---|---|
| steward | 28803/34300 = 84.0% (80.3–87.1%) | 25/1500 (1.1–2.4%) | 18/300 (3.8–9.3%) | 57 | 5440 | 5 | 1 | 0 |

Blocked intents by final reason (harness relocation = fail-closed stop in the shared harness BEFORE any ATM call; ATM categories come from ATM itself):

| arm | harness_relocation | atm_hash_drift | atm_recompose_mismatch | new_file | git_merge_conflict | git_base_drift | other |
|---|---|---|---|---|---|---|---|
| steward | 4479 | 821 | 8 | 120 | 0 | 0 | 12 |

Per stratum (completed/total; failed runs; lost; blocked: relocation / ATM hash drift / ATM recompose / new file / git / other):

| arm | stratum | completed/total | failed runs | lost | corrupted | reloc | hash-drift | recompose | new-file | git | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| steward | O1 | 7800/11445 (68.2%) | 4/360 | 4 | 4 | 3601 | 0 | 0 | 40 | 0 | 0 |
| steward | O2 | 6594/7580 (87.0%) | 2/255 | 3 | 0 | 878 | 58 | 0 | 35 | 0 | 12 |
| steward | O3 | 14409/15275 (94.3%) | 19/885 | 50 | 1 | 0 | 763 | 8 | 45 | 0 | 0 |

Per project:

| arm | project | completed/total | failed runs | lost | corrupted | blocked |
|---|---|---|---|---|---|---|
| steward | django | 3937/4440 (88.7%) | 4/250 | 8 | 0 | 495 |
| steward | fastapi | 3068/3710 (82.7%) | 5/250 | 8 | 0 | 634 |
| steward | pytest | 4547/5155 (88.2%) | 3/250 | 4 | 0 | 604 |
| steward | sphinx | 4688/5590 (83.9%) | 3/250 | 4 | 1 | 898 |
| steward | sympy | 5000/6400 (78.1%) | 9/250 | 31 | 4 | 1369 |
| steward | xarray | 7563/9005 (84.0%) | 1/250 | 2 | 0 | 1440 |

Per writer version (pre-rebase = option P pairs):

| arm | writer_version | completed/total | failed runs | lost | corrupted | reloc blocks |
|---|---|---|---|---|---|---|
| steward | final | 16108/17900 (90.0%) | 20/945 | 51 | 1 | 925 |
| steward | pre-rebase | 12695/16400 (77.4%) | 5/555 | 6 | 4 | 3554 |

Paired per (pair, seed), completed intents (descriptive, no test):

| comparison | steward higher | same | steward lower | sum of differences |
|---|---|---|---|---|
| steward_vs_file_lock | 0 | 0 | 0 | 0 |
| steward_vs_occ | 0 | 0 | 0 | 0 |
| steward_vs_git_three_way | 0 | 0 | 0 | 0 |
| steward_vs_bare_composer | 0 | 0 | 0 | 0 |

## Counterexamples (steward at current pin: lost effect or corrupted file)

0: []

Failed steward runs (any reason, any pin): 25

Baseline runs with loss/misplacement/corruption: 28

## Semantic endpoint (STALE; final/final pairs only)

```
{
 "scope": "final/final pairs only (main rule v1.0 + O0); every pair with a pre-rebase writer is not evaluable by prereg v1.1",
 "pairs_attempted": 219,
 "pair_status": {
  "evaluated-base-invalid": 125,
  "evaluated": 52,
  "not-evaluable:no-test-modules": 28,
  "not-evaluable:union-test-patch-conflict": 14
 },
 "base_valid_pairs": 52,
 "pairs_with_historical_interference_any_status": 0,
 "base_valid_pairs_with_historical_interference": 0,
 "by_arm_base_valid_pairs": {
  "bare_composer": {
   "evaluated": 134,
   "same_bytes_as_gold": 134,
   "runs_with_arm_regression": 0,
   "arm_regression_tests": 0,
   "runs_with_gold_relative_regression": 0,
   "not_evaluable": 126
  },
  "file_lock": {
   "evaluated": 250,
   "same_bytes_as_gold": 250,
   "runs_with_arm_regression": 0,
   "arm_regression_tests": 0,
   "runs_with_gold_relative_regression": 0,
   "not_evaluable": 10
  },
  "git_three_way": {
   "evaluated": 233,
   "same_bytes_as_gold": 224,
   "runs_with_arm_regression": 0,
   "arm_regression_tests": 0,
   "runs_with_gold_relative_regression": 0,
   "not_evaluable": 27
  },
  "occ": {
   "evaluated": 249,
   "same_bytes_as_gold": 249,
   "runs_with_arm_regression": 0,
   "arm_regression_tests": 0,
   "runs_with_gold_relative_regression": 0,
   "not_evaluable": 11
  },
  "steward": {
   "evaluated": 168,
   "same_bytes_as_gold": 168,
   "runs_with_arm_regression": 0,
   "arm_regression_tests": 0,
   "runs_with_gold_relative_regression": 0,
   "not_evaluable": 92
  }
 }
}
```

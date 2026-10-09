# HIST main run — tables (author-executed, not independently reproduced; descriptive only)

## set: main

| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs (Wilson; CP upper if 0) | lost effects | blocked intents | corrupted files | structure viol. | extra files |
|---|---|---|---|---|---|---|---|---|
| steward | 9037/10840 = 83.4% (75.0–90.2%) | 4/500 (0.3–2.0%) | 1/100 (0.2–5.4%) | 4 | 1799 | 4 | 0 | 0 |
| file_lock | 9269/10840 = 85.5% (77.0–92.4%) | 0/500 (0.0–0.8%) | 0/100 (0.0–3.7%; CP≤3.6%) | 0 | 1571 | 0 | 0 | 0 |
| occ | 9221/10840 = 85.1% (76.5–92.1%) | 4/500 (0.3–2.0%) | 3/100 (1.0–8.5%) | 24 | 1595 | 0 | 0 | 0 |
| git_three_way | 9707/10840 = 89.5% (81.1–95.5%) | 5/500 (0.4–2.3%) | 5/100 (2.2–11.2%) | 24 | 1109 | 0 | 0 | 0 |
| bare_composer | 8783/10840 = 81.0% (72.6–87.8%) | 3/500 (0.2–1.7%) | 2/100 (0.6–7.0%) | 1 | 2054 | 3 | 0 | 0 |

Blocked intents by final reason (harness relocation = fail-closed stop in the shared harness BEFORE any ATM call; ATM categories come from ATM itself):

| arm | harness_relocation | atm_hash_drift | atm_recompose_mismatch | new_file | git_merge_conflict | git_base_drift | other |
|---|---|---|---|---|---|---|---|
| steward | 1567 | 175 | 22 | 35 | 0 | 0 | 0 |
| file_lock | 1571 | 0 | 0 | 0 | 0 | 0 | 0 |
| occ | 1595 | 0 | 0 | 0 | 0 | 0 | 0 |
| git_three_way | 0 | 0 | 0 | 0 | 1021 | 88 | 0 |
| bare_composer | 950 | 519 | 550 | 35 | 0 | 0 | 0 |

Per stratum (completed/total; failed runs; lost; blocked: relocation / ATM hash drift / ATM recompose / new file / git / other):

| arm | stratum | completed/total | failed runs | lost | corrupted | reloc | hash-drift | recompose | new-file | git | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| steward | O1 | 1898/3325 (57.1%) | 4/115 | 4 | 4 | 1403 | 0 | 0 | 20 | 0 | 0 |
| steward | O2 | 1186/1350 (87.9%) | 0/35 | 0 | 0 | 164 | 0 | 0 | 0 | 0 | 0 |
| steward | O3 | 5953/6165 (96.6%) | 0/350 | 0 | 0 | 0 | 175 | 22 | 15 | 0 | 0 |
| file_lock | O1 | 1918/3325 (57.7%) | 0/115 | 0 | 0 | 1407 | 0 | 0 | 0 | 0 | 0 |
| file_lock | O2 | 1186/1350 (87.9%) | 0/35 | 0 | 0 | 164 | 0 | 0 | 0 | 0 | 0 |
| file_lock | O3 | 6165/6165 (100.0%) | 0/350 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| occ | O1 | 1894/3325 (57.0%) | 0/115 | 0 | 0 | 1431 | 0 | 0 | 0 | 0 | 0 |
| occ | O2 | 1186/1350 (87.9%) | 0/35 | 0 | 0 | 164 | 0 | 0 | 0 | 0 | 0 |
| occ | O3 | 6141/6165 (99.6%) | 4/350 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| git_three_way | O1 | 2366/3325 (71.2%) | 0/115 | 0 | 0 | 0 | 0 | 0 | 0 | 959 | 0 |
| git_three_way | O2 | 1287/1350 (95.3%) | 0/35 | 0 | 0 | 0 | 0 | 0 | 0 | 63 | 0 |
| git_three_way | O3 | 6054/6165 (98.2%) | 5/350 | 24 | 0 | 0 | 0 | 0 | 0 | 87 | 0 |
| bare_composer | O1 | 1878/3325 (56.5%) | 3/115 | 1 | 3 | 864 | 246 | 314 | 20 | 0 | 0 |
| bare_composer | O2 | 1119/1350 (82.9%) | 0/35 | 0 | 0 | 86 | 54 | 91 | 0 | 0 | 0 |
| bare_composer | O3 | 5786/6165 (93.9%) | 0/350 | 0 | 0 | 0 | 219 | 145 | 15 | 0 | 0 |

Per project:

| arm | project | completed/total | failed runs | lost | corrupted | blocked |
|---|---|---|---|---|---|---|
| steward | django | 4002/4440 (90.1%) | 0/250 | 0 | 0 | 438 |
| steward | sympy | 5035/6400 (78.7%) | 4/250 | 4 | 4 | 1361 |
| file_lock | django | 4122/4440 (92.8%) | 0/250 | 0 | 0 | 318 |
| file_lock | sympy | 5147/6400 (80.4%) | 0/250 | 0 | 0 | 1253 |
| occ | django | 4121/4440 (92.8%) | 2/250 | 2 | 0 | 317 |
| occ | sympy | 5100/6400 (79.7%) | 2/250 | 22 | 0 | 1278 |
| git_three_way | django | 4169/4440 (93.9%) | 3/250 | 7 | 0 | 264 |
| git_three_way | sympy | 5538/6400 (86.5%) | 2/250 | 17 | 0 | 845 |
| bare_composer | django | 3908/4440 (88.0%) | 2/250 | 0 | 2 | 530 |
| bare_composer | sympy | 4875/6400 (76.2%) | 1/250 | 1 | 1 | 1524 |

Per writer version (pre-rebase = option P pairs):

| arm | writer_version | completed/total | failed runs | lost | corrupted | reloc blocks |
|---|---|---|---|---|---|---|
| steward | final | 5742/6730 (85.3%) | 0/365 | 0 | 0 | 786 |
| steward | pre-rebase | 3295/4110 (80.2%) | 4/135 | 4 | 4 | 781 |
| file_lock | final | 5953/6730 (88.5%) | 0/365 | 0 | 0 | 777 |
| file_lock | pre-rebase | 3316/4110 (80.7%) | 0/135 | 0 | 0 | 794 |
| occ | final | 5929/6730 (88.1%) | 4/365 | 24 | 0 | 777 |
| occ | pre-rebase | 3292/4110 (80.1%) | 0/135 | 0 | 0 | 818 |
| git_three_way | final | 6174/6730 (91.7%) | 5/365 | 24 | 0 | 0 |
| git_three_way | pre-rebase | 3533/4110 (86.0%) | 0/135 | 0 | 0 | 0 |
| bare_composer | final | 5555/6730 (82.5%) | 0/365 | 0 | 0 | 561 |
| bare_composer | pre-rebase | 3228/4110 (78.5%) | 3/135 | 1 | 3 | 389 |

Paired per (pair, seed), completed intents (descriptive, no test):

| comparison | steward higher | same | steward lower | sum of differences |
|---|---|---|---|---|
| steward_vs_file_lock | 2 | 376 | 122 | -232 |
| steward_vs_occ | 6 | 376 | 118 | -184 |
| steward_vs_git_three_way | 18 | 327 | 155 | -670 |
| steward_vs_bare_composer | 101 | 353 | 46 | 254 |

## Counterexamples (steward at current pin: lost effect or corrupted file)

4: [{"set": "main", "pair_id": "sympy:26412_26438", "seed_k": 0, "lost": 1, "corrupted": 1, "structure": 0, "extra": 0, "failed": true}, {"set": "main", "pair_id": "sympy:26412_26438", "seed_k": 1, "lost": 1, "corrupted": 1, "structure": 0, "extra": 0, "failed": true}, {"set": "main", "pair_id": "sympy:26412_26438", "seed_k": 3, "lost": 1, "corrupted": 1, "structure": 0, "extra": 0, "failed": true}, {"set": "main", "pair_id": "sympy:26412_26438", "seed_k": 4, "lost": 1, "corrupted": 1, "structure": 0, "extra": 0, "failed": true}]

Failed steward runs (any reason, any pin): 4

Baseline runs with loss/misplacement/corruption: 12


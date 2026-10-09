# HIST smoke (Django, 3 pairs x 5 arms x 1 seed + 15 planted-fault runs) 2026-10-09 — 試跑 (trial run), NOT formal results

Author-executed, not independently reproduced. GitHub CI only checks record consistency (SHA256SUMS/verify), it does not rerun experiments.

| arm | completed/total intents | failed/total runs | lost effects | blocked intents | corrupted files | structure violations | extra files | identity |
|---|---|---|---|---|---|---|---|---|
| steward | 69/71 | 0/3 | 0 | 2 | 0 | 0 | 0 | ok |
| file_lock | 71/71 | 0/3 | 0 | 0 | 0 | 0 | 0 | ok |
| occ | 71/71 | 0/3 | 0 | 0 | 0 | 0 | 0 | ok |
| git_three_way | 71/71 | 0/3 | 0 | 0 | 0 | 0 | 0 | ok |
| bare_composer | 61/71 | 0/3 | 0 | 10 | 0 | 0 | 0 | ok |

Blocked intents by final reason (hash-drift listed separately):

- steward: atm-new-file-unsupported (file-hash-drift: target does not exist) = 2
- file_lock: none
- occ: none
- git_three_way: none
- bare_composer: atm-new-file-unsupported (file-hash-drift: target does not exist) = 2, compose-context-mismatch (re-compose) = 8

Planted faults (oracle validation; injected by the harness, not arm behaviour):

| pair | plant | lost | corrupted | extra files | run failed | detected |
|---|---|---|---|---|---|---|
| django:19063_19119 | plant_flip_frame_byte | 0 | 1 | 0 | True | yes |
| django:19063_19119 | plant_foreign_file | 0 | 0 | 1 | True | yes |
| django:19063_19119 | plant_revert_hunk | 1 | 0 | 0 | True | yes |
| django:19063_19119 | plant_torn_tail | 2 | 1 | 0 | True | yes |
| django:19063_19119 | planted_raw_overwrite | 9 | 0 | 0 | True | yes |
| django:20045_20060 | plant_flip_frame_byte | 0 | 1 | 0 | True | yes |
| django:20045_20060 | plant_foreign_file | 0 | 0 | 1 | True | yes |
| django:20045_20060 | plant_revert_hunk | 1 | 0 | 0 | True | yes |
| django:20045_20060 | plant_torn_tail | 6 | 1 | 0 | True | yes |
| django:20045_20060 | planted_raw_overwrite | 7 | 0 | 0 | True | yes |
| django:20055_20101 | plant_flip_frame_byte | 0 | 1 | 0 | True | yes |
| django:20055_20101 | plant_foreign_file | 0 | 0 | 1 | True | yes |
| django:20055_20101 | plant_revert_hunk | 1 | 0 | 0 | True | yes |
| django:20055_20101 | plant_torn_tail | 2 | 1 | 0 | True | yes |
| django:20055_20101 | planted_raw_overwrite | 5 | 0 | 0 | True | yes |

Semantic endpoint (STALE method: same union test set in every condition; only NEW failures after merging):

| pair | status | F2P A | F2P B | flaky | historical interference (gold fails, solos pass) |
|---|---|---|---|---|---|
| django:19063_19119 | evaluated | 34 | 2 | 0 | 0 |
| django:20045_20060 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:20055_20101 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 109 | 0 | 0 | 0 |

| arm | evaluated runs | not evaluable | same bytes as gold | arm-attributed new failures | gold-relative new failures |
|---|---|---|---|---|---|
| steward | 0 | 3 | 0 | 0 | 0 |
| file_lock | 1 | 2 | 0 | 0 | 0 |
| occ | 1 | 2 | 0 | 0 | 0 |
| git_three_way | 1 | 2 | 0 | 0 | 0 |
| bare_composer | 0 | 3 | 0 | 0 | 0 |

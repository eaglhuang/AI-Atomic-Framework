# HIST Django pilot (30 pairs x 5 arms x 2 seeds = 300 runs) 2026-10-09 — 試跑 (trial run), NOT formal results

Author-executed, not independently reproduced. GitHub CI only checks record consistency (SHA256SUMS/verify), it does not rerun experiments.

| arm | completed/total intents | failed/total runs | lost effects | blocked intents | corrupted files | structure violations | extra files | identity |
|---|---|---|---|---|---|---|---|---|
| steward | 933/964 | 0/60 | 0 | 31 | 0 | 0 | 0 | ok |
| file_lock | 962/964 | 0/60 | 0 | 2 | 0 | 0 | 0 | ok |
| occ | 962/964 | 0/60 | 0 | 2 | 0 | 0 | 0 | ok |
| git_three_way | 946/964 | 2/60 | 5 | 13 | 0 | 0 | 0 | ok |
| bare_composer | 872/964 | 0/60 | 0 | 92 | 0 | 0 | 0 | ok |

Blocked intents by final reason (hash-drift listed separately):

- steward: atm-new-file-unsupported (file-hash-drift: target does not exist) = 4, compose-context-mismatch (re-compose) = 5, file-hash-drift = 22
- file_lock: relocate-context-not-found = 2
- occ: relocate-context-not-found = 2
- git_three_way: git-base-drift = 13
- bare_composer: atm-new-file-unsupported (file-hash-drift: target does not exist) = 4, compose-context-mismatch (re-compose) = 64, file-hash-drift = 24

Planted faults (oracle validation; injected by the harness, not arm behaviour):

| pair | plant | lost | corrupted | extra files | run failed | detected |
|---|---|---|---|---|---|---|

Semantic endpoint (STALE method: same union test set in every condition; only NEW failures after merging):

| pair | status | F2P A | F2P B | flaky | historical interference (gold fails, solos pass) |
|---|---|---|---|---|---|
| django:17554_19884 | evaluated | 499 | 1 | 0 | 0 |
| django:17723_18450 | evaluated | 1 | 2 | 0 | 0 |
| django:17890_18412 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 357 | 0 | 0 | 0 |
| django:18237_18245 | evaluated | 2 | 1 | 0 | 0 |
| django:18309_18319 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 4 | 0 | 0 | 0 |
| django:18314_18384 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:18356_18450 | evaluated | 8 | 2 | 0 | 0 |
| django:18361_19153 | evaluated | 131 | 1 | 0 | 0 |
| django:18560_19220 | not-evaluable:union-test-patch-conflict | 0 | 0 | 0 | 0 |
| django:18560_19264 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 6 | 0 | 0 | 0 |
| django:18572_18605 | evaluated | 6 | 1 | 0 | 0 |
| django:18645_19021 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 1 | 0 | 0 | 0 |
| django:18847_18895 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:18958_19078 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:19008_19018 | evaluated | 2 | 3 | 0 | 0 |
| django:19017_19018 | not-evaluable:union-test-patch-conflict | 0 | 0 | 0 | 0 |
| django:19030_19431 | evaluated | 1 | 1 | 0 | 0 |
| django:19057_19480 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 1 | 0 | 0 | 0 |
| django:19366_19570 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:19401_19445 | evaluated | 1 | 4 | 0 | 0 |
| django:19474_19570 | evaluated | 1 | 1 | 0 | 0 |
| django:19495_19503 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:19602_19844 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 6 | 0 | 0 | 0 |
| django:19685_19844 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 1 | 0 | 0 | 0 |
| django:19688_20287 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 0 | 0 | 0 |
| django:19732_19744 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 0 | 1 | 0 | 0 |
| django:19793_19873 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 1 | 0 | 0 | 0 |
| django:19794_20009 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 259 | 0 | 0 | 0 |
| django:20055_20063 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 146 | 0 | 0 | 0 |
| django:20086_20287 | evaluated-base-invalid (semantic endpoint excluded per prereg) | 8 | 0 | 0 | 0 |

| arm | evaluated runs | not evaluable | same bytes as gold | arm-attributed new failures | gold-relative new failures |
|---|---|---|---|---|---|
| steward | 17 | 39 | 17 | 0 | 0 |
| file_lock | 20 | 36 | 20 | 0 | 0 |
| occ | 20 | 36 | 20 | 0 | 0 |
| git_three_way | 19 | 37 | 19 | 0 | 0 |
| bare_composer | 11 | 45 | 11 | 0 | 0 |

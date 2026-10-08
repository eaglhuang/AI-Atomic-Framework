# E2 Workloads（沿用 E1 凍結）

見 `SEEDS_REGISTERED.md`。共同：`--atm-backend real --compose-window-ms 100 --agents 3 --trials 5 --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6`。

| id | hot-ratio | overlap |
|----|-----------|---------|
| cold | 0 | low |
| hot_disjoint | 1 | low |
| hot_conflict | 1 | high |

Scheduler：`--scheduler-seed $((seed+1000))`。

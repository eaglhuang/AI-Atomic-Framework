#!/usr/bin/env bash
# E2 main matrix — harness-only; ATM read-only; seeds from seeds.json (pre-registered)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43

ARMS=(steward file_lock occ git_three_way bare_composer)
# Pre-registered workload seeds (see SEEDS_REGISTERED.md / seeds.json)
SEEDS=(11 17 23 29 31 37 41 43 47 53)
WORKLOADS=(
  "hot_conflict:1:high"
  "hot_disjoint:1:low"
  "cold:0:low"
)

COMMON=(--atm-backend real --compose-window-ms 100 --agents 3 --trials 5
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)

LOG="$ROOT/runs/e2-matrix/matrix.log"
: > "$LOG"
echo "E2 matrix start $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG"
echo "NOTE: seeds registered before runs in runs/e2-matrix/SEEDS_REGISTERED.md" | tee -a "$LOG"

n=0
for wl in "${WORKLOADS[@]}"; do
  IFS=: read -r wid hot ov <<< "$wl"
  for arm in "${ARMS[@]}"; do
    for seed in "${SEEDS[@]}"; do
      sched=$((seed + 1000))
      rid="e2-${wid}-${arm}-s${seed}"
      n=$((n+1))
      echo "[$n] $rid wl_seed=$seed sched_seed=$sched" | tee -a "$LOG"
      node src/cli.mjs start --run-id "$rid" --arm "$arm" \
        --seed "$seed" --scheduler-seed "$sched" \
        --hot-ratio "$hot" --overlap "$ov" \
        "${COMMON[@]}" >>"$LOG" 2>&1
    done
  done
done

# Optional diagnostic smoke — not main table
for arm in admission_only raw_overwrite; do
  rid="e2-diag-${arm}-s11"
  echo "[diag] $rid" | tee -a "$LOG"
  node src/cli.mjs start --run-id "$rid" --arm "$arm" \
    --seed 11 --scheduler-seed 1011 --hot-ratio 1 --overlap high \
    "${COMMON[@]}" >>"$LOG" 2>&1 || echo "diag $arm failed" | tee -a "$LOG"
done

echo "E2 matrix end $(date '+%Y-%m-%d %H:%M:%S %Z') cells=$n" | tee -a "$LOG"

#!/usr/bin/env bash
# E1 pilot matrix — harness-only; ATM read-only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43

ARMS=(steward file_lock occ git_three_way bare_composer)
SEEDS=(11 17 23)
# workload_id:hot_ratio:overlap
WORKLOADS=(
  "cold:0:low"
  "hot_disjoint:1:low"
  "hot_conflict:1:high"
)

COMMON=(--atm-backend real --compose-window-ms 100 --agents 3 --trials 5
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)

LOG="$ROOT/runs/e1-pilot/matrix.log"
: > "$LOG"
echo "E1 matrix start $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG"

n=0
for wl in "${WORKLOADS[@]}"; do
  IFS=: read -r wid hot ov <<< "$wl"
  for arm in "${ARMS[@]}"; do
    for seed in "${SEEDS[@]}"; do
      rid="e1-${wid}-${arm}-s${seed}"
      n=$((n+1))
      echo "[$n] $rid" | tee -a "$LOG"
      node src/cli.mjs start --run-id "$rid" --arm "$arm" \
        --seed "$seed" --hot-ratio "$hot" --overlap "$ov" \
        "${COMMON[@]}" >>"$LOG" 2>&1
    done
  done
done

# Optional cheap diagnostic smoke (seed 11 hot_conflict only) — not in main table
for arm in admission_only raw_overwrite; do
  rid="e1-diag-${arm}-s11"
  echo "[diag] $rid" | tee -a "$LOG"
  node src/cli.mjs start --run-id "$rid" --arm "$arm" \
    --seed 11 --hot-ratio 1 --overlap high \
    "${COMMON[@]}" >>"$LOG" 2>&1 || echo "diag $arm failed" | tee -a "$LOG"
done

echo "E1 matrix end $(date '+%Y-%m-%d %H:%M:%S %Z') cells=$n" | tee -a "$LOG"

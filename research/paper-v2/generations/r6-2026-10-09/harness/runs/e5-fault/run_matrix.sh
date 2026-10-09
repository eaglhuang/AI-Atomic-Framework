#!/usr/bin/env bash
# E5 harness cells: OCC exhaust (stale CAS) + clean steward control
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43

SEEDS=(11 17 23)
COMMON=(--atm-backend real --compose-window-ms 100 --agents 3 --trials 5
  --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25
  --tick-interval-ms 15 --jitter-ms 6 --force)

LOG="$ROOT/runs/e5-fault/matrix.log"
: > "$LOG"
echo "E5 harness start $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG"
echo "BANNER: DRAFT — not a win claim; fault arms non-competitors" | tee -a "$LOG"

n=0
# OCC exhaust → expected blocked (stale CAS / retries exhausted)
for seed in "${SEEDS[@]}"; do
  sched=$((seed + 1000))
  rid="e5-occ_exhaust-s${seed}"
  n=$((n+1))
  echo "[$n] FAULT_OCC $rid" | tee -a "$LOG"
  node src/cli.mjs start --run-id "$rid" --arm occ --occ-max-retries 0 \
    --seed "$seed" --scheduler-seed "$sched" "${COMMON[@]}" >>"$LOG" 2>&1
done

# Clean steward control
for seed in "${SEEDS[@]}"; do
  sched=$((seed + 1000))
  rid="e5-clean_steward-s${seed}"
  n=$((n+1))
  echo "[$n] CONTROL $rid" | tee -a "$LOG"
  node src/cli.mjs start --run-id "$rid" --arm steward \
    --seed "$seed" --scheduler-seed "$sched" "${COMMON[@]}" >>"$LOG" 2>&1
done

# Also re-run probe if out missing (idempotent note)
echo "E5 harness end $(date '+%Y-%m-%d %H:%M:%S %Z') harness_cells=$n (+12 probe)" | tee -a "$LOG"

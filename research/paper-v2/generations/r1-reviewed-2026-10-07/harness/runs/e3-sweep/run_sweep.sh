#!/usr/bin/env bash
# E3 window sweep — harness-only; ATM read-only; seeds from seeds.json (pre-registered)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43

WINDOWS=(0 25 50 100 200 400)
SEEDS=(11 17 23 29 31)
WORKLOADS=(
  "cold:0:low"
  "hot_disjoint:1:low"
  "hot_conflict:1:high"
)

COMMON=(--atm-backend real --agents 3 --trials 5
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)

LOG="$ROOT/runs/e3-sweep/matrix.log"
: > "$LOG"
echo "E3 sweep start $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG"
echo "NOTE: seeds registered before runs in runs/e3-sweep/SEEDS_REGISTERED.md" | tee -a "$LOG"
echo "BANNER: DRAFT evidence — not a win claim" | tee -a "$LOG"
echo "expected_cells=120 (steward 90 + bare_composer hot_conflict 30)" | tee -a "$LOG"

n=0
# Primary: steward × all workloads × all windows × seeds
for wl in "${WORKLOADS[@]}"; do
  IFS=: read -r wid hot ov <<< "$wl"
  for w in "${WINDOWS[@]}"; do
    for seed in "${SEEDS[@]}"; do
      sched=$((seed + 1000))
      rid="e3-${wid}-steward-w${w}-s${seed}"
      n=$((n+1))
      echo "[$n/120] $rid wl=$seed sched=$sched window=${w}ms" | tee -a "$LOG"
      node src/cli.mjs start --run-id "$rid" --arm steward \
        --seed "$seed" --scheduler-seed "$sched" \
        --compose-window-ms "$w" \
        --hot-ratio "$hot" --overlap "$ov" \
        "${COMMON[@]}" >>"$LOG" 2>&1
    done
  done
done

# Contrast: bare_composer × hot_conflict only
for w in "${WINDOWS[@]}"; do
  for seed in "${SEEDS[@]}"; do
    sched=$((seed + 1000))
    rid="e3-hot_conflict-bare_composer-w${w}-s${seed}"
    n=$((n+1))
    echo "[$n/120] $rid wl=$seed sched=$sched window=${w}ms" | tee -a "$LOG"
    node src/cli.mjs start --run-id "$rid" --arm bare_composer \
      --seed "$seed" --scheduler-seed "$sched" \
      --compose-window-ms "$w" \
      --hot-ratio 1 --overlap high \
      "${COMMON[@]}" >>"$LOG" 2>&1
  done
done

echo "E3 sweep end $(date '+%Y-%m-%d %H:%M:%S %Z') cells=$n" | tee -a "$LOG"

#!/usr/bin/env bash
# E4 multi-process — harness-only; ATM read-only; seeds pre-registered
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43

SEEDS=(11 17 23)
PROCS=(2 4 8)
COMMON=(--atm-backend real --arm steward --compose-window-ms 100
  --agents 8 --trials 5 --hot-ratio 1 --overlap high
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)

LOG="$ROOT/runs/e4-multiprocess/matrix.log"
: > "$LOG"
echo "E4 matrix start $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG"
echo "NOTE: seeds registered before runs in runs/e4-multiprocess/SEEDS_REGISTERED.md" | tee -a "$LOG"
echo "BANNER: DRAFT evidence — not a win claim; fault arms isolated" | tee -a "$LOG"
echo "expected_cells=18" | tee -a "$LOG"

n=0

# 1) Main: steward CAS+lock × procs 2/4/8 × seeds
for procs in "${PROCS[@]}"; do
  for seed in "${SEEDS[@]}"; do
    sched=$((seed + 1000))
    rid="e4-hot_conflict-steward-p${procs}-s${seed}"
    n=$((n+1))
    echo "[$n/18] MAIN $rid" | tee -a "$LOG"
    node src/cli.mjs run-mp --run-id "$rid" --mode atm \
      --seed "$seed" --scheduler-seed "$sched" --procs "$procs" \
      --registry-sync cas --apply-lock on \
      "${COMMON[@]}" >>"$LOG" 2>&1
  done
done

# 2) SP baseline steward (single-process start — not run-mp)
for seed in "${SEEDS[@]}"; do
  sched=$((seed + 1000))
  rid="e4-hot_conflict-steward-sp-s${seed}"
  n=$((n+1))
  echo "[$n/18] SP $rid" | tee -a "$LOG"
  node src/cli.mjs start --run-id "$rid" \
    --seed "$seed" --scheduler-seed "$sched" \
    "${COMMON[@]}" >>"$LOG" 2>&1
done

# 3) Fault: naive registry (p8) — expects zombie leases
for seed in "${SEEDS[@]}"; do
  sched=$((seed + 1000))
  rid="e4-hot_conflict-fault_naive-p8-s${seed}"
  n=$((n+1))
  echo "[$n/18] FAULT_NAIVE $rid" | tee -a "$LOG"
  node src/cli.mjs run-mp --run-id "$rid" --mode atm \
    --seed "$seed" --scheduler-seed "$sched" --procs 8 \
    --registry-sync naive --apply-lock on \
    "${COMMON[@]}" >>"$LOG" 2>&1
done

# 4) Fault: apply-lock off (p8) — may lose updates
for seed in "${SEEDS[@]}"; do
  sched=$((seed + 1000))
  rid="e4-hot_conflict-fault_nolock-p8-s${seed}"
  n=$((n+1))
  echo "[$n/18] FAULT_NOLOCK $rid" | tee -a "$LOG"
  node src/cli.mjs run-mp --run-id "$rid" --mode atm \
    --seed "$seed" --scheduler-seed "$sched" --procs 8 \
    --registry-sync cas --apply-lock off \
    "${COMMON[@]}" >>"$LOG" 2>&1
done

echo "E4 matrix end $(date '+%Y-%m-%d %H:%M:%S %Z') cells=$n" | tee -a "$LOG"

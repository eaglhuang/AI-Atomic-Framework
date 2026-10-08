#!/usr/bin/env bash
# r2 P0-1 forensics — E4 main_steward_mp p2 seed17/sched1017 replay + steward-lock mitigation.
# Harness-only; ATM pin read-only; new run ids only (never overwrites r1 cells). DRAFT, not a win claim.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
COMMON=(--atm-backend real --arm steward --compose-window-ms 100 --agents 8 --trials 5 --hot-ratio 1 --overlap high
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)
LOG="$ROOT/runs/r2-e4-forensics/forensics.log"; : > "$LOG"
REPS_CELL=${REPS_CELL:-30}; REPS_GRID=${REPS_GRID:-5}
run(){ # rid procs seed slock
  node src/cli.mjs run-mp --run-id "$1" --mode atm --seed "$3" --scheduler-seed $(( $3 + 1000 )) --procs "$2" \
    --registry-sync cas --apply-lock on --steward-apply-lock "$4" "${COMMON[@]}" 2>&1 | grep -E 'oracle_correct' | sed "s/^/$1 /" >>"$LOG"
}
echo "start $(date '+%F %T %Z')" >>"$LOG"
for r in $(seq -w 1 $REPS_CELL); do run "r2f-e4-p2-s17-r1cfg-r$r" 2 17 off; run "r2f-e4-p2-s17-slock-r$r" 2 17 on; done
for procs in 2 4 8; do for seed in 11 17 23; do for r in $(seq -w 1 $REPS_GRID); do
  run "r2f-e4-p${procs}-s${seed}-g-r1cfg-r$r" $procs $seed off; run "r2f-e4-p${procs}-s${seed}-g-slock-r$r" $procs $seed on
done; done; done
echo "end $(date '+%F %T %Z')" >>"$LOG"

#!/usr/bin/env bash
# r3 addendum (run after main r3 at 10:53): SP E4 noise check — 5 reps x seeds 11/17/23 x {old,fix}, same flags as r3m SP cells.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"; export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
OLD=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
NEW=/workspace/atm-main-bea35380/AI-Atomic-Framework-bea35380d7f381f998c9930fa95f01b999c7f208
D="$ROOT/runs/r3-validation"; LOG="$D/r3.log"; echo "phase sp-noise $(date '+%F %T %Z')" >> "$LOG"
for r in 1 2 3 4 5; do for seed in 11 17 23; do for a in old fix; do
  rid="r3s-e4-steward-sp-s${seed}-r${r}-$a"; [ -e "runs/$rid" ] && { echo "REFUSE $rid"; exit 3; }
  P=$([ $a = old ] && echo $OLD || echo $NEW)
  ATM_MONOREPO=$P node src/cli.mjs start --run-id "$rid" --seed $seed --scheduler-seed $((seed+1000)) --atm-backend real --arm steward \
    --compose-window-ms 100 --agents 8 --trials 5 --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force \
    > "$D/stdout/$rid.log" 2>&1 && rc=0 || rc=$?; echo "$rid rc=$rc" >> "$LOG"
done; done; done
echo "end sp-noise $(date '+%F %T %Z')" >> "$LOG"

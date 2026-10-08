#!/usr/bin/env bash
# r3 validation of ATM PR #213 (merge bea35380) — harness-only; both ATM pins read-only; new run ids only (r3*).
# Arms (interleaved per run to share box conditions):
#   old     = ATM 5692474f, harness --steward-apply-lock off   (same-time control; = r2 "r1cfg")
#   fix     = ATM bea35380, harness --steward-apply-lock off   (MAIN r3 comparison: ATM itself must be safe)
#   fixlock = ATM bea35380, harness --steward-apply-lock on    (secondary)
# DRAFT evidence, not a win claim.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
OLD=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
NEW=/workspace/atm-main-bea35380/AI-Atomic-Framework-bea35380d7f381f998c9930fa95f01b999c7f208
D="$ROOT/runs/r3-validation"; LOG="$D/r3.log"
PHASES=${PHASES:-"barrier replay matrix regression"}
REPS_CELL=${REPS_CELL:-30}; REPS_GRID=${REPS_GRID:-5}; BARRIER_REPS=${BARRIER_REPS:-20}
MP=(--atm-backend real --arm steward --compose-window-ms 100 --agents 8 --trials 5 --hot-ratio 1 --overlap high
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)
pin(){ case "$1" in old) echo "$OLD";; fix|fixlock) echo "$NEW";; esac; }
slk(){ [ "$1" = fixlock ] && echo on || echo off; }
guard(){ [ -e "runs/$1" ] && { echo "REFUSE: runs/$1 exists" | tee -a "$LOG"; exit 3; } || true; }
mp(){ # rid arm procs seed registry applylock
  guard "$1"
  ATM_MONOREPO=$(pin "$2") node src/cli.mjs run-mp --run-id "$1" --mode atm --seed "$4" --scheduler-seed $(( $4 + 1000 )) --procs "$3" \
    --registry-sync "$5" --apply-lock "$6" --steward-apply-lock "$(slk "$2")" "${MP[@]}" > "$D/stdout/$1.log" 2>&1 && rc=0 || rc=$?
  echo "$1 rc=$rc $(grep -Eo 'oracle_correct[^ ]*' "$D/stdout/$1.log" | tail -1)" >> "$LOG"
}
sp(){ # rid arm-pin cli-arm seed hot overlap agents
  guard "$1"
  ATM_MONOREPO=$(pin "$2") node src/cli.mjs start --run-id "$1" --arm "$3" --seed "$4" --scheduler-seed $(( $4 + 1000 )) \
    --hot-ratio "$5" --overlap "$6" --atm-backend real --compose-window-ms 100 --agents "$7" --trials 5 \
    --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force > "$D/stdout/$1.log" 2>&1 && rc=0 || rc=$?
  echo "$1 rc=$rc" >> "$LOG"
}
mkdir -p "$D/stdout"; echo "start $(date '+%F %T %Z') phases=[$PHASES]" >> "$LOG"
for ph in $PHASES; do echo "phase $ph $(date '+%T')" >> "$LOG"; case $ph in
barrier)
  for p in old:$OLD fix:$NEW; do for v in "reducers reducers" "selectors reducers"; do set -- $v
    node test/barrier_interleave.mjs --atm "${p#*:}" --out "$D/barrier/${p%%:*}-L$1-F$2" --reps "$BARRIER_REPS" --lregion "$1" --fregion "$2" >> "$LOG" 2>&1
  done; done;;
replay)  # = r2 forensics config: 30 exact p2/s17 + grid p{2,4,8} x s{11,17,23} x 5  => 75 runs per arm (35 at p2/s17)
  for r in $(seq -w 1 $REPS_CELL); do for a in old fix fixlock; do mp "r3v-e4-p2-s17-$a-r$r" $a 2 17 cas on; done; done
  for procs in 2 4 8; do for seed in 11 17 23; do for r in $(seq -w 1 $REPS_GRID); do for a in old fix fixlock; do
    mp "r3v-e4-p${procs}-s${seed}-g-$a-r$r" $a $procs $seed cas on; done; done; done; done;;
matrix)  # = r1 E4 18 cells (same seeds/flags) at old and fix; main steward cells also at fixlock
  for a in old fix fixlock; do
    for procs in 2 4 8; do for seed in 11 17 23; do mp "r3m-e4-hot_conflict-steward-p${procs}-s${seed}-$a" $a $procs $seed cas on; done; done
    [ $a = fixlock ] && continue
    for seed in 11 17 23; do
      guard "r3m-e4-hot_conflict-steward-sp-s${seed}-$a"
      ATM_MONOREPO=$(pin $a) node src/cli.mjs start --run-id "r3m-e4-hot_conflict-steward-sp-s${seed}-$a" --seed $seed --scheduler-seed $((seed+1000)) "${MP[@]}" \
        > "$D/stdout/r3m-e4-hot_conflict-steward-sp-s${seed}-$a.log" 2>&1 && rc=0 || rc=$?; echo "r3m-e4-hot_conflict-steward-sp-s${seed}-$a rc=$rc" >> "$LOG"
      mp "r3m-e4-hot_conflict-fault_naive-p8-s${seed}-$a" $a 8 $seed naive on
      mp "r3m-e4-hot_conflict-fault_nolock-p8-s${seed}-$a" $a 8 $seed cas off
    done
  done;;
regression)  # single-process E2 subset: 3 workloads x 5 arms x seeds 11/17/23 x 2 reps, pins interleaved
  for wl in hot_conflict:1:high hot_disjoint:1:low cold:0:low; do IFS=: read -r wid hot ov <<< "$wl"
    for arm in steward file_lock occ git_three_way bare_composer; do for seed in 11 17 23; do for r in 1 2; do for a in old fix; do
      sp "r3r-e2-${wid}-${arm}-s${seed}-r${r}-$a" $a $arm $seed $hot $ov 3; done; done; done; done; done;;
esac; done
echo "end $(date '+%F %T %Z')" >> "$LOG"

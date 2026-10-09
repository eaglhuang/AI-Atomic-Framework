#!/usr/bin/env bash
# r4 validation of ATM PR #214 (merge 2118bc66; steward completion-rate optimizations) — harness-only; all ATM pins read-only.
# Same E4 config/seeds as r3. Arms (interleaved per run, same session/machine):
#   old     = ATM 5692474f, harness --steward-apply-lock off   (pre-#213 control)
#   fix     = ATM bea35380, harness --steward-apply-lock off   (PR #213; r3 main arm)
#   opt     = ATM 2118bc66, harness --steward-apply-lock off   (MAIN r4 arm: ATM defaults)
#   optlock = ATM 2118bc66, harness --steward-apply-lock on    (secondary)
#   optr0   = ATM 2118bc66, lock off, recomposePolicy {maxRecomposeAttempts:0}                         (ablation: no re-compose retries)
#   optr1   = ATM 2118bc66, lock off, recomposePolicy {maxRecomposeAttempts:1, backoff 0, jitter 0}    (ablation: r3 retry budget, no backoff)
# DRAFT evidence, not a win claim.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
OLD=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
FIX=/workspace/atm-main-bea35380/AI-Atomic-Framework-bea35380d7f381f998c9930fa95f01b999c7f208
OPT=/workspace/atm-main-2118bc66/AI-Atomic-Framework-2118bc66efb3ac3bc0ddaede6a2f7cb18526b030
D="$ROOT/runs/r4-validation"; LOG="$D/r4.log"
PHASES=${PHASES:-"barrier replay matrix regression faults"}
REPS_CELL=${REPS_CELL:-35}; REPS_GRID=${REPS_GRID:-5}; BARRIER_REPS=${BARRIER_REPS:-20}; FAULT_REPS=${FAULT_REPS:-10}
ARMS=${ARMS:-"old fix opt optlock optr0 optr1"}
MP=(--atm-backend real --arm steward --compose-window-ms 100 --agents 8 --trials 5 --hot-ratio 1 --overlap high
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)
pin(){ case "$1" in old) echo "$OLD";; fix) echo "$FIX";; *) echo "$OPT";; esac; }
slk(){ [ "$1" = optlock ] && echo on || echo off; }
pol(){ case "$1" in optr0) echo '{"maxRecomposeAttempts":0}';; optr1) echo '{"maxRecomposeAttempts":1,"recomposeBackoffMs":0,"recomposeJitterMs":0}';; *) echo "";; esac; }
guard(){ [ -e "runs/$1" ] && { echo "REFUSE: runs/$1 exists" | tee -a "$LOG"; exit 3; } || true; }
mp(){ # rid arm procs seed registry applylock
  guard "$1"; local P; P=$(pol "$2")
  env ${P:+ATM_BENCH_RECOMPOSE_POLICY=$P} ATM_MONOREPO=$(pin "$2") node src/cli.mjs run-mp --run-id "$1" --mode atm --seed "$4" --scheduler-seed $(( $4 + 1000 )) --procs "$3" \
    --registry-sync "$5" --apply-lock "$6" --steward-apply-lock "$(slk "$2")" "${MP[@]}" > "$D/stdout/$1.log" 2>&1 && rc=0 || rc=$?
  echo "$1 rc=$rc policy=${P:-default}" >> "$LOG"
}
sp(){ # rid arm-pin cli-arm seed hot overlap agents
  guard "$1"
  ATM_MONOREPO=$(pin "$2") node src/cli.mjs start --run-id "$1" --arm "$3" --seed "$4" --scheduler-seed $(( $4 + 1000 )) \
    --hot-ratio "$5" --overlap "$6" --atm-backend real --compose-window-ms 100 --agents "$7" --trials 5 \
    --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force > "$D/stdout/$1.log" 2>&1 && rc=0 || rc=$?
  echo "$1 rc=$rc" >> "$LOG"
}
mkdir -p "$D/stdout" "$D/barrier" "$D/faults"; echo "start $(date '+%F %T %Z') phases=[$PHASES] arms=[$ARMS]" >> "$LOG"
for ph in $PHASES; do echo "phase $ph $(date '+%T')" >> "$LOG"; case $ph in
barrier)  # seam mode (= r3) at all three pins; stale-proposal at bea35380/2118bc66; before-precheck at 2118bc66 only (hook forwarded only there)
  for p in old:$OLD fix:$FIX opt:$OPT; do for v in "reducers reducers" "selectors reducers"; do set -- $v
    node test/barrier_interleave.mjs --mode seam --atm "${p#*:}" --out "$D/barrier/seam-${p%%:*}-L$1-F$2" --reps "$BARRIER_REPS" --lregion "$1" --fregion "$2" >> "$LOG" 2>&1
  done; done
  for p in fix:$FIX opt:$OPT; do for v in "reducers reducers" "selectors reducers"; do set -- $v
    node test/barrier_interleave.mjs --mode stale-proposal --atm "${p#*:}" --out "$D/barrier/staleprop-${p%%:*}-L$1-F$2" --reps "$BARRIER_REPS" --lregion "$1" --fregion "$2" >> "$LOG" 2>&1
  done; done
  for v in "reducers reducers" "selectors reducers"; do set -- $v
    node test/barrier_interleave.mjs --mode before-precheck --atm "$OPT" --out "$D/barrier/beforeprecheck-opt-L$1-F$2" --reps "$BARRIER_REPS" --lregion "$1" --fregion "$2" >> "$LOG" 2>&1
  done;;
replay)  # = r3 replay config: 35 exact p2/s17 + grid p{2,4,8} x s{11,17,23} x 5 => 75 runs per arm (r3 had 30 p2/s17 + 5 grid p2/s17 = 35)
  for r in $(seq -w 1 30); do for a in $ARMS; do mp "r4v-e4-p2-s17-$a-r$r" $a 2 17 cas on; done; done
  for procs in 2 4 8; do for seed in 11 17 23; do for r in $(seq -w 1 $REPS_GRID); do for a in $ARMS; do
    mp "r4v-e4-p${procs}-s${seed}-g-$a-r$r" $a $procs $seed cas on; done; done; done; done;;
matrix)  # = r1 E4 18 cells at old/fix/opt; main steward cells also at optlock
  for a in old fix opt optlock; do
    for procs in 2 4 8; do for seed in 11 17 23; do mp "r4m-e4-hot_conflict-steward-p${procs}-s${seed}-$a" $a $procs $seed cas on; done; done
    [ $a = optlock ] && continue
    for seed in 11 17 23; do
      guard "r4m-e4-hot_conflict-steward-sp-s${seed}-$a"
      ATM_MONOREPO=$(pin $a) node src/cli.mjs start --run-id "r4m-e4-hot_conflict-steward-sp-s${seed}-$a" --seed $seed --scheduler-seed $((seed+1000)) "${MP[@]}" \
        > "$D/stdout/r4m-e4-hot_conflict-steward-sp-s${seed}-$a.log" 2>&1 && rc=0 || rc=$?; echo "r4m-e4-hot_conflict-steward-sp-s${seed}-$a rc=$rc" >> "$LOG"
      mp "r4m-e4-hot_conflict-fault_naive-p8-s${seed}-$a" $a 8 $seed naive on
      mp "r4m-e4-hot_conflict-fault_nolock-p8-s${seed}-$a" $a 8 $seed cas off
    done
  done;;
regression)  # single-process E2 subset (= r3): 3 workloads x 5 arms x seeds 11/17/23 x 2 reps; pins bea35380 vs 2118bc66 interleaved
  for wl in hot_conflict:1:high hot_disjoint:1:low cold:0:low; do IFS=: read -r wid hot ov <<< "$wl"
    for arm in steward file_lock occ git_three_way bare_composer; do for seed in 11 17 23; do for r in 1 2; do for a in fix opt; do
      sp "r4r-e2-${wid}-${arm}-s${seed}-r${r}-$a" $a $arm $seed $hot $ov 3; done; done; done; done; done;;
faults)  # harness-level fault scenarios at 2118bc66 (main) and bea35380 (contrast); 5692474f has no commit lock (N/A)
  node test/r4_fault_scenarios.mjs --pins "2118bc66=$OPT,bea35380=$FIX" --out "$D/faults" --reps "$FAULT_REPS" > "$D/faults/summary.stdout.json" 2> "$D/faults/progress.log" && rc=0 || rc=$?
  echo "faults rc=$rc" >> "$LOG";;
esac; done
echo "end $(date '+%F %T %Z')" >> "$LOG"

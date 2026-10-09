#!/usr/bin/env bash
# r6 small validation of ATM PR #238 (merge b35a6141: apply-queue SQLITE_BUSY/SQLITE_LOCKED -> per-target file-lock fallback;
# presence files cleaned in finally). Harness-only; pins read-only. Pre-registered in PREREG_R6.md (sha256 logged first).
# Arms (interleaved per run): q5 = ATM 37847584 queue on | q6 = ATM b35a6141 queue on (main) | nq6 = ATM b35a6141 queue off.
# DRAFT evidence, not a win claim.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:${PATH:-}
unset ATM_STEWARD_APPLY_QUEUE ATM_STEWARD_RECOMPOSE_POLICY ATM_STEWARD_APPLY_QUEUE_WAIT_MS ATM_STEWARD_COMMIT_LOCK_ROOT ATM_STEWARD_APPLY_QUEUE_ROOT ATM_BENCH_RECOMPOSE_POLICY
P5=/workspace/atm-main-37847584/AI-Atomic-Framework-37847584e24afc08ea58cfe380bb5b1220fbe335
P6=/workspace/atm-main-b35a6141/AI-Atomic-Framework-b35a6141bd5bfbaec654f1cd3079323581b04074
D="$ROOT/runs/r6-validation"; LOG="$D/r6.log"
PHASES=${PHASES:-"replay matrix stress faults barrier"}
ARMS=${ARMS:-"q5 q6 nq6"}
MP=(--atm-backend real --arm steward --compose-window-ms 100 --agents 8 --trials 5 --hot-ratio 1 --overlap high
  --hold-ms-min 8 --hold-ms-max 25 --tick-interval-ms 15 --jitter-ms 6 --force)
pin(){ case "$1" in q5) echo "$P5";; *) echo "$P6";; esac; }
aenv(){ case "$1" in q5|q6) echo "ATM_STEWARD_APPLY_QUEUE=on";; nq6) echo "ATM_STEWARD_APPLY_QUEUE=off";; esac; }
load(){ echo "load $1 $(date '+%F %T %Z') nproc=$(nproc) $(uptime | sed 's/.*load average/loadavg/')" | tee -a "$D/LOAD.log" >> "$LOG"; }
guard(){ [ -e "runs/$1" ] && { echo "REFUSE: runs/$1 exists" | tee -a "$LOG"; exit 3; } || true; }
mp(){ # rid arm procs seed
  guard "$1"; local E; read -r -a E <<< "$(aenv "$2")"
  env "${E[@]}" ATM_MONOREPO=$(pin "$2") node src/cli.mjs run-mp --run-id "$1" --mode atm --seed "$4" --scheduler-seed $(( $4 + 1000 )) --procs "$3" \
    --registry-sync cas --apply-lock on --steward-apply-lock off "${MP[@]}" > "$D/stdout/$1.log" 2>&1 && rc=0 || rc=$?
  echo "$1 rc=$rc env=[${E[*]}]" >> "$LOG"
}
bar(){ # mode name atm extra-env...
  local mode=$1 name=$2 atm=$3; shift 3
  for v in "reducers reducers" "selectors reducers"; do set -- $v "$@"; local L=$1 F=$2; shift 2
    env "$@" node test/barrier_interleave.mjs --mode "$mode" --atm "$atm" --out "$D/barrier/$mode-$name-L$L-F$F" --reps 10 --lregion "$L" --fregion "$F" >> "$LOG" 2>&1
  done
}
mkdir -p "$D/stdout" "$D/barrier" "$D/faults" "$D/forensics/sqlite-busy"
echo "prereg $(sha256sum "$D/PREREG_R6.md")" >> "$LOG"
echo "start $(date '+%F %T %Z') phases=[$PHASES] arms=[$ARMS]" >> "$LOG"
for ph in $PHASES; do echo "phase $ph $(date '+%T')" >> "$LOG"; load "$ph"; case $ph in
replay)  # 2 blocks x 75 runs per arm (block 2 = same configs/seeds, reps continue)
  for blk in 1 2; do
    o=$(( (blk-1)*30 )); og=$(( (blk-1)*5 ))
    for i in $(seq 1 30); do r=$(printf %02d $((i+o))); for a in $ARMS; do mp "r6v-e4-p2-s17-$a-r$r" $a 2 17; done; done
    load "replay-block$blk-grid"
    for procs in 2 4 8; do for seed in 11 17 23; do for i in $(seq 1 5); do r=$((i+og)); for a in $ARMS; do
      mp "r6v-e4-p${procs}-s${seed}-g-$a-r$r" $a $procs $seed; done; done; done; done
  done;;
matrix)
  for a in $ARMS; do for procs in 2 4 8; do for seed in 11 17 23; do mp "r6m-e4-hot_conflict-steward-p${procs}-s${seed}-$a" $a $procs $seed; done; done; done;;
stress)  # r5 forensics repro, unchanged except import path; 8 procs x 300 calls; 3 rounds per pin, interleaved
  for round in 1 2 3; do for p in 37847584 b35a6141; do
    tree=$([ $p = 37847584 ] && echo "$P5" || echo "$P6")
    sed "s|__ATM__|$tree|" "$D/forensics/sqlite-busy/queue_busy_repro.template.mjs" > "$D/forensics/sqlite-busy/queue_busy_repro.$p.mjs"
    w=$(mktemp -d /tmp/r6-stress-$p-XXXX); out="$D/forensics/sqlite-busy/stress-$p-round$round.jsonl"
    for i in 1 2 3 4 5 6 7 8; do node --no-warnings "$D/forensics/sqlite-busy/queue_busy_repro.$p.mjs" "$w" 300 >> "$out" 2>>"$out.stderr" & done; wait
    left=$(find "$w/.atm/runtime/broker-steward-apply-queue" -path '*/p/*' -type f 2>/dev/null | wc -l)
    echo "{\"pin\":\"$p\",\"round\":$round,\"presence_files_left\":$left,\"dir\":\"$w\"}" >> "$D/forensics/sqlite-busy/stress-summary.jsonl"
    echo "stress $p round$round left=$left" >> "$LOG"; rm -rf "$w"
  done; done;;
faults)
  node test/r5_fault_scenarios.mjs --pins "b35a6141-qon=$P6,b35a6141-qoff=$P6" --only F6,F1,O2 --out "$D/faults/f6-f1-o2" --reps 10 > "$D/faults/f6-f1-o2.summary.json" 2> "$D/faults/f6-f1-o2.progress.log" && rc=0 || rc=$?
  echo "faults f6-f1-o2 rc=$rc" >> "$LOG"; load faults-4b
  node test/r5_fault_scenarios.mjs --pins "b35a6141-qon=$P6,b35a6141-qoff=$P6" --only F2,F2b,F3,F4,F5,F7 --out "$D/faults/rest" --reps 3 > "$D/faults/rest.summary.json" 2> "$D/faults/rest.progress.log" && rc=0 || rc=$?
  echo "faults rest rc=$rc" >> "$LOG";;
barrier)
  bar seam b35a6141-qoff "$P6" ATM_STEWARD_APPLY_QUEUE=off
  bar stale-proposal b35a6141-qon "$P6" ATM_STEWARD_APPLY_QUEUE=on; bar stale-proposal b35a6141-qoff "$P6" ATM_STEWARD_APPLY_QUEUE=off;;
esac; done
load end
echo "end $(date '+%F %T %Z')" >> "$LOG"

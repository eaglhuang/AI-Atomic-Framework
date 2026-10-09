#!/usr/bin/env bash
# Phase 3 — scale prelude (atm-bench 0.4.0). Box only, Node 24 (nvm), real ATM backend.
set -uo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
q() { local id=$1; shift; local t0=$(date +%s%N); node src/cli.mjs "$@" --run-id $id > runs/scale/.out-$id 2>&1; local rc=$?; echo "$id rc=$rc proc_wall_ms=$(( ($(date +%s%N) - t0) / 1000000 )) $(date +%T)"; }
S1="--seed 42 --agents 8 --trials 200 --hot-ratio 0.4 --overlap med --force"
S2="--seed 42 --agents 8 --trials 200 --hot-ratio 1 --overlap high --queue-timeout-ms 15000 --force"
S3="--seed 42 --agents 8 --trials 1000 --hot-ratio 0.4 --overlap med --force"
S4="--seed 42 --agents 8 --trials 200 --hot-ratio 0.4 --overlap med --tick-interval-ms 0 --hold-ms-min 0 --hold-ms-max 0 --jitter-ms 0 --force"
for R in 1 2; do
  q sc-S1-control-sp-r$R run-small --mode control $S1
  q sc-S1-atm-sp-r$R     run-small --mode atm $S1 --atm-backend real
  q sc-S1-atm-p8-r$R     run-mp    --mode atm $S1 --atm-backend real
done
q sc-S1-control-p8-r1 run-mp --mode control $S1
q sc-S2-control-sp-r1    run-small --mode control $S2
q sc-S2-atmloop-sp-r1    run-small --mode atm $S2 --atm-backend real --hot-retry loop
q sc-S2-atmloop-p8-r1    run-mp    --mode atm $S2 --atm-backend real --hot-retry loop
q sc-S4-control-sp-r1    run-small --mode control $S4
q sc-S4-atm-sp-r1        run-small --mode atm $S4 --atm-backend real
q sc-S4-atm-p8-r1        run-mp    --mode atm $S4 --atm-backend real
q sc-S3-control-sp-r1    run-small --mode control $S3
q sc-S3-atm-sp-r1        run-small --mode atm $S3 --atm-backend real
q sc-S3-atm-p8-r1        run-mp    --mode atm $S3 --atm-backend real
echo ALL_DONE $(date +%T)

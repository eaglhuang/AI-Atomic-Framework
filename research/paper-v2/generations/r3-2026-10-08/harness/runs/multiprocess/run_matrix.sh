#!/usr/bin/env bash
# Phase 2 — multi-process sessions (atm-bench 0.4.0). Box only, Node 24 (nvm), real ATM backend.
set -euo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
q() { node src/cli.mjs "$@" > /dev/null; }
# A: the COMPARE_LATENCY "small" scenario (6 agents x 30 trials, hot 0.4, overlap med)
A="--seed 42 --agents 6 --trials 30 --hot-ratio 0.4 --overlap med --force"
# B: hot stress (8 agents x 40 trials, hot 1.0, overlap high)
B="--seed 42 --agents 8 --trials 40 --hot-ratio 1 --overlap high --queue-timeout-ms 15000 --force"
for R in 1 2 3; do
  q run-mp    --mode control --run-id mp-A-control-p6-r$R $A
  q run-mp    --mode atm     --run-id mp-A-atm-p6-r$R     $A --atm-backend real
  q run-small --mode control --run-id mp-A-control-sp-r$R $A
  q run-small --mode atm     --run-id mp-A-atm-sp-r$R     $A --atm-backend real
  q run-mp    --mode control --run-id mp-B-control-p8-r$R $B
  q run-mp    --mode atm     --run-id mp-B-atm-p8-r$R     $B --atm-backend real
  q run-mp    --mode atm     --run-id mp-B-atmloop-p8-r$R $B --atm-backend real --hot-retry loop
  q run-mp    --mode atm     --run-id mp-B-atm-p4-r$R     $B --atm-backend real --procs 4
  q run-small --mode control --run-id mp-B-control-sp-r$R $B
  q run-small --mode atm     --run-id mp-B-atm-sp-r$R     $B --atm-backend real
  q run-small --mode atm     --run-id mp-B-atmloop-sp-r$R $B --atm-backend real --hot-retry loop
  # failure-mode probes
  q run-mp    --mode atm     --run-id mp-B-atmnaive-p8-r$R   $B --atm-backend real --registry-sync naive
  q run-mp    --mode atm     --run-id mp-B-atmnolock-p8-r$R  $B --atm-backend real --apply-lock off
  echo "done R=$R $(date +%T)"
done
echo ALL_DONE

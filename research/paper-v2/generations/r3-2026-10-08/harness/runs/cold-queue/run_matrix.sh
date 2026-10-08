#!/usr/bin/env bash
# Cold-queue latency matrix (atm-bench 0.3.1-coldq). Box only, Node 24.
set -euo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
T=60
for A in 8 16; do
  C="--seed 42 --agents $A --trials $T --hot-ratio 0 --overlap cold-same-file --cold-policy queue --queue-timeout-ms 15000 --force"
  for R in 1 2 3; do
    node src/cli.mjs run-small --mode control --run-id cq-control-a$A-r$R $C > /dev/null
    node src/cli.mjs run-small --mode atm --run-id cq-real-a$A-r$R $C --atm-backend real --cold-atom-identity region --cold-retry loop > /dev/null
    node src/cli.mjs run-small --mode atm --run-id cq-mock-a$A-r$R $C --atm-backend mock > /dev/null
    echo "done A=$A R=$R $(date +%T)"
  done
  node src/cli.mjs run-small --mode atm --run-id cq-reallegacy-a$A-r1 $C --atm-backend real > /dev/null
  echo "done legacy A=$A"
done
# max pressure: every trial on ONE cold file
A=16; C="--seed 42 --agents $A --trials $T --hot-ratio 0 --overlap cold-one-file --cold-policy queue --queue-timeout-ms 15000 --force"
node src/cli.mjs run-small --mode control --run-id cq1-control-a16-r1 $C > /dev/null
node src/cli.mjs run-small --mode atm --run-id cq1-real-a16-r1 $C --atm-backend real --cold-atom-identity region --cold-retry loop > /dev/null
node src/cli.mjs run-small --mode atm --run-id cq1-mock-a16-r1 $C --atm-backend mock > /dev/null
echo ALL_DONE

#!/usr/bin/env bash
# Cold-queue latency matrix vs ATM v0.1.17 (Oct 7 retest). Box only, Node 24.
# New run-ids prefixed v017- so Oct 6 baseline is preserved.
set -euo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
export ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17
cd /workspace/reports/atm-v2-harness
echo "ATM_MONOREPO=$ATM_MONOREPO node=$(node -v) start=$(date '+%F %T %Z')"
T=60
for A in 8 16; do
  C="--seed 42 --agents $A --trials $T --hot-ratio 0 --overlap cold-same-file --cold-policy queue --queue-timeout-ms 15000 --force"
  for R in 1 2 3; do
    node src/cli.mjs run-small --mode control --run-id v017-cq-control-a$A-r$R $C > /dev/null
    node src/cli.mjs run-small --mode atm --run-id v017-cq-real-a$A-r$R $C --atm-backend real --cold-atom-identity region --cold-retry loop > /dev/null
    node src/cli.mjs run-small --mode atm --run-id v017-cq-mock-a$A-r$R $C --atm-backend mock > /dev/null
    echo "done A=$A R=$R $(date +%T)"
  done
  node src/cli.mjs run-small --mode atm --run-id v017-cq-reallegacy-a$A-r1 $C --atm-backend real > /dev/null
  echo "done legacy A=$A $(date +%T)"
done
# max pressure: every trial on ONE cold file
A=16; C="--seed 42 --agents $A --trials $T --hot-ratio 0 --overlap cold-one-file --cold-policy queue --queue-timeout-ms 15000 --force"
node src/cli.mjs run-small --mode control --run-id v017-cq1-control-a16-r1 $C > /dev/null
node src/cli.mjs run-small --mode atm --run-id v017-cq1-real-a16-r1 $C --atm-backend real --cold-atom-identity region --cold-retry loop > /dev/null
node src/cli.mjs run-small --mode atm --run-id v017-cq1-mock-a16-r1 $C --atm-backend mock > /dev/null
echo "ALL_DONE cold $(date '+%F %T %Z')"

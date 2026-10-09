#!/usr/bin/env bash
# #180 acceptance: native cold queue wait (no overlay main arms). Box only, Node 24.
# Prefix v017-q180- — does not overwrite Oct6 / v017-* baselines.
set -euo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
export ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17
cd /workspace/reports/atm-v2-harness
echo "ATM_MONOREPO=$ATM_MONOREPO node=$(node -v) start=$(date '+%F %T %Z')"
T=60
for A in 8 16; do
  C="--seed 42 --agents $A --trials $T --hot-ratio 0 --overlap cold-same-file --cold-policy queue --queue-timeout-ms 15000 --force"
  for R in 1 2 3; do
    # control: no ATM
    node src/cli.mjs run-small --mode control --run-id v017-q180-control-a${A}-r${R} $C > /dev/null
    # native: real ATM, region atom, cold_retry=once (native queue wait once; no loop overlay)
    node src/cli.mjs run-small --mode atm --run-id v017-q180-native-a${A}-r${R} $C \
      --atm-backend real --cold-atom-identity region --cold-retry once > /dev/null
    # native-queue-wait: real ATM + new loop that waits on disposition=queue
    node src/cli.mjs run-small --mode atm --run-id v017-q180-nqwait-a${A}-r${R} $C \
      --atm-backend real --cold-atom-identity region --cold-retry native-queue > /dev/null
    echo "done A=$A R=$R $(date +%T)"
  done
done
# max pressure one-file ×1 each arm (a16)
A=16
C="--seed 42 --agents $A --trials $T --hot-ratio 0 --overlap cold-one-file --cold-policy queue --queue-timeout-ms 15000 --force"
node src/cli.mjs run-small --mode control --run-id v017-q180-1f-control-a16-r1 $C > /dev/null
node src/cli.mjs run-small --mode atm --run-id v017-q180-1f-native-a16-r1 $C \
  --atm-backend real --cold-atom-identity region --cold-retry once > /dev/null
node src/cli.mjs run-small --mode atm --run-id v017-q180-1f-nqwait-a16-r1 $C \
  --atm-backend real --cold-atom-identity region --cold-retry native-queue > /dev/null
echo "ALL_DONE q180 $(date '+%F %T %Z')"

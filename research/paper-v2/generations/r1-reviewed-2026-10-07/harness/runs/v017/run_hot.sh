#!/usr/bin/env bash
# Hot-file latency matrix vs ATM v0.1.17 (Oct 7 retest). Box only, Node 24.
# New run-ids prefixed v017- so Oct 6 baseline is preserved.
set -euo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
export ATM_MONOREPO=/workspace/atm-0.1.17/AI-Atomic-Framework-0.1.17
cd /workspace/reports/atm-v2-harness
echo "ATM_MONOREPO=$ATM_MONOREPO node=$(node -v) start=$(date '+%F %T %Z')"
T=50
run() { node src/cli.mjs run-small "$@" > /dev/null; }
for H in 1 0.8; do
  for A in 8 6; do
    [[ "$H" == "0.8" && "$A" == "6" ]] && continue
    tag="h${H/./}-a$A"
    C="--seed 42 --agents $A --trials $T --hot-ratio $H --overlap high --queue-timeout-ms 15000 --force"
    for R in 1 2 3; do
      run --mode control --run-id v017-hf-control-$tag-r$R $C
      run --mode atm --run-id v017-hf-native-$tag-r$R      $C --atm-backend real --hot-retry none --atm-writer sync
      run --mode atm --run-id v017-hf-loop-$tag-r$R        $C --atm-backend real --hot-retry loop --atm-writer sync
      run --mode atm --run-id v017-hf-nativestale-$tag-r$R $C --atm-backend real --hot-retry none --atm-writer stale
      run --mode atm --run-id v017-hf-loopstale-$tag-r$R   $C --atm-backend real --hot-retry loop --atm-writer stale
      [[ "$tag" == "h1-a8" ]] && run --mode atm --run-id v017-hf-mock-$tag-r$R $C --atm-backend mock
      echo "done $tag R=$R $(date +%T)"
    done
  done
done
echo "ALL_DONE hot $(date '+%F %T %Z')"

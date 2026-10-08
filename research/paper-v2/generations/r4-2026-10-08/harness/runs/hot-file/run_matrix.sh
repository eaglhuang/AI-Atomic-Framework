#!/usr/bin/env bash
# Phase 1 — hot-file focused matrix (atm-bench 0.4.0-hot). Box only, Node 24 (nvm), real ATM backend.
set -euo pipefail
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
T=50
run() { node src/cli.mjs run-small "$@" > /dev/null; }
for H in 1 0.8; do
  for A in 8 6; do
    [[ "$H" == "0.8" && "$A" == "6" ]] && continue
    tag="h${H/./}-a$A"
    C="--seed 42 --agents $A --trials $T --hot-ratio $H --overlap high --queue-timeout-ms 15000 --force"
    for R in 1 2 3; do
      run --mode control --run-id hf-control-$tag-r$R $C
      run --mode atm --run-id hf-native-$tag-r$R      $C --atm-backend real --hot-retry none --atm-writer sync
      run --mode atm --run-id hf-loop-$tag-r$R        $C --atm-backend real --hot-retry loop --atm-writer sync
      run --mode atm --run-id hf-nativestale-$tag-r$R $C --atm-backend real --hot-retry none --atm-writer stale
      run --mode atm --run-id hf-loopstale-$tag-r$R   $C --atm-backend real --hot-retry loop --atm-writer stale
      [[ "$tag" == "h1-a8" ]] && run --mode atm --run-id hf-mock-$tag-r$R $C --atm-backend mock
      echo "done $tag R=$R $(date +%T)"
    done
  done
done
echo ALL_DONE

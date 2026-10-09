#!/bin/bash
# HIST main run driver (prereg v1.1). Order: main per project (django sympy xarray pytest sphinx fastapi), then O0, then old pin.
# Stop rule §5.7: after each project batch, any steward (current pin) lost>0 or corrupted>0 => write STOP_COUNTEREXAMPLE and exit.
R=/workspace/reports/hist-main/main-2026-10-10; H=/workspace/reports/atm-v2-harness; NODE=/workspace/.nvm/versions/node/v24.21.0/bin/node
CUR=/workspace/atm-main-20effd45/AI-Atomic-Framework-20effd45a0c3a09c293caaea6a34face0df1c5f4
OLD=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
cd $H
check() {  # $1 = out dir
  python3 - "$1" <<'PY'
import json,sys
bad=[]
for l in open(sys.argv[1]+'/index.jsonl'):
    j=json.loads(l)
    if j['arm']=='steward' and ((j.get('lost') or 0)>0 or (j.get('corrupted') or 0)>0 or j.get('err')): bad.append(j)
if bad:
    json.dump(bad,open(sys.argv[1]+'/STOP_COUNTEREXAMPLE.json','w'),indent=1); print('COUNTEREXAMPLE',len(bad)); sys.exit(3)
PY
}
for p in django sympy xarray pytest sphinx fastapi; do
  echo "== main $p $(date '+%F %T %z')"
  ATM_MONOREPO=$CUR $NODE src/hist/batch.mjs --pairs $R/inputs/main_$p.jsonl --out $R/main/$p --seeds 0,1,2,3,4 --concurrency 3 --resume > $R/main/$p.log 2>&1 || echo "batch rc=$?"
  check $R/main/$p || { echo "STOP §5.7 after project $p $(date '+%F %T %z')"; touch $R/STOPPED; exit 3; }
done
echo "== o0 $(date '+%F %T %z')"
ATM_MONOREPO=$CUR $NODE src/hist/batch.mjs --pairs $R/inputs/pairs_o0.jsonl --out $R/o0 --seeds 0,1,2,3,4 --concurrency 3 --resume > $R/o0.log 2>&1
check $R/o0 || { echo "STOP §5.7 after o0"; touch $R/STOPPED; exit 3; }
echo "== old pin $(date '+%F %T %z')"
ATM_MONOREPO=$OLD $NODE src/hist/batch.mjs --pairs $R/inputs/pairs_main.jsonl --out $R/oldpin --seeds 0,1,2,3,4 --arms steward --concurrency 3 --resume > $R/oldpin.log 2>&1
echo "== done $(date '+%F %T %z')"; touch $R/DONE

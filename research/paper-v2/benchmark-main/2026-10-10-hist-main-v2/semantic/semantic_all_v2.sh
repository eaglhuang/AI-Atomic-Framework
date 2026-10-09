#!/bin/bash
# runs the STALE semantic endpoint on every final/final pair (main v1.0 + O0) after the write-safety runs are DONE
R=/workspace/reports/hist-main/main-v2-2026-10-10; S=/workspace/reports/hist-main/semantic; E=/workspace/scratch/hist/envs
while [ ! -f $R/DONE ]; do [ -f $R/STOPPED ] && { echo "write runs STOPPED; semantic not started"; exit 3; }; sleep 30; done
echo "start $(date '+%F %T %z')"
mkdir -p $S/out-v2
for f in $S/lists/*.jsonl; do
  b=$(basename $f .jsonl); IFS='_' read -r set_ _ proj _ env <<< "${b//__/_ _}"
  set_=${b%%__*}; rest=${b#*__}; proj=${rest%%__*}; env=""; [ "$proj" != "$rest" ] && env=${rest#*__}
  [ -f $S/out-v2/$b.json ] && continue
  if [ "$set_" = main ]; then runs=$R/main/$proj; else runs=$R/o0; fi
  case $proj in django) py=/workspace/scratch/hist/venv/bin/python;; fastapi) py=$E/fastapi-${env#st}/bin/python; py=$E/fastapi-st${env#st}/bin/python;; *) py=$E/$proj/bin/python;; esac
  echo "== $b runs=$runs py=$py $(date '+%T')"
  python3 $S/semantic_multi.py --project $proj --repo /workspace/scratch/hist/repos/$proj.git --pairs $f --runs $runs --out $S/out-v2/$b.json --jobs 3 --solo-reps 3 --timeout 1800 --python $py > $S/out-v2/$b.log 2>&1
  echo "   rc=$? $(date '+%T')"
done
echo "done $(date '+%F %T %z')"; touch $S/SEM_DONE_V2

#!/bin/bash
# Assemble benchmark-main/2026-10-10-hist-main-v2 into staging (run after analysis). Does NOT seal (seal.py does).
set -euo pipefail
H=/workspace/reports/hist-main; R=$H/main-v2-2026-10-10; S=$H/semantic; ST=/workspace/upload/hist-main-v2-staging
G=$ST/research/paper-v2/benchmark-main/2026-10-10-hist-main-v2
OLDG=/workspace/upload/hist-main-staging/research/paper-v2/benchmark-main/2026-10-10-hist-main
[ -e "$G" ] && { chmod -R u+w "$ST"; rm -rf "$ST"; }
mkdir -p $G/raw $G/analysis $G/semantic/envs $G/semantic/env-probes $G/forensics
cp -a $R/driver.sh $R/driver.log $R/DONE $R/o0.log $R/oldpin.log $R/main $R/o0 $R/oldpin $G/raw/
cp -a $H/analysis/analyze_main.py $H/analysis-v2/before_after.py $H/analysis-v2/out/* $G/analysis/
cp -a $S/semantic_multi.py $S/semantic_all_v2.sh $S/semantic_all_v2.log $S/lists $G/semantic/
cp -a $S/out-v2 $G/semantic/out
cp -a $OLDG/semantic-prep/envs/. $G/semantic/envs/; cp -a $OLDG/semantic-prep/env-probes/. $G/semantic/env-probes/
cp -a $H/forensics/repro_eof.mjs $H/forensics-v2/. $G/forensics/
cp -a $H/seal-v2/build.sh $H/seal-v2/seal.py $G/
find $G -name '*.pyc' -delete
echo built $G

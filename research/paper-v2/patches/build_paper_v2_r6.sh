#!/usr/bin/env bash
# Phase-1 builder for research/paper-v2 generation r6 (copy-only from harness; never touches r1-r5 bundles or staging).
set -euo pipefail
H=/workspace/reports/atm-v2-harness
G5=/workspace/upload/r5-staging/research/paper-v2/generations/r5-2026-10-08
STAGE=/workspace/upload/r6-staging/research/paper-v2
G=$STAGE/generations/r6-2026-10-09
[ -e "$G" ] && { echo "refuse: $G exists"; exit 1; }
[ -f "$G5/SHA256SUMS" ] || { echo "missing sealed r5 staging"; exit 1; }
mkdir -p $G/{harness,docs/supporting,docs/related-audits,docs/r6-notes,paper,tables,summaries,raw} $STAGE/patches
cd $H
cp1(){ mkdir -p "$(dirname "$2")"; cp -L "$1" "$2"; }
# harness
cp -rL src test analysis tools fixture skills $G/harness/
rm -rf $G/harness/analysis/__pycache__
# exclude concurrent, unrelated HIST work-in-progress (DEVIATIONS D9)
rm -rf $G/harness/src/hist $G/harness/test/hist_*
for f in package.json .gitignore README.md reproduce.sh REPRODUCE.md; do cp1 $f $G/harness/$f; done
cp1 node_modules/.package-lock.json $G/harness/installed-deps.package-lock.json
SUMMAIN="e1-pilot e2-matrix e3-sweep e4-multiprocess e5-fault steward-writer baselines composer-probe b5-b8"
SUMSUP="cold-queue compare hot-file multiprocess scale v017 v017-q180"
for d in $SUMMAIN $SUMSUP probe-cold r2-e4-forensics r3-validation r4-validation r5-validation r6-validation; do
  find runs/$d -maxdepth 1 \( -type f -o -type l \) \( -name '*.sh' -o -name '*.mjs' -o -name '*.mts' -o -name '*.py' \) -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/harness/$f"; done
done
# r5 -> r6 harness patch (relative to the sealed r5 harness copy)
T=$(mktemp -d); trap 'chmod -R u+w "$T"; rm -rf "$T"' EXIT
mkdir -p $T/r5 $T/r6/runs
cp -r $G5/harness/{src,test,analysis,tools,reproduce.sh,REPRODUCE.md,runs} $T/r5/
cp -r $G/harness/{src,test,analysis,tools,reproduce.sh,REPRODUCE.md} $T/r6/; cp -r $G/harness/runs/. $T/r6/runs/
( cd $T && diff -ruN r5 r6 ) > $G/harness/R6_CHANGES.patch || true
# summaries
for d in $SUMMAIN $SUMSUP r2-e4-forensics; do
  find runs/$d \( -type f -o -type l \) ! -name '*.sh' ! -name '*.mjs' ! -name '*.mts' ! -name '*.py' -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
done
for d in r3-validation r4-validation r5-validation r6-validation; do
  find runs/$d \( -type f -o -type l \) ! -path '*/stdout/*' ! -name '*.sh' ! -name '*.mjs' ! -name '*.py' -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
done
for d in r5-validation r6-validation; do find runs/$d/forensics -type f -print0 | while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done; done
find runs/r6-analysis/r6-2026-10-09 -type f -print0 | while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
# docs
for f in VERSION_ANCHORS.md METRIC_DEFINITIONS.md ARTIFACT_PACK_SPEC.md EXPERIMENT_CHECKLIST.md \
  COMPOSER_STEWARD_IMPL_PLAN.md COMPOSER_STEWARD_PAPER_PIVOT.md ATM_PAPER_V2_FEASIBILITY_REVIEW.md ATM_PAPER_V2_FEASIBILITY_REVIEW.docx \
  ATM_PAPER_V2_REVIEW_ABSORB_NOTES.md ATTACHED_PAPER_EXTRACT.md T6_R1_DENOMINATOR_AUDIT.md PAPER_V2_DRAFT_PACK.md PAPER_V2_DRAFT_PACK_INDEX.md \
  PAPER_V2_EXPERIMENT_NOTES.md PAPER_V2_KEY_TABLES.md REMAINING_TESTS.md FUNCTIONAL_SPEC.md PLAN_SPEC.md; do cp1 $f $G/docs/$f; done
for f in COLD_QUEUE_LATENCY.md COMPARE_LATENCY.md COMPARE_SMALL.md HOT_FILE_LATENCY.md MULTIPROCESS_SMALL.md SCALE_PRELUDE.md \
  V017_HOT_COLD.md SMOKE_RESULT.md HEAT_WEIGHT_OPTIMIZATION.md *.log; do cp1 $f $G/docs/supporting/$f; done
for f in ATOM_BEHAVIOR_POLICE_SURVEY.md ATOM_CREATE_MAP_REUSE_AUDIT.md BROKER_HARD_GATE_AUDIT.md VAI_COMMIT_ATLAS_PLAN.md VIRTUAL_ATOM_INDEX_ANALYSIS.md; do cp1 $f $G/docs/related-audits/$f; done
for f in ATM_PAPER_V2_DRAFT_zh.md ATM_PAPER_V2_DRAFT_zh_pre_review.md ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md; do cp1 $f $G/paper/$f; done
cp -L tables/* $G/tables/
# r6 notes: full r5->r6 text diff of paper/tables/docs
mkdir -p $T/t5 $T/t6
cp -r $G5/paper $G5/tables $T/t5/; cp $G5/docs/*.md $T/t5/
cp -r $G/paper $G/tables $T/t6/; cp $G/docs/*.md $T/t6/
( cd $T && diff -ruN t5 t6 ) > $G/docs/r6-notes/TEXT_CHANGES_r5_to_r6.diff || true
# root copies required by the generation spec
cp1 runs/r6-validation/DEVIATIONS.md $G/DEVIATIONS.md; cp1 runs/r6-validation/PINS.json $G/PINS.json; cp1 runs/r6-validation/PREREG_R6.md $G/PREREG_R6.md
# raw (deterministic; r1-r5 raw referenced by sha in PRIOR_REFERENCES.md, not re-packed)
detar(){ out=$1; shift; tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -cf - "$@" | gzip -n -9 > "$G/raw/$out"; }
for a in q5 q6 nq6; do detar r6-replay-$a.tgz $(ls -d runs/r6v-* | grep -E -- "-$a-r[0-9]+$"); done
detar r6-matrix.tgz $(ls -d runs/r6m-*)
detar r6-stdout.tgz runs/r6-validation/stdout
n=$(for a in q5 q6 nq6; do tar -tzf $G/raw/r6-replay-$a.tgz | grep -cE '^runs/r6v-[^/]+/$'; done | awk "{s+=\$1} END{print s}"); echo "replay runs packed: $n"
cp /workspace/reports/r6-work/genmeta/GENERATION.md /workspace/reports/r6-work/genmeta/PRIOR_REFERENCES.md $G/
echo PHASE1_OK
# phase 2 (separate, explicit): $H/tools/seal.sh $G

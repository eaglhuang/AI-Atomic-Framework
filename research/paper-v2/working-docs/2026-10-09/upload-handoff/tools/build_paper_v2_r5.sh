#!/usr/bin/env bash
# Phase-1 builder for research/paper-v2 generation r5 (copy-only from harness; never touches r1-r4 bundles or staging).
set -euo pipefail
H=/workspace/reports/atm-v2-harness
G4=/workspace/upload/r4-staging/research/paper-v2/generations/r4-2026-10-08
STAGE=/workspace/upload/r5-staging/research/paper-v2
G=$STAGE/generations/r5-2026-10-08
[ -e "$G" ] && { echo "refuse: $G exists"; exit 1; }
[ -f "$G4/SHA256SUMS" ] || { echo "missing sealed r4 staging"; exit 1; }
mkdir -p $G/{harness,docs/supporting,docs/related-audits,docs/r5-notes,paper,tables,summaries,raw} $STAGE/patches
cd $H
cp1(){ mkdir -p "$(dirname "$2")"; cp -L --preserve=mode "$1" "$2"; }
# harness
cp -rL --preserve=mode src test analysis tools fixture skills $G/harness/
for f in package.json .gitignore README.md reproduce.sh REPRODUCE.md; do cp1 $f $G/harness/$f; done
cp1 node_modules/.package-lock.json $G/harness/installed-deps.package-lock.json
SUMMAIN="e1-pilot e2-matrix e3-sweep e4-multiprocess e5-fault steward-writer baselines composer-probe b5-b8"
SUMSUP="cold-queue compare hot-file multiprocess scale v017 v017-q180"
for d in $SUMMAIN $SUMSUP probe-cold r2-e4-forensics r3-validation r4-validation r5-validation; do
  find runs/$d -maxdepth 1 \( -type f -o -type l \) \( -name '*.sh' -o -name '*.mjs' -o -name '*.mts' -o -name '*.py' \) -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/harness/$f"; done
done
# r4 -> r5 harness patch (relative to the sealed r4 harness copy)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p $T/r4 $T/r5/runs
cp -r $G4/harness/{src,test,analysis,tools,reproduce.sh,REPRODUCE.md,runs} $T/r4/
cp -r $G/harness/{src,test,analysis,tools,reproduce.sh,REPRODUCE.md} $T/r5/; cp -r $G/harness/runs/. $T/r5/runs/
( cd $T && diff -ruN r4 r5 ) > $G/harness/R5_CHANGES.patch || true
# summaries: r1 stage summaries, r2 forensics, r3/r4 validation (unchanged copies), r5 validation (excl. stdout) + canonical r5 analysis
for d in $SUMMAIN $SUMSUP r2-e4-forensics; do
  find runs/$d \( -type f -o -type l \) ! -name '*.sh' ! -name '*.mjs' ! -name '*.mts' ! -name '*.py' -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
done
for d in r3-validation r4-validation r5-validation; do
  find runs/$d \( -type f -o -type l \) ! -path '*/stdout/*' ! -name '*.sh' ! -name '*.mjs' ! -name '*.py' -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
done
find runs/r5-validation/forensics -type f -print0 | while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
find runs/r5-analysis/r5-2026-10-08 -type f -print0 | while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
# docs (same set as r4)
for f in VERSION_ANCHORS.md METRIC_DEFINITIONS.md ARTIFACT_PACK_SPEC.md EXPERIMENT_CHECKLIST.md \
  COMPOSER_STEWARD_IMPL_PLAN.md COMPOSER_STEWARD_PAPER_PIVOT.md ATM_PAPER_V2_FEASIBILITY_REVIEW.md ATM_PAPER_V2_FEASIBILITY_REVIEW.docx \
  ATM_PAPER_V2_REVIEW_ABSORB_NOTES.md ATTACHED_PAPER_EXTRACT.md T6_R1_DENOMINATOR_AUDIT.md PAPER_V2_DRAFT_PACK.md PAPER_V2_DRAFT_PACK_INDEX.md \
  PAPER_V2_EXPERIMENT_NOTES.md PAPER_V2_KEY_TABLES.md REMAINING_TESTS.md FUNCTIONAL_SPEC.md PLAN_SPEC.md; do cp1 $f $G/docs/$f; done
for f in COLD_QUEUE_LATENCY.md COMPARE_LATENCY.md COMPARE_SMALL.md HOT_FILE_LATENCY.md MULTIPROCESS_SMALL.md SCALE_PRELUDE.md \
  V017_HOT_COLD.md SMOKE_RESULT.md HEAT_WEIGHT_OPTIMIZATION.md *.log; do cp1 $f $G/docs/supporting/$f; done
for f in ATOM_BEHAVIOR_POLICE_SURVEY.md ATOM_CREATE_MAP_REUSE_AUDIT.md BROKER_HARD_GATE_AUDIT.md VAI_COMMIT_ATLAS_PLAN.md VIRTUAL_ATOM_INDEX_ANALYSIS.md; do cp1 $f $G/docs/related-audits/$f; done
for f in ATM_PAPER_V2_DRAFT_zh.md ATM_PAPER_V2_DRAFT_zh_pre_review.md ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md; do cp1 $f $G/paper/$f; done
cp -L --preserve=mode tables/* $G/tables/
# r5 notes: full r4->r5 text diff of paper/tables/docs
mkdir -p $T/t4 $T/t5
cp -r $G4/paper $G4/tables $T/t4/; cp $G4/docs/*.md $T/t4/
cp -r $G/paper $G/tables $T/t5/; cp $G/docs/*.md $T/t5/
( cd $T && diff -ruN t4 t5 ) > $G/docs/r5-notes/TEXT_CHANGES_r4_to_r5.diff || true
# raw (deterministic; r1-r4 raw referenced by sha in PRIOR_REFERENCES.md, not re-packed)
detar(){ out=$1; shift; tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -cf - "$@" | gzip -n -9 > "$G/raw/$out"; }
detar r5-replay-main.tgz $(ls -d runs/r5v-* | grep -E -- '-(old|fix|opt|q|nq)-r[0-9]+$')
detar r5-replay-recompose-ablation.tgz $(ls -d runs/r5v-* | grep -E -- '-(qr0|qr1|nqref|nqr0|nqr1)-r[0-9]+$')
detar r5-matrix.tgz $(ls -d runs/r5m-*)
detar r5-regression.tgz $(ls -d runs/r5r-*)
detar r5-e5.tgz $(ls -d runs/r5e-*)
detar r5-stdout.tgz runs/r5-validation/stdout
echo PHASE1_OK

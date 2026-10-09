#!/usr/bin/env bash
# Phase-1 builder for research/paper-v2 generation r2 (copy-only from harness; never touches r1 bundle).
set -euo pipefail
H=/workspace/reports/atm-v2-harness
R1=/workspace/upload/paper-v2/generations/r1-reviewed-2026-10-07
STAGE=/workspace/upload/r2-staging/research/paper-v2
G=$STAGE/generations/r2-2026-10-08
[ -e "$G" ] && { echo "refuse: $G exists"; exit 1; }
mkdir -p $G/{harness,docs/supporting,docs/related-audits,paper,tables,summaries,raw} $STAGE/patches
cd $H
cp1(){ mkdir -p "$(dirname "$2")"; cp -L --preserve=mode "$1" "$2"; }
# harness
cp -rL --preserve=mode src test analysis tools fixture skills $G/harness/
for f in package.json .gitignore README.md reproduce.sh REPRODUCE.md; do cp1 $f $G/harness/$f; done
cp1 node_modules/.package-lock.json $G/harness/installed-deps.package-lock.json
SUMMAIN="e1-pilot e2-matrix e3-sweep e4-multiprocess e5-fault steward-writer baselines composer-probe b5-b8"
SUMSUP="cold-queue compare hot-file multiprocess scale v017 v017-q180"
for d in $SUMMAIN $SUMSUP probe-cold r2-e4-forensics; do
  find runs/$d -maxdepth 1 \( -type f -o -type l \) \( -name '*.sh' -o -name '*.mjs' -o -name '*.mts' -o -name '*.py' \) -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/harness/$f"; done
done
# r1 -> r2 harness patch (code + reproduce + new tooling)
( cd /workspace/upload && diff -ruN --label r1 --label r2 /dev/null /dev/null >/dev/null 2>&1; true )
( diff -ruN "$R1/harness/src" "$H/src"; diff -uN "$R1/harness/reproduce.sh" "$H/reproduce.sh"; diff -uN "$R1/harness/REPRODUCE.md" "$H/REPRODUCE.md";
  for d in test analysis tools; do diff -ruN /dev/null "$H/$d" 2>/dev/null || diff -ruN "$(mktemp -d)" "$H/$d"; done ) \
  | sed -e "s|$R1/harness/|r1/|g" -e "s|$H/|r2/|g" > $G/harness/R2_CHANGES.patch || true
# summaries: r1 stage summaries (unchanged copies, original paths) + r2 outputs
for d in $SUMMAIN $SUMSUP r2-e4-forensics; do
  find runs/$d \( -type f -o -type l \) ! -name '*.sh' ! -name '*.mjs' ! -name '*.mts' ! -name '*.py' -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
done
find runs/r2-analysis/r2-2026-10-08 -type f -print0 | while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
# docs (r1 legacy checksums.sha256 / artifact_manifest.json intentionally NOT carried: superseded by SHA256SUMS + MANIFEST.json)
for f in VERSION_ANCHORS.md METRIC_DEFINITIONS.md ARTIFACT_PACK_SPEC.md EXPERIMENT_CHECKLIST.md \
  COMPOSER_STEWARD_IMPL_PLAN.md COMPOSER_STEWARD_PAPER_PIVOT.md ATM_PAPER_V2_FEASIBILITY_REVIEW.md ATM_PAPER_V2_FEASIBILITY_REVIEW.docx \
  ATM_PAPER_V2_REVIEW_ABSORB_NOTES.md ATTACHED_PAPER_EXTRACT.md T6_R1_DENOMINATOR_AUDIT.md PAPER_V2_DRAFT_PACK.md PAPER_V2_DRAFT_PACK_INDEX.md \
  PAPER_V2_EXPERIMENT_NOTES.md PAPER_V2_KEY_TABLES.md REMAINING_TESTS.md FUNCTIONAL_SPEC.md PLAN_SPEC.md; do cp1 $f $G/docs/$f; done
for f in COLD_QUEUE_LATENCY.md COMPARE_LATENCY.md COMPARE_SMALL.md HOT_FILE_LATENCY.md MULTIPROCESS_SMALL.md SCALE_PRELUDE.md \
  V017_HOT_COLD.md SMOKE_RESULT.md HEAT_WEIGHT_OPTIMIZATION.md *.log; do cp1 $f $G/docs/supporting/$f; done
for f in ATOM_BEHAVIOR_POLICE_SURVEY.md ATOM_CREATE_MAP_REUSE_AUDIT.md BROKER_HARD_GATE_AUDIT.md VAI_COMMIT_ATLAS_PLAN.md VIRTUAL_ATOM_INDEX_ANALYSIS.md; do cp1 $f $G/docs/related-audits/$f; done
for f in ATM_PAPER_V2_DRAFT_zh.md ATM_PAPER_V2_DRAFT_zh_pre_review.md ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md; do cp1 $f $G/paper/$f; done
cp -L --preserve=mode tables/* $G/tables/
# raw (deterministic)
detar(){ out=$1; shift; tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -cf - "$@" | gzip -n -9 > "$G/raw/$out"; }
detar r2-e4-forensics.tgz $(ls -d runs/r2f-*)
detar r2-smoke.tgz $(ls -d runs/r2-smoke-*)
echo PHASE1_OK

#!/usr/bin/env bash
# Phase-1 builder for research/paper-v2 generation r1 (copy-only; never writes into the harness).
set -euo pipefail
H=/workspace/reports/atm-v2-harness
OUT=/workspace/upload/paper-v2
G=$OUT/generations/r1-reviewed-2026-10-07
ATT=/home/box/agent-data/agents/88026b5a-28b0-48f7-ab70-17d1be6781aa/attachments/64288fe57a77bef5f98c4125f9ebf376f0da110f68ec266132f84784cff82353.txt
REVIEW_SHA=c9a98cc843528e9b3cd406cacc79c7fef71531a1f404da9bde48683e72ca8fab
[ -e "$G" ] && { echo "refuse: $G exists (generations are immutable)"; exit 1; }
mkdir -p $G/{harness,docs/supporting,docs/related-audits,paper,tables,summaries,raw,review}
cd $H
cp1(){ mkdir -p "$(dirname "$2")"; cp -L --preserve=mode "$1" "$2"; }

# ---- harness
cp -rL --preserve=mode src fixture skills $G/harness/
for f in package.json .gitignore README.md reproduce.sh REPRODUCE.md; do cp1 $f $G/harness/$f; done
cp1 node_modules/.package-lock.json $G/harness/installed-deps.package-lock.json
SUMMAIN="e1-pilot e2-matrix e3-sweep e4-multiprocess e5-fault steward-writer baselines composer-probe b5-b8"
SUMSUP="cold-queue compare hot-file multiprocess scale v017 v017-q180"
for d in $SUMMAIN $SUMSUP probe-cold; do
  find runs/$d -maxdepth 1 \( -type f -o -type l \) \( -name '*.sh' -o -name '*.mjs' -o -name '*.mts' -o -name '*.py' \) -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/harness/$f"; done
done
# ---- summaries (non-script files at original relative paths)
for d in $SUMMAIN $SUMSUP; do
  find runs/$d \( -type f -o -type l \) ! -name '*.sh' ! -name '*.mjs' ! -name '*.mts' ! -name '*.py' -print0 |
    while IFS= read -r -d '' f; do cp1 "$f" "$G/summaries/$f"; done
done
# ---- docs
for f in VERSION_ANCHORS.md METRIC_DEFINITIONS.md ARTIFACT_PACK_SPEC.md EXPERIMENT_CHECKLIST.md artifact_manifest.json checksums.sha256 \
  COMPOSER_STEWARD_IMPL_PLAN.md COMPOSER_STEWARD_PAPER_PIVOT.md ATM_PAPER_V2_FEASIBILITY_REVIEW.md ATM_PAPER_V2_FEASIBILITY_REVIEW.docx \
  ATM_PAPER_V2_REVIEW_ABSORB_NOTES.md ATTACHED_PAPER_EXTRACT.md T6_R1_DENOMINATOR_AUDIT.md PAPER_V2_DRAFT_PACK.md PAPER_V2_DRAFT_PACK_INDEX.md \
  PAPER_V2_EXPERIMENT_NOTES.md PAPER_V2_KEY_TABLES.md REMAINING_TESTS.md FUNCTIONAL_SPEC.md PLAN_SPEC.md; do cp1 $f $G/docs/$f; done
for f in COLD_QUEUE_LATENCY.md COMPARE_LATENCY.md COMPARE_SMALL.md HOT_FILE_LATENCY.md MULTIPROCESS_SMALL.md SCALE_PRELUDE.md \
  V017_HOT_COLD.md SMOKE_RESULT.md HEAT_WEIGHT_OPTIMIZATION.md *.log; do cp1 $f $G/docs/supporting/$f; done
for f in ATOM_BEHAVIOR_POLICE_SURVEY.md ATOM_CREATE_MAP_REUSE_AUDIT.md BROKER_HARD_GATE_AUDIT.md VAI_COMMIT_ATLAS_PLAN.md VIRTUAL_ATOM_INDEX_ANALYSIS.md; do
  cp1 $f $G/docs/related-audits/$f; done
# ---- paper / tables
for f in ATM_PAPER_V2_DRAFT_zh.md ATM_PAPER_V2_DRAFT_zh_pre_review.md ATM_PAPER_V2_DRAFT_zh_hotcold_archive.md; do cp1 $f $G/paper/$f; done
cp -L --preserve=mode tables/* $G/tables/
# ---- raw (deterministic tar + gzip -n), paths stored as runs/<cell>/...
detar(){ out=$1; shift; tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -cf - "$@" | gzip -n -9 > "$G/raw/$out"; }
pick(){ ls -d runs/$1 | grep -v -x -E "$2" ; }
detar e1.tgz $(pick 'e1-*' 'runs/e1-pilot')
detar e2.tgz $(pick 'e2-*' 'runs/e2-matrix')
detar e3.tgz $(pick 'e3-*' 'runs/e3-sweep')
detar e4.tgz $(pick 'e4-*' 'runs/e4-multiprocess')
detar e5.tgz $(pick 'e5-*' 'runs/e5-fault')
detar c.tgz $(ls -d runs/c4-*)
detar d.tgz $(ls -d runs/d[1-5]-*)
detar b-probes.tgz runs/composer-probe runs/b5-b8
detar steward.tgz $(pick 'steward-*' 'runs/steward-writer')
detar gaps.tgz $(ls -d runs/gaps-*)
# ---- review
echo "$REVIEW_SHA  review-pack.tgz" | sha256sum -c -
cp1 review-pack.tgz $G/review/review-pack.tgz
cp1 REVIEW_PACK_FOR_EXTERNAL_AI.md $G/review/REVIEW_PACK_FOR_EXTERNAL_AI.md
cp1 "$ATT" $G/review/EXTERNAL_REVIEW_2026-10-07.md
chmod 0644 $G/review/EXTERNAL_REVIEW_2026-10-07.md
( cd $G/review && echo "$REVIEW_SHA  review-pack.tgz" | sha256sum -c - )
# ---- box-only supporting raw (NOT uploaded)
mkdir -p /workspace/upload/box-only
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu -cf - \
  $(ls -d runs/cq-* runs/cq1-* runs/hf-* runs/v017-* runs/mp-* runs/sc-* runs/small-* runs/unpaced-* runs/smoke-* runs/probe-* | grep -v -x -E 'runs/(v017|v017-q180)') \
  | gzip -n -9 > /workspace/upload/box-only/support-raw-r1.tgz
echo PHASE1_OK

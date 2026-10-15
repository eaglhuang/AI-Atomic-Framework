#!/bin/bash
# Archive one smoke run. This does not claim a result or a win.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
load_state

PUBLISH=0
INDEX_EXPLICIT=0
# kit -> prereg-v3-smoke -> paper-v2/EVIDENCE_INDEX.md
INDEX_FILE="$HERE/../../EVIDENCE_INDEX.md"
while [ $# -gt 0 ]; do
  case "$1" in
    --publish-index) PUBLISH=1; shift ;;
    --index-file) INDEX_FILE="$2"; INDEX_EXPLICIT=1; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    *) die "unknown seal argument $1" ;;
  esac
done

DATE_STAMP="$(date -u +%Y-%m-%d)"
SUFFIX="codex"
if [ "${PREREG_SMOKE_MODE:-django}" = "fixture" ] || [ -n "${PREREG_SMOKE_CODEX:-}" ]; then
  SUFFIX="codex-stub"
fi
DEST="${DEST:-$HERE/../${DATE_STAMP}-${SUFFIX}}"
if [ -e "$DEST" ]; then
  die "archive already exists: $DEST"
fi
mkdir -p "$DEST/logs" "$DEST/diffs"

[ -f "$STATE_ROOT/results.json" ] || die "missing results.json. Run evaluate.sh first."
cp "$STATE_ROOT/results.json" "$DEST/results.json"
cp "$STATE_ROOT/setup-tests.log" "$DEST/logs/setup-tests.log" 2>/dev/null || true
cp "$HERE/tasks.json" "$DEST/tasks.json"
cp "$HERE/RUNBOOK.md" "$DEST/RUNBOOK.md"
for arm in a b; do
  if [ -d "$STATE_ROOT/arm-$arm" ]; then
    mkdir -p "$DEST/logs/arm-$arm" "$DEST/diffs"
    cp -a "$STATE_ROOT/arm-$arm/session-1" "$STATE_ROOT/arm-$arm/session-2" "$DEST/logs/arm-$arm/" 2>/dev/null || true
    cp "$STATE_ROOT/arm-$arm/meta.txt" "$STATE_ROOT/arm-$arm/model.txt" "$DEST/logs/arm-$arm/" 2>/dev/null || true
    [ -f "$STATE_ROOT/arm-$arm/final.diff" ] && cp "$STATE_ROOT/arm-$arm/final.diff" "$DEST/diffs/arm-$arm.diff"
    [ -f "$STATE_ROOT/arm-$arm/git-log.txt" ] && cp "$STATE_ROOT/arm-$arm/git-log.txt" "$DEST/diffs/arm-$arm.git-log.txt"
    if [ -f "$STATE_ROOT/arm-$arm/work/.prereg-smoke/steward-writes.jsonl" ]; then
      cp "$STATE_ROOT/arm-$arm/work/.prereg-smoke/steward-writes.jsonl" "$DEST/logs/arm-$arm/steward-writes.jsonl"
    fi
  fi
done

MODEL="unrecorded"
[ -f "$STATE_ROOT/arm-a/model.txt" ] && MODEL="$(cat "$STATE_ROOT/arm-a/model.txt")"
cat > "$DEST/README.md" <<EOF
# prereg-v3 smoke archive

Label: **smoke / exploratory, not results**. No win claim.

- Date (UTC): ${DATE_STAMP}
- Mode: ${PREREG_SMOKE_MODE:-django}
- Agent: ${SUFFIX}
- Model recorded: ${MODEL}
- Common base: ${COMMON_BASE}
- Tasks: \`tasks.json\` (primary pair is the only pair whose official gold patches both \`git apply --check\` on this base)
- Results: \`results.json\`

This directory is produced by \`kit/seal.sh\`. It is not a paper result.
EOF

(
  cd "$DEST"
  find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort | while read -r file; do
    sha256sum "$file"
  done > SHA256SUMS
)

ROW="| \`prereg-v3-smoke/${DATE_STAMP}-${SUFFIX}/\` | smoke / exploratory, not results | no win claim | mode=${PREREG_SMOKE_MODE:-django}; model=${MODEL}; base=${COMMON_BASE} |"
printf '%s\n' "$ROW" > "$DEST/EVIDENCE_INDEX_ROW.md"
if [ "$PUBLISH" -eq 1 ]; then
  if [ "$INDEX_EXPLICIT" -eq 0 ] && [ ! -f "$INDEX_FILE" ]; then
    die "evidence index not found: $INDEX_FILE"
  fi
  if ! grep -q "prereg-v3-smoke/${DATE_STAMP}-${SUFFIX}" "$INDEX_FILE" 2>/dev/null; then
    mkdir -p "$(dirname "$INDEX_FILE")"
    {
      echo
      echo "## prereg-v3 smoke ${DATE_STAMP}-${SUFFIX}"
      echo
      echo "> **smoke / exploratory, not results.** No win claim. Produced by \`kit/seal.sh --publish-index\`."
      echo
      echo "| Path | Label | Claim | Notes |"
      echo "|---|---|---|---|"
      echo "$ROW"
    } >> "$INDEX_FILE"
  fi
fi

echo "sealed $DEST"
echo "row: $ROW"

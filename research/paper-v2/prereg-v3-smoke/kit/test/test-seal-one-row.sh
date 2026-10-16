#!/bin/bash
# --publish-index 只能追加一列，不能為每次執行另開小節。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
STATE="$BASE/state"
mkdir -p "$STATE"
cat > "$STATE/env.sh" <<EOF
export COMMON_BASE=abc123
export PREREG_SMOKE_MODE=fixture
export KIT_ROOT=${HERE}
export TASKS_JSON=${HERE}/tasks.json
export PREREG_PYTHON=python3
EOF
printf '%s\n' '{"status":"ok"}' > "$STATE/results.json"
INDEX="$BASE/index.md"
printf '%s\n' 'existing index line' > "$INDEX"
export PREREG_SMOKE_STATE="$STATE"
export PREREG_SMOKE_CODEX="$HERE/bin/stub-codex.mjs"
before="$(wc -l < "$INDEX")"
bash "$HERE/seal.sh" --index-file "$INDEX" --dest "$BASE/seal-1" --publish-index >/dev/null
after="$(wc -l < "$INDEX")"
[ "$after" -eq $((before + 1)) ]
if grep -q '## prereg-v3 smoke' "$INDEX"; then
  echo "seal opened a new evidence section" >&2
  exit 1
fi
grep -q 'prereg-v3-smoke/' "$INDEX"
grep -q 'existing index line' "$INDEX"
added="$(tail -n 1 "$INDEX")"
case "$added" in
  '| `prereg-v3-smoke/'*) ;;
  *) echo "added line is not one index row: $added" >&2; exit 1 ;;
esac
bash "$HERE/seal.sh" --index-file "$INDEX" --dest "$BASE/seal-2" --publish-index >/dev/null
again="$(wc -l < "$INDEX")"
[ "$again" -eq "$after" ]
echo "seal one row ok"

#!/bin/bash
# --publish-index 必須用 dest 目錄，而且只追加一列。舊的日期路徑不能再被印出來。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

ROOT="$BASE/state"
mkdir -p "$ROOT/arm-a/session-1" "$ROOT/arm-b/session-1"
cat > "$ROOT/env.sh" <<'EOF'
export COMMON_BASE=abc123
export PREREG_SMOKE_MODE=django
EOF
printf '%s\n' '{"status":"ok"}' > "$ROOT/results.json"
printf 'prompt\n' > "$ROOT/arm-a/session-1/prompt.txt"
printf 'alpha\n' > "$ROOT/arm-a/session-1/stdout.jsonl"
printf 'gpt-6-luna\n' > "$ROOT/arm-a/model.txt"

INDEX="$BASE/EVIDENCE_INDEX.md"
cat > "$INDEX" <<'EOF'
# index
| `prereg-v3-smoke/2026-10-16-codex/` | smoke / exploratory, not results — INVALID/superseded (kit-error) | no win claim | mode=django |
EOF
before="$(wc -l < "$INDEX")"
export PREREG_SMOKE_STATE="$ROOT"
export PREREG_SMOKE_MODE=django
unset PREREG_SMOKE_CODEX || true
DEST="$BASE/out/2026-10-17-codex-v2"
bash "$HERE/seal.sh" --index-file "$INDEX" --dest "$DEST" --publish-index >"$BASE/seal.out"
after="$(wc -l < "$INDEX")"
if [ "$((after - before))" -ne 1 ]; then
  echo "publish-index added $((after - before)) lines, want 1" >&2
  cat "$INDEX" >&2
  exit 1
fi
grep -q 'prereg-v3-smoke/2026-10-17-codex-v2/' "$BASE/seal.out"
grep -q 'prereg-v3-smoke/2026-10-17-codex-v2/' "$DEST/EVIDENCE_INDEX_ROW.md"
grep -q 'prereg-v3-smoke/2026-10-17-codex-v2/' "$INDEX"
if grep -q 'row: .*2026-10-16-codex/' "$BASE/seal.out"; then
  echo "seal printed the old archive path" >&2
  cat "$BASE/seal.out" >&2
  exit 1
fi
old_rows="$(grep -c 'prereg-v3-smoke/2026-10-16-codex/' "$INDEX")"
new_rows="$(grep -c 'prereg-v3-smoke/2026-10-17-codex-v2/' "$INDEX")"
[ "$old_rows" -eq 1 ]
[ "$new_rows" -eq 1 ]
echo "seal index path ok"

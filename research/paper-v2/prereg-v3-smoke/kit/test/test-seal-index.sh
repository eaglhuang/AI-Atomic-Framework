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
new_line="$(grep 'prereg-v3-smoke/2026-10-17-codex-v2/' "$INDEX")"
case "$new_line" in
  *INVALID*) echo "ok results were marked INVALID: $new_line" >&2; exit 1 ;;
esac

printf '%s\n' '{"status":"invalid","arms":{"A":{"tests":[{"kitError":"test-patch-not-applied"}]},"B":{"tests":[{"kitError":"tests-unobserved"}]}}}' > "$ROOT/results.json"
DEST2="$BASE/out/2026-10-17-codex-v3"
bash "$HERE/seal.sh" --index-file "$INDEX" --dest "$DEST2" --publish-index >"$BASE/seal-invalid.out"
after2="$(wc -l < "$INDEX")"
if [ "$((after2 - after))" -ne 1 ]; then
  echo "invalid publish-index added $((after2 - after)) lines, want 1" >&2
  cat "$INDEX" >&2
  exit 1
fi
invalid_line="$(grep 'prereg-v3-smoke/2026-10-17-codex-v3/' "$INDEX")"
case "$invalid_line" in
  *INVALID*) ;;
  *) echo "invalid results were not marked INVALID: $invalid_line" >&2; exit 1 ;;
esac
case "$invalid_line" in
  *test-patch-not-applied*) ;;
  *) echo "invalid row omitted kit-error: $invalid_line" >&2; exit 1 ;;
esac
grep -q 'INVALID' "$DEST2/EVIDENCE_INDEX_ROW.md"
[ "$(grep -c 'prereg-v3-smoke/2026-10-17-codex-v3/' "$INDEX")" -eq 1 ]

printf '%s\n' '{"status":"blocked","arms":{"A":{"status":"ok","tests":[]},"B":{"status":"blocked","tests":[]}}}' > "$ROOT/results.json"
DEST3="$BASE/out/2026-10-17-codex-v6"
bash "$HERE/seal.sh" --index-file "$INDEX" --dest "$DEST3" --publish-index >"$BASE/seal-blocked.out"
blocked_line="$(grep 'prereg-v3-smoke/2026-10-17-codex-v6/' "$INDEX")"
case "$blocked_line" in
  *blocked*) ;;
  *) echo "blocked results did not name the block: $blocked_line" >&2; exit 1 ;;
esac
case "$blocked_line" in
  *"arm B"*) ;;
  *) echo "blocked row omitted the blocked arm: $blocked_line" >&2; exit 1 ;;
esac
case "$blocked_line" in
  *INVALID*) echo "blocked results were marked INVALID: $blocked_line" >&2; exit 1 ;;
esac
grep -q 'arm B' "$DEST3/EVIDENCE_INDEX_ROW.md"
echo "seal index path ok"

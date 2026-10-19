#!/bin/bash
# #361: a malformed patch is the model's error. atm-write must not crash, must not
# call the CLI, and must record rejected-by-design / patch-malformed (exit 3) with
# the file and HEAD unchanged. Covers no hunk header (A2), an unprefixed body line
# (A1), a multi-file patch (A3), a wrong target file and a header-count mismatch (A5).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

REPO="$BASE/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
printf 'l1\nl2\nl3\nl4\nl5\nl6\n' > "$REPO/loader.py"
git -C "$REPO" add loader.py
git -C "$REPO" -c user.name=prereg -c user.email=prereg@localhost commit -q -m base

export PREREG_BOUNDARY=codex-sandbox
write_session_write_config "$REPO"

printf '%s\n' '@@ -2,1 +2,1@@' '-l2' '+L2' > "$BASE/a2.diff"
printf '%s\n' '@@ -2,3 +2,3 @@' ' l2' '-l3' '+L3' 'l4 (no leading space)' '-l5' '+L5' > "$BASE/a1.diff"
printf '%s\n' 'diff --git a/loader.py b/loader.py' '--- a/loader.py' '+++ b/loader.py' '@@ -1 +1 @@' '-l1' '+A1' \
  'diff --git a/other.py b/other.py' '--- a/other.py' '+++ b/other.py' '@@ -5 +5 @@' '-l5' '+B5' > "$BASE/a3.diff"
printf '%s\n' '--- a/other.py' '+++ b/other.py' '@@ -1 +1 @@' '-l1' '+A1' > "$BASE/target.diff"
printf '%s\n' '@@ -2,3 +2,3 @@' '-l2' '+L2' > "$BASE/a5.diff"
printf 'this is prose, not a diff\n' > "$BASE/prose.diff"

before_head="$(git -C "$REPO" rev-parse HEAD)"
attempt=0
for name in a2 a1 a3 target a5 prose; do
  attempt=$((attempt + 1))
  set +e
  node "$HERE/bin/atm-write.mjs" loader.py "$BASE/$name.diff" --cwd "$REPO" --actor prereg-session --task prereg --attempt "$attempt" >"$BASE/$name.json" 2>"$BASE/$name.err"
  status=$?
  set -e
  python3 - "$BASE/$name.json" "$status" "$name" "$REPO/loader.py" <<'PY'
import json, pathlib, sys
raw = open(sys.argv[1], encoding="utf-8").read()
status, name = int(sys.argv[2]), sys.argv[3]
row = json.loads(raw)
assert status == 3, (name, status, raw)
assert row["decision"] == "rejected-by-design", (name, row)
assert row["reasonCode"] == "patch-malformed", (name, row)
assert row["terminal"] == "blocked", (name, row)
assert row["stopReason"], (name, row)
assert row["currentFileText"] == "l1\nl2\nl3\nl4\nl5\nl6\n", (name, row)
assert pathlib.Path(sys.argv[4]).read_text(encoding="utf-8") == "l1\nl2\nl3\nl4\nl5\nl6\n", name
PY
done
[ "$(git -C "$REPO" rev-parse HEAD)" = "$before_head" ] || { echo "malformed patch moved HEAD" >&2; exit 1; }
rows="$(wc -l < "$REPO/.prereg-smoke/steward-writes.jsonl")"
[ "$rows" -eq 6 ] || { echo "expected 6 steward-writes rows, got $rows" >&2; exit 1; }
if ls "$REPO/.prereg-smoke/inbox" 2>/dev/null | grep -q .; then
  echo "malformed patch reached the CLI inbox" >&2
  exit 1
fi
echo "atm-write malformed ok"

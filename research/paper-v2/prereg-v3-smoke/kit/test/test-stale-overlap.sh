#!/bin/bash
# 沒有 --base-file 時，對得上已提交 base 且行重疊的 patch 必須是 overlapping-write-queued。
# 對不上任何版本的 hunk 仍是 patch-context-mismatch。
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
printf 'alpha\nbeta\ngamma\n' > "$REPO/loader.py"
git -C "$REPO" add loader.py
git -C "$REPO" -c user.name=prereg -c user.email=prereg@localhost commit -q -m base

export PREREG_BOUNDARY=codex-sandbox
write_session_write_config "$REPO"

write_patch() {
  local dest="$1"
  local before="$2"
  local after="$3"
  cat > "$dest" <<EOF
diff --git a/loader.py b/loader.py
--- a/loader.py
+++ b/loader.py
@@ -2,1 +2,1 @@
-${before}
+${after}
EOF
}

submit() {
  local patch="$1"
  local attempt="$2"
  local out="$3"
  set +e
  node "$HERE/bin/atm-write.mjs" loader.py "$patch" --cwd "$REPO" --actor prereg-session --task prereg --attempt "$attempt" >"$out"
  local status=$?
  set -e
  printf '%s\n' "$status"
}

write_patch "$BASE/first.diff" beta beta-one
first_status="$(submit "$BASE/first.diff" 1 "$BASE/first.json")"
python3 - "$BASE/first.json" "$first_status" <<'PY'
import json, sys
row = json.loads(open(sys.argv[1], encoding="utf-8").read())
status = int(sys.argv[2])
assert status == 0, (status, row)
assert row["decision"] == "accepted", row
assert row["reasonCode"] is None, row
PY

write_patch "$BASE/overlap.diff" beta beta-two
overlap_status="$(submit "$BASE/overlap.diff" 2 "$BASE/overlap.json")"
python3 - "$BASE/overlap.json" "$overlap_status" "$REPO/loader.py" <<'PY'
import json, pathlib, sys
row = json.loads(open(sys.argv[1], encoding="utf-8").read())
status = int(sys.argv[2])
text = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert status == 3, (status, row)
assert row["reasonCode"] == "overlapping-write-queued", row
assert row["messageCode"] == "ATM_BROKER_LIVE_WRITE_QUEUED", row
assert "beta-one" in (row.get("currentFileText") or ""), row.get("currentFileText")
assert "beta-one" in text, text
assert row.get("declaredBaseHash") != row.get("currentFileHash"), row
PY

write_patch "$BASE/malformed.diff" "not-in-any-version" zzz
malformed_status="$(submit "$BASE/malformed.diff" 3 "$BASE/malformed.json")"
python3 - "$BASE/malformed.json" "$malformed_status" <<'PY'
import json, sys
row = json.loads(open(sys.argv[1], encoding="utf-8").read())
status = int(sys.argv[2])
assert status == 3, (status, row)
assert row["reasonCode"] == "patch-context-mismatch", row
assert row["messageCode"] != "ATM_BROKER_LIVE_WRITE_QUEUED", row
assert row["messageCode"] is None, row
assert row.get("declaredBaseHash") == row.get("currentFileHash"), row
PY

echo "stale overlap ok"

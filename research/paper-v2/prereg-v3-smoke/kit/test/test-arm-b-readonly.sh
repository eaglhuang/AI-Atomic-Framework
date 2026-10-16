#!/bin/bash
# session 不是工作樹擁有者。chmod、rename、直接寫入都必須失敗。
# 只有透過 steward socket 的 atm-write 可以改檔，而且改完檔案仍屬於 steward。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

if [ "$(uname -s)" != "Linux" ]; then
  grep -q 'read-only' "$HERE/lib/common.sh"
  grep -q 'PREREG_STEWARD_SOCK' "$HERE/lib/common.sh"
  echo "non-linux: 這台機器沒有 Unix 使用者邊界。Codex Arm B 使用 --sandbox read-only，steward 留在沙盒外。"
  exit 0
fi

CLI="$(require_public_cli)"
ensure_prereg_users
[ "$PREREG_BOUNDARY" = "unix-user" ]
ROOT="$(mktemp -d)"
cleanup() {
  release_worktree "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

printf 'alpha\nbeta\ngamma\n' > "$ROOT/shared.py"
git -C "$ROOT" init -q
git -C "$ROOT" add shared.py
git -C "$ROOT" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
mkdir -p "$ROOT/.prereg-smoke" "$ROOT/home"
NODE_BIN="$(dirname "$(command -v node)")"
python3 - "$ROOT/.prereg-smoke/session-write.json" "$ROOT" "$CLI" "$NODE_BIN" <<'PY'
import json, sys
dest, work, cli, node_bin = sys.argv[1:]
open(dest, "w", encoding="utf-8").write(json.dumps({
    "writableRoot": work,
    "cli": cli,
    "cliVersion": "0.1.20",
    "safePath": f"{node_bin}:/usr/bin:/bin",
    "composeWindowMs": 200,
    "boundary": "steward-owner",
}) + "\n")
PY
PATCH="$(mktemp)"
cat > "$PATCH" <<'EOF'
diff --git a/shared.py b/shared.py
--- a/shared.py
+++ b/shared.py
@@ -2,1 +2,1 @@
-beta
+beta-one
EOF
chmod a+r "$PATCH"

own_worktree "$ROOT"
LOG="$(mktemp)"
start_steward_daemon "$ROOT" "$LOG"
[ -S "${PREREG_STEWARD_SOCK}" ]

expect_fail() {
  local label="$1"
  shift
  set +e
  "$@" >/tmp/prereg-boundary-out 2>/tmp/prereg-boundary-err
  local status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "預期失敗但成功：${label}" >&2
    cat /tmp/prereg-boundary-err >&2 || true
    exit 1
  fi
  echo "blocked ${label} (exit ${status})"
}

# 直接寫入：shell 重新導向在 session 身份下打開檔案，必須被拒絕。
expect_fail direct-write as_root -u "$SESSION_USER" -- bash -c 'printf leaked >> "$1"' bash "$ROOT/shared.py"
expect_fail chmod as_root -u "$SESSION_USER" -- chmod u+w "$ROOT/shared.py"
expect_fail rename as_root -u "$SESSION_USER" -- mv "$ROOT/shared.py" "$ROOT/shared.py.moved"
expect_fail sudo as_root -u "$SESSION_USER" -- sudo -n true
[ -f "$ROOT/shared.py" ]
[ ! -e "$ROOT/shared.py.moved" ]
[ "$(stat -c %U "$ROOT/shared.py")" = "$STEWARD_USER" ]

as_root -u "$SESSION_USER" -- env -i \
  "PATH=${NODE_BIN}:${HERE}/bin:/usr/bin:/bin" \
  "HOME=/var/lib/${SESSION_USER}" \
  "TMPDIR=/tmp" \
  "PREREG_STEWARD_SOCK=${PREREG_STEWARD_SOCK}" \
  LANG=C.UTF-8 \
  "$HERE/bin/atm-write" shared.py "$PATCH" --actor session-b --task fixture-b --cwd "$ROOT"

grep -q 'beta-one' "$ROOT/shared.py"
[ "$(stat -c %U "$ROOT/shared.py")" = "$STEWARD_USER" ]
expect_fail direct-write-after as_root -u "$SESSION_USER" -- bash -c 'printf leaked >> "$1"' bash "$ROOT/shared.py"
expect_fail chmod-after as_root -u "$SESSION_USER" -- chmod u+w "$ROOT/shared.py"
python3 - "$ROOT/shared.py" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "beta-one" in text
assert "leaked" not in text
PY
echo "boundary verified on $(. /etc/os-release; printf '%s' "$PRETTY_NAME") $(uname -srm)"
echo "readonly steward ok"

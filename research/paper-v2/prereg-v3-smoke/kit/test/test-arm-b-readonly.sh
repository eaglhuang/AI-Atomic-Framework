#!/bin/bash
# Arm B 的寫入邊界必須是真的。
# 有免密碼 sudo 時，session 不是工作樹擁有者，chmod、rename、直接寫入都失敗，只有 steward socket 能改檔。
# 只要 Codex sandbox 或 bubblewrap 可用，就再跑一個真實的沙盒行程：直接寫入、chmod、mv、rm 失敗，steward 寫入成功。
# 沒有 sudo 而且沒有沙盒時，中止。不退回 chmod a-w。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

if [ "$(uname -s)" != "Linux" ]; then
  grep -q 'read-only' "$HERE/lib/common.sh"
  grep -q 'PREREG_STEWARD_SOCK' "$HERE/lib/common.sh"
  grep -q 'codex-landlock' "$HERE/lib/sandbox-boundary.sh"
  grep -q 'bwrap-ro' "$HERE/lib/sandbox-boundary.sh"
  echo "non-linux: 這台機器沒有 Unix 使用者邊界。Codex Arm B 使用 --sandbox read-only，steward 留在沙盒外。"
  exit 0
fi

UNIX_ROOT=""
SANDBOX_BASE=""
SANDBOX_REPO=""

cleanup() {
  if [ -n "${UNIX_ROOT:-}" ] && [ -d "$UNIX_ROOT" ]; then
    release_worktree "$UNIX_ROOT"
    rm -rf "$UNIX_ROOT"
  fi
  if [ -n "${SANDBOX_REPO:-}" ] && [ -d "$SANDBOX_REPO" ]; then
    release_worktree "$SANDBOX_REPO"
  fi
  if [ -n "${SANDBOX_BASE:-}" ] && [ -d "$SANDBOX_BASE" ]; then
    rm -rf "$SANDBOX_BASE"
  fi
}
trap cleanup EXIT

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

run_unix_user_probe() {
  [ "$PREREG_BOUNDARY" = "unix-user" ]
  UNIX_ROOT="$(mktemp -d)"
  local root="$UNIX_ROOT"
  printf 'alpha\nbeta\ngamma\n' > "$root/shared.py"
  git -C "$root" init -q
  git -C "$root" add shared.py
  git -C "$root" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
  mkdir -p "$root/.prereg-smoke" "$root/home"
  local node_bin patch log
  node_bin="$(dirname "$(command -v node)")"
  python3 - "$root/.prereg-smoke/session-write.json" "$root" "$CLI" "$node_bin" <<'PY'
import json, sys
dest, work, cli, node_bin = sys.argv[1:]
open(dest, "w", encoding="utf-8").write(json.dumps({
    "writableRoot": work,
    "cli": cli,
    "cliVersion": "0.1.21",
    "safePath": f"{node_bin}:/usr/bin:/bin",
    "composeWindowMs": 200,
    "boundary": "unix-user",
}) + "\n")
PY
  patch="$(mktemp)"
  cat > "$patch" <<'EOF'
diff --git a/shared.py b/shared.py
--- a/shared.py
+++ b/shared.py
@@ -2,1 +2,1 @@
-beta
+beta-one
EOF
  chmod a+r "$patch"
  own_worktree "$root"
  log="$(mktemp)"
  start_steward_daemon "$root" "$log"
  [ -S "${PREREG_STEWARD_SOCK}" ]

  expect_fail direct-write as_root -u "$SESSION_USER" -- bash -c 'printf leaked >> "$1"' bash "$root/shared.py"
  expect_fail chmod as_root -u "$SESSION_USER" -- chmod u+w "$root/shared.py"
  expect_fail rename as_root -u "$SESSION_USER" -- mv "$root/shared.py" "$root/shared.py.moved"
  expect_fail rm as_root -u "$SESSION_USER" -- rm -f "$root/shared.py"
  expect_fail sudo as_root -u "$SESSION_USER" -- sudo -n true
  local runtime
  for runtime in .agents .codex .aws; do
    [ "$(stat -c %U "$root/$runtime")" = "$SESSION_USER" ]
    [ "$(stat -c %a "$root/$runtime")" = "700" ]
  done
  [ "$(stat -c %U "$root/.git")" = "$STEWARD_USER" ]
  as_root -u "$SESSION_USER" -- bash -c 'printf ok > "$1/.agents/probe"' bash "$root"
  [ "$(as_root -u "$SESSION_USER" -- cat "$root/.agents/probe")" = "ok" ]
  expect_fail mv-agents as_root -u "$SESSION_USER" -- mv "$root/.agents" "$root/agents-moved"
  [ -d "$root/.agents" ]
  [ ! -e "$root/agents-moved" ]
  local status_out
  status_out="$(as_root -u "$STEWARD_USER" -- git -C "$root" -c safe.directory='*' status --porcelain --untracked-files=all)"
  if printf '%s\n' "$status_out" | grep -Eq '(^|[ /])\.(agents|codex|aws)(/|$)'; then
    echo "Codex runtime dirs leaked into git status" >&2
    printf '%s\n' "$status_out" >&2
    exit 1
  fi
  as_root -u "$STEWARD_USER" -- git -C "$root" -c safe.directory='*' diff --exit-code >/dev/null
  [ -f "$root/shared.py" ]
  [ ! -e "$root/shared.py.moved" ]
  [ "$(stat -c %U "$root/shared.py")" = "$STEWARD_USER" ]

  as_root -u "$SESSION_USER" -- env -i \
    "PATH=${node_bin}:${HERE}/bin:/usr/bin:/bin" \
    "HOME=/var/lib/${SESSION_USER}" \
    "TMPDIR=/tmp" \
    "PREREG_STEWARD_SOCK=${PREREG_STEWARD_SOCK}" \
    LANG=C.UTF-8 \
    "$HERE/bin/atm-write" shared.py "$patch" --actor session-b --task fixture-b --cwd "$root"

  grep -q 'beta-one' "$root/shared.py"
  [ "$(stat -c %U "$root/shared.py")" = "$STEWARD_USER" ]
  expect_fail direct-write-after as_root -u "$SESSION_USER" -- bash -c 'printf leaked >> "$1"' bash "$root/shared.py"
  expect_fail chmod-after as_root -u "$SESSION_USER" -- chmod u+w "$root/shared.py"
  python3 - "$root/shared.py" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "beta-one" in text
assert "leaked" not in text
PY
  echo "unix-user boundary verified on $(. /etc/os-release; printf '%s' "$PRETTY_NAME") $(uname -srm)"
  release_worktree "$root"
  rm -rf "$root"
  UNIX_ROOT=""
}

run_sandbox_probe() {
  sandbox_boundary_active
  case "${HOME:-}" in
    ""|/tmp|/tmp/*) die "沙盒探測需要一個不在 /tmp 裡的 HOME。" ;;
  esac
  SANDBOX_BASE="$(mktemp -d "${HOME}/prereg-nosudo-probe.XXXXXX")"
  case "$SANDBOX_BASE" in
    /tmp|/tmp/*) die "沙盒探測目錄落在 /tmp，Codex :workspace 會把它當成可寫根。" ;;
  esac
  local scratch="$SANDBOX_BASE/scratch"
  local session="$SANDBOX_BASE/session-1"
  SANDBOX_REPO="$SANDBOX_BASE/repo"
  mkdir -p "$scratch" "$session" "$SANDBOX_REPO"
  export PREREG_SANDBOX_SCRATCH="$scratch"
  export PREREG_SANDBOX_REPO="$SANDBOX_REPO"
  PREREG_SANDBOX_EXTRA_WRITES=("$session")
  printf 'alpha\nbeta\ngamma\n' > "$SANDBOX_REPO/shared.py"
  git -C "$SANDBOX_REPO" init -q
  git -C "$SANDBOX_REPO" add shared.py
  git -C "$SANDBOX_REPO" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
  mkdir -p "$SANDBOX_REPO/.prereg-smoke"
  local node_bin patch log
  node_bin="$(dirname "$(command -v node)")"
  python3 - "$SANDBOX_REPO/.prereg-smoke/session-write.json" "$SANDBOX_REPO" "$CLI" "$node_bin" "$PREREG_BOUNDARY" <<'PY'
import json, sys
dest, work, cli, node_bin, boundary = sys.argv[1:]
open(dest, "w", encoding="utf-8").write(json.dumps({
    "writableRoot": work,
    "cli": cli,
    "cliVersion": "0.1.21",
    "safePath": f"{node_bin}:/usr/bin:/bin",
    "composeWindowMs": 200,
    "boundary": boundary,
}) + "\n")
PY
  patch="$scratch/beta.patch"
  cat > "$patch" <<'EOF'
diff --git a/shared.py b/shared.py
--- a/shared.py
+++ b/shared.py
@@ -2,1 +2,1 @@
-beta
+beta-one
EOF
  export GIT_AUTHOR_NAME=prereg-smoke
  export GIT_AUTHOR_EMAIL=prereg-smoke@localhost
  export GIT_COMMITTER_NAME=prereg-smoke
  export GIT_COMMITTER_EMAIL=prereg-smoke@localhost
  log="$SANDBOX_BASE/steward.log"
  start_steward_daemon "$SANDBOX_REPO" "$log"
  [ -S "${PREREG_STEWARD_SOCK}" ]
  case "$PREREG_STEWARD_SOCK" in
    "$scratch"/*) ;;
    *) die "steward socket 不在 scratch：${PREREG_STEWARD_SOCK}" ;;
  esac

  local out="$scratch/probe-result.txt"
  local err="$scratch/probe.err"
  set +e
  run_sandboxed bash -c '
    set +e
    repo="$1"
    scratch="$2"
    session="$3"
    out="$4"
    : > "$out"
    printf leaked >> "$repo/shared.py"
    echo "write:$?" >> "$out"
    chmod u+w "$repo/shared.py"
    echo "chmod:$?" >> "$out"
    mv "$repo/shared.py" "$repo/shared.py.moved"
    echo "mv:$?" >> "$out"
    rm -f "$repo/shared.py"
    echo "rm:$?" >> "$out"
    mount -o remount,bind,rw "$repo" >/dev/null 2>&1
    echo "remount:$?" >> "$out"
    printf ok > "$scratch/note"
    echo "scratch:$?" >> "$out"
    printf ok > "$session/note"
    echo "session:$?" >> "$out"
    exit 0
  ' bash "$SANDBOX_REPO" "$scratch" "$session" "$out" >"$scratch/probe.out" 2>"$err"
  local status=$?
  set -e
  if grep -q 'bubblewrap is unavailable' "$err"; then
    echo "沙盒沒有真正啟動" >&2
    cat "$err" >&2
    exit 1
  fi
  if [ "$status" -ne 0 ] || [ ! -s "$out" ]; then
    echo "沙盒探測行程沒有跑完 (exit ${status})" >&2
    cat "$err" >&2 || true
    exit 1
  fi
  echo "sandbox probe ${PREREG_BOUNDARY}:"
  cat "$out"
  python3 - "$out" <<'PY'
import pathlib, sys
vals = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    key, value = line.split(":", 1)
    vals[key] = int(value)
for key in ("write", "chmod", "mv", "rm", "remount"):
    if vals.get(key, 0) == 0:
        raise SystemExit(f"{key} was not blocked")
if vals.get("scratch") != 0:
    raise SystemExit("scratch write failed")
if vals.get("session") != 0:
    raise SystemExit("session write failed")
PY
  [ -f "$SANDBOX_REPO/shared.py" ]
  [ ! -e "$SANDBOX_REPO/shared.py.moved" ]
  python3 - "$SANDBOX_REPO/shared.py" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert text == "alpha\nbeta\ngamma\n", text
assert "leaked" not in text
PY
  [ "$(cat "$scratch/note")" = "ok" ]
  [ "$(cat "$session/note")" = "ok" ]

  run_sandboxed env -i \
    "PATH=${node_bin}:${HERE}/bin:/usr/bin:/bin" \
    "HOME=${scratch}" \
    "TMPDIR=${scratch}" \
    "PREREG_STEWARD_SOCK=${PREREG_STEWARD_SOCK}" \
    LANG=C.UTF-8 \
    "$HERE/bin/atm-write" shared.py "$patch" --actor session-b --task fixture-b --cwd "$SANDBOX_REPO" \
    >"$scratch/atm-write.out" 2>"$scratch/atm-write.err"
  python3 - "$SANDBOX_REPO/shared.py" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "beta-one" in text, text
assert "leaked" not in text
PY
  echo "sandbox ${PREREG_BOUNDARY}: direct write, chmod, mv, rm blocked; steward write ok"
  release_worktree "$SANDBOX_REPO"
  rm -rf "$SANDBOX_BASE"
  SANDBOX_BASE=""
  SANDBOX_REPO=""
}

CLI="$(require_public_cli)"
ensure_prereg_users
SELECTED="$PREREG_BOUNDARY"

if [ "$SELECTED" = "unix-user" ]; then
  run_unix_user_probe
fi

unset PREREG_BOUNDARY
if resolve_linux_sandbox_mechanism; then
  echo "unprivileged mechanism=${PREREG_BOUNDARY}"
  run_sandbox_probe
elif [ "$SELECTED" = "unix-user" ]; then
  echo "sudo 可用，而且這台機器沒有 codex sandbox 或 bubblewrap。只驗證 unix-user。"
else
  die "Linux 上沒有免密碼 sudo，而且 Codex sandbox 與 bubblewrap 都不可用。拒絕未強制的模式。"
fi

echo "readonly steward ok"

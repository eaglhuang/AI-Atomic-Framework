#!/bin/bash
# 真實 Arm B 的 codex exec 必須走和探測相同的外層沙盒，而且審批被釘成 never。
# 模型加上 bypass、danger-full-access，或一份壞掉的 config，都不能把儲存庫改成可寫。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

if [ "$(uname -s)" != "Linux" ]; then
  grep -q 'approval_policy="never"' "$HERE/lib/common.sh"
  grep -q 'boundary_launch_args' "$HERE/lib/sandbox-boundary.sh"
  echo "non-linux: Arm B 仍用 --sandbox read-only，審批釘成 never。"
  exit 0
fi

unset PREREG_BOUNDARY
if [ -n "${PREREG_FORCE_BOUNDARY:-}" ]; then
  case "$PREREG_FORCE_BOUNDARY" in
    codex-landlock)
      codex_sandbox_ready || die "指定的 codex-landlock 起不來。"
      ;;
    bwrap-ro)
      bwrap_ready || die "指定的 bwrap-ro 起不來。"
      ;;
    *)
      die "不認識的 PREREG_FORCE_BOUNDARY=${PREREG_FORCE_BOUNDARY}"
      ;;
  esac
  PREREG_BOUNDARY="$PREREG_FORCE_BOUNDARY"
  export PREREG_BOUNDARY
elif ! resolve_linux_sandbox_mechanism; then
  if linux_sudo_ok; then
    echo "sudo 可用，而且沒有 codex sandbox 或 bubblewrap。這條檢查只覆蓋無 sudo 沙盒。"
    exit 0
  fi
  die "沒有沙盒機制，不能核對 codex exec 的命令列。"
fi

case "${HOME:-}" in
  ""|/tmp|/tmp/*) die "命令列檢查需要一個不在 /tmp 裡的 HOME。" ;;
esac
BASE="$(mktemp -d "${PREREG_TEMP_ROOT:-${HOME}}/prereg-exec-boundary.XXXXXX")"
REPO="$BASE/repo"
SCRATCH="$BASE/scratch"
SESSION="$BASE/session"
mkdir -p "$REPO" "$SCRATCH" "$SESSION/home/.codex" "$SESSION/tmp"
DAEMON_DIR="$(readlink -f /tmp)/codex-daemon-$(id -u)"
DAEMON_MODE_SAVED=""
if [ -d "$DAEMON_DIR" ] && [ "$(stat -c %u "$DAEMON_DIR")" = "$(id -u)" ]; then
  DAEMON_MODE_SAVED="$(stat -c %a "$DAEMON_DIR")"
  chmod 755 "$DAEMON_DIR"
fi
CODEX_HOME_A=""
CODEX_ROOT_A=""
printf 'seed\n' > "$REPO/shared.py"
cat > "$SESSION/home/.codex/config.toml" << 'EOF'
approval_policy = "not-a-policy"
sandbox_mode = "danger-full-access"
EOF
export PREREG_ARM=B
export PREREG_SANDBOX_SCRATCH="$SCRATCH"
export PREREG_SANDBOX_REPO="$REPO"
PREREG_SANDBOX_EXTRA_WRITES=("$SESSION")
cleanup() {
  if [ -n "${CODEX_HOME_A:-}" ]; then
    PREREG_SESSION_CODEX_ROOT="${CODEX_ROOT_A:-}" release_session_codex_home "$CODEX_HOME_A" || true
  fi
  if [ -n "${PREREG_SESSION_CODEX_HOME:-}" ]; then
    release_session_codex_home "$PREREG_SESSION_CODEX_HOME" || true
  fi
  if [ -n "${DAEMON_MODE_SAVED:-}" ] && [ -d "${DAEMON_DIR:-}" ]; then
    chmod "$DAEMON_MODE_SAVED" "$DAEMON_DIR" || true
  fi
  rm -rf "$BASE"
}
trap cleanup EXIT

HELP=""
if command -v codex >/dev/null 2>&1; then
  HELP="$(codex exec --help 2>&1 || true)"
fi
python3 - "$BASE/fixture-auth.json" << 'PY'
import json, secrets, sys
dest = sys.argv[1]
marker = "marker-" + secrets.token_hex(8)
open(dest + ".marker", "w", encoding="utf-8").write(marker)
json.dump({"tokens": {"id_token": marker, "access_token": marker, "refresh_token": marker}}, open(dest, "w", encoding="utf-8"))
PY
chmod 600 "$BASE/fixture-auth.json"
export PREREG_CODEX_AUTH_FILE="$BASE/fixture-auth.json"
saved_scratch="$PREREG_SANDBOX_SCRATCH"
unset PREREG_SANDBOX_SCRATCH
saved_arm="$PREREG_ARM"
PREREG_ARM=A
ARM_A="$BASE/arm-a"
mkdir -p "$ARM_A"
prepare_session_codex_home "$ARM_A"
CODEX_HOME_A="$PREREG_SESSION_CODEX_HOME"
CODEX_ROOT_A="${PREREG_SESSION_CODEX_ROOT:-}"
unset PREREG_SESSION_CODEX_HOME PREREG_SESSION_CODEX_ROOT
export PREREG_SANDBOX_SCRATCH="$saved_scratch"
PREREG_ARM=B
PREREG_SESSION_SLOT=1
prepare_session_codex_home "$SESSION"
CODEX_HOME_B="$PREREG_SESSION_CODEX_HOME"
PREREG_ARM="$saved_arm"

pins=()
pinned_codex_exec_args pins "$HELP" "$REPO"
full=()
boundary_launch_args full env -i \
  "HOME=${SESSION}/home" \
  "TMPDIR=${SESSION}/tmp" \
  "PATH=${PATH}" \
  "CODEX_HOME=${CODEX_HOME_B}" \
  "XDG_RUNTIME_DIR=${CODEX_HOME_B}/runtime" \
  codex "${pins[@]}" -

python3 - "$PREREG_BOUNDARY" "$SCRATCH" "$REPO" "$SESSION" "$CODEX_HOME_B" "$DAEMON_DIR" "${full[@]}" << 'PY'
import sys
mode, scratch, repo, session, codex_home, daemon_dir, *argv = sys.argv[1:]
text = "\n".join(argv)
def require(token):
    if token not in argv:
        raise SystemExit(f"launcher command missing {token!r}\n{text}")
require("codex")
require("exec")
require("--ignore-user-config")
require("--ignore-rules")
require(f"CODEX_HOME={codex_home}")
require(f"XDG_RUNTIME_DIR={codex_home}/runtime")
if codex_home.startswith(session):
    raise SystemExit("CODEX_HOME is inside the session tree")
require('approval_policy="never"')
require("--sandbox")
require("workspace-write")
require("sandbox_workspace_write.network_access=true")
require(f"--cd")
require(repo)
for banned in (
    "--dangerously-bypass-approvals-and-sandbox",
    "--full-auto",
    "--approve-for-me",
    "not-a-policy",
):
    if banned in argv:
        raise SystemExit(f"launcher command contains {banned}")
if mode == "codex-landlock":
    need = ["codex", "sandbox", "-P", "prereg-session", "-C", scratch, "--"]
    start = argv.index("sandbox")
    window = argv[start - 1:start - 1 + len(need)]
    if window != need:
        raise SystemExit(f"codex sandbox wrapper mismatch: {window}")
    if argv[argv.index("-C") + 1] != scratch:
        raise SystemExit("sandbox cwd is not the scratch dir")
elif mode == "bwrap-ro":
    need = [
        "bwrap", "--unshare-user", "--unshare-pid", "--die-with-parent",
        "--ro-bind", "/", "/",
        "--bind", scratch, scratch,
        "--bind", f"{scratch}/daemon-bind", daemon_dir,
        "--dev", "/dev", "--proc", "/proc",
        "--bind", session, session,
        "--ro-bind", repo, repo,
        "--cap-drop", "ALL", "--",
    ]
    if argv[:len(need)] != need:
        raise SystemExit("bwrap wrapper mismatch:\n" + "\n".join(argv[:len(need)]))
else:
    raise SystemExit(f"unexpected mode {mode}")
# 外層可寫根是 scratch，不是儲存庫。--cd 指到的是給模型看的工作目錄，仍在唯讀掛載裡。
cd_at = argv.index("--cd")
if argv[cd_at + 1] != repo:
    raise SystemExit("codex exec --cd is not the repo")
print(f"launcher argv matches {mode}")
PY

expect_unchanged() {
  python3 - "$REPO/shared.py" << 'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
if text != "seed\n":
    raise SystemExit(f"repo file changed: {text!r}")
PY
}

run_sandboxed bash -c '
  set +e
  printf leaked >> "$1"
  echo write:$?
  chmod u+w "$1"
  echo chmod:$?
  mv "$1" "$1.moved"
  echo mv:$?
  rm -f "$1"
  echo rm:$?
  exit 0
' bash "$REPO/shared.py" > "$SCRATCH/direct.txt"
python3 - "$SCRATCH/direct.txt" << 'PY'
import pathlib, sys
vals = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    key, value = line.split(":", 1)
    vals[key] = int(value)
for key in ("write", "chmod", "mv", "rm"):
    if vals.get(key, 0) == 0:
        raise SystemExit(f"{key} was not blocked under the exec wrapper")
PY
expect_unchanged
echo "same wrapper blocks write chmod mv rm"

if [ "$PREREG_BOUNDARY" = "codex-landlock" ]; then
  run_sandboxed codex sandbox -P :danger-full-access -C "$SCRATCH" -- \
    bash -c 'printf leaked >> "$1"; echo inner:$?; exit 0' bash "$REPO/shared.py" \
    > "$SCRATCH/nested.txt" 2>"$SCRATCH/nested.err" || true
  if ! grep -q 'inner:1' "$SCRATCH/nested.txt"; then
    echo "danger-full-access 覆寫了外層沙盒" >&2
    cat "$SCRATCH/nested.txt" "$SCRATCH/nested.err" >&2
    exit 1
  fi
  expect_unchanged
  echo "nested danger-full-access still blocked"
fi

if [ "$PREREG_BOUNDARY" = "bwrap-ro" ]; then
  run_sandboxed bwrap --dev /dev --proc /proc --ro-bind / / --bind "$REPO" "$REPO" -- \
    bash -c 'printf leaked >> "$1"; echo nested:$?; exit 0' bash "$REPO/shared.py" \
    > "$SCRATCH/nested.txt" 2>"$SCRATCH/nested.err" || true
  if ! grep -q 'nested:1' "$SCRATCH/nested.txt"; then
    echo "內層 bwrap 覆寫了外層唯讀掛載" >&2
    cat "$SCRATCH/nested.txt" "$SCRATCH/nested.err" >&2
    exit 1
  fi
  expect_unchanged
  echo "nested bwrap remount still blocked"
fi

write_exec_driver() {
  local dest="$1"
  local mode="$2"
  shift 2
  # timeout 只能執行檔案，不能執行 shell function。驅動腳本和 launcher 一樣把 stdin 接到 codex exec。
  {
    echo '#!/bin/bash'
    echo 'set -euo pipefail'
    printf 'source %q\n' "$HERE/lib/common.sh"
    printf 'export PREREG_ARM=B\n'
    printf 'export PREREG_BOUNDARY=%q\n' "$PREREG_BOUNDARY"
    printf 'export PREREG_SANDBOX_SCRATCH=%q\n' "$SCRATCH"
    printf 'export PREREG_SANDBOX_REPO=%q\n' "$REPO"
    printf 'PREREG_SANDBOX_EXTRA_WRITES=(%q)\n' "$SESSION"
    printf 'run_sandboxed env -i '
    printf '%q ' \
      "PATH=${PATH}" \
      "HOME=${SESSION}/home" \
      "TMPDIR=${SESSION}/tmp" \
      "LANG=C.UTF-8"
    # bypass 必須讀 HOME/.codex 裡的壞設定。釘住的 exec 才帶工作階段 CODEX_HOME。
    if [ "$mode" = "pinned" ]; then
      printf '%q ' \
        "CODEX_HOME=${CODEX_HOME_B}" \
        "XDG_RUNTIME_DIR=${CODEX_HOME_B}/runtime" \
        codex "${pins[@]}" -
    else
      printf '%q ' codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C "$REPO" -
    fi
    printf '< %q\n' "$SCRATCH/prompt.txt"
  } > "$dest"
  chmod +x "$dest"
}

if [ "$PREREG_BOUNDARY" = "bwrap-ro" ]; then
  # codex sandbox 會把這個目錄從內層命令遮掉。bwrap-ro 的外層包裝必須讓
  # codex 行程自己看得到可寫的 0700 目錄，即使宿主上的那份不是 0700。
  run_sandboxed env -i \
    "PATH=${PATH}" \
    "HOME=${SESSION}/home" \
    "TMPDIR=${SESSION}/tmp" \
    bash -c '
      set -e
      dir="$1"
      test "$(stat -c %a "$dir")" = "700"
      test "$(stat -c %u "$dir")" = "$(id -u)"
      echo ok > "$dir/probe"
    ' bash "$DAEMON_DIR" > "$SCRATCH/daemon.out" 2>"$SCRATCH/daemon.err"
  if [ "$(cat "$PREREG_CODEX_DAEMON_BIND/probe")" != "ok" ]; then
    echo "Codex socket 目錄在 bwrap 裡不可寫或不是 0700" >&2
    cat "$SCRATCH/daemon.err" >&2
    exit 1
  fi
else
  ensure_codex_daemon_socket_mountpoint "$DAEMON_DIR"
  [ "$(stat -c %a "$DAEMON_DIR")" = "700" ]
  [ "$(stat -c %u "$DAEMON_DIR")" = "$(id -u)" ]
fi
echo "daemon socket dir is writable mode 0700 inside wrapper"

if command -v codex >/dev/null 2>&1; then
  printf 'ping\n' > "$SCRATCH/prompt.txt"
  write_exec_driver "$SCRATCH/pinned-driver.sh" pinned
  write_exec_driver "$SCRATCH/bypass-driver.sh" bypass
  set +e
  timeout 4 bash "$SCRATCH/pinned-driver.sh" > "$SCRATCH/pinned.out" 2>"$SCRATCH/pinned.err"
  pinned_status=$?
  timeout 4 bash "$SCRATCH/bypass-driver.sh" > "$SCRATCH/bypass.out" 2>"$SCRATCH/bypass.err"
  bypass_status=$?
  set -e
  if grep -q 'not-a-policy' "$SCRATCH/pinned.err"; then
    echo "釘住的 codex exec 仍讀到了使用者設定" >&2
    cat "$SCRATCH/pinned.err" >&2
    exit 1
  fi
  if grep -q 'app-server socket directory must be a user-owned directory with mode 0700' "$SCRATCH/pinned.err"; then
    echo "釘住的 codex exec 仍被 app-server socket 目錄擋住" >&2
    cat "$SCRATCH/pinned.err" >&2
    exit 1
  fi
  if ! grep -Eq '401 Unauthorized|Not logged in' "$SCRATCH/pinned.err"; then
    echo "釘住的 codex exec 沒有真的啟動 (exit ${pinned_status})" >&2
    cat "$SCRATCH/pinned.err" >&2
    exit 1
  fi
  if ! grep -q 'not-a-policy' "$SCRATCH/bypass.err"; then
    echo "bypass 沒有撞上壞掉的 approval_policy (exit ${bypass_status})" >&2
    cat "$SCRATCH/bypass.err" >&2
    exit 1
  fi
  expect_unchanged
  echo "pinned codex exec started inside ${PREREG_BOUNDARY}; bypass could not write"
fi

cmp -s "$PREREG_CODEX_AUTH_FILE" "$CODEX_HOME_A/auth.json"
cmp -s "$PREREG_CODEX_AUTH_FILE" "$CODEX_HOME_B/auth.json"
case "$CODEX_HOME_A" in
  "${TMPDIR:-/tmp}"/prereg-sbx.*/codex-home*) ;;
  *) echo "Arm A CODEX_HOME 不在 /tmp/prereg-sbx.*/codex-home.*：$CODEX_HOME_A" >&2; exit 1 ;;
esac
case "$CODEX_HOME_B" in
  "$SCRATCH"/codex-home*) ;;
  *) echo "Arm B CODEX_HOME 不在 scratch：$CODEX_HOME_B" >&2; exit 1 ;;
esac
find "$ARM_A" "$SESSION" -name auth.json | grep -q . && {
  echo "auth.json 進入了 session 樹" >&2
  exit 1
}
[ "$(stat -c %a "$CODEX_HOME_B")" = "700" ]
[ "$(stat -c %a "$CODEX_HOME_B/runtime")" = "700" ]
[ "$(stat -c %a "$CODEX_HOME_B/auth.json")" = "600" ]
saved_home="$PREREG_SESSION_CODEX_HOME"
saved_root="${PREREG_SESSION_CODEX_ROOT:-}"
PREREG_SESSION_CODEX_HOME="$CODEX_HOME_A"
PREREG_SESSION_CODEX_ROOT="$CODEX_ROOT_A"
session_env_assignments "$ARM_A" "$REPO" | grep -F "CODEX_HOME=${CODEX_HOME_A}" >/dev/null
session_env_assignments "$ARM_A" "$REPO" | grep -F "XDG_RUNTIME_DIR=${CODEX_HOME_A}/runtime" >/dev/null
PREREG_SESSION_CODEX_HOME="$CODEX_HOME_B"
unset PREREG_SESSION_CODEX_ROOT
session_env_assignments "$SESSION" "$REPO" | grep -F "CODEX_HOME=${CODEX_HOME_B}" >/dev/null
session_env_assignments "$SESSION" "$REPO" | grep -F "XDG_RUNTIME_DIR=${CODEX_HOME_B}/runtime" >/dev/null
PREREG_SESSION_CODEX_HOME="$saved_home"
if [ -n "$saved_root" ]; then
  PREREG_SESSION_CODEX_ROOT="$saved_root"
fi
run_sandboxed env -i \
  "PATH=${PATH}" \
  "HOME=${SESSION}/home" \
  "TMPDIR=${SESSION}/tmp" \
  "CODEX_HOME=${CODEX_HOME_B}" \
  "XDG_RUNTIME_DIR=${CODEX_HOME_B}/runtime" \
  bash -c '
    set -e
    test -r "$CODEX_HOME/auth.json"
    test -w "$CODEX_HOME"
    test -w "$XDG_RUNTIME_DIR"
    mkdir -p "$CODEX_HOME/sessions"
    echo ok > "$CODEX_HOME/sessions/probe"
    echo ok > "$CODEX_HOME/tmp/probe"
    if command -v codex >/dev/null 2>&1; then
      codex login status > "$CODEX_HOME/login.out" 2> "$CODEX_HOME/login.err" || true
    fi
    if printf x >> "$1" 2>/dev/null; then
      exit 3
    fi
  ' bash "$REPO/shared.py" > "$SCRATCH/auth-probe.out" 2>"$SCRATCH/auth-probe.err"
[ "$(cat "$CODEX_HOME_B/sessions/probe")" = "ok" ]
[ "$(cat "$CODEX_HOME_B/tmp/probe")" = "ok" ]
expect_unchanged
python3 - "$BASE/fixture-auth.json.marker" "$CODEX_HOME_B" "$SCRATCH/auth-probe.out" "$SCRATCH/auth-probe.err" << 'PY'
import pathlib, sys
marker = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
home = pathlib.Path(sys.argv[2])
blobs = []
for path in [pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), home / "login.out", home / "login.err"]:
    if path.is_file():
        blobs.append(path.read_text(encoding="utf-8", errors="replace"))
joined = "\n".join(blobs)
if marker and marker in joined:
    raise SystemExit("auth contents were printed")
login_err = home / "login.err"
login_out = home / "login.out"
if login_err.is_file() or login_out.is_file():
    text = ""
    if login_out.is_file():
        text += login_out.read_text(encoding="utf-8", errors="replace")
    if login_err.is_file():
        text += login_err.read_text(encoding="utf-8", errors="replace")
    if "Not logged in" in text and "invalid ID token" not in text and "Logged in" not in text:
        raise SystemExit("codex login status did not read CODEX_HOME/auth.json")
    if "invalid ID token" not in text and "Logged in" not in text:
        raise SystemExit("codex did not parse the auth file")
print("auth readable inside wrapper; session state writable; login not dropped")
PY
unset PREREG_CODEX_AUTH_FILE
echo "exec boundary ok (${PREREG_BOUNDARY})"

#!/bin/bash
# steward 必須等到 socket 接受連線。逾時要殺掉 daemon，不能留下行程。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
export PREREG_BOUNDARY=codex-sandbox
export PREREG_STEWARD_SOCK_DIR="$BASE/socks"
mkdir -p "$PREREG_STEWARD_SOCK_DIR"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

# 慢半秒才 listen。只看 socket 檔是否存在會太早。
BIN="$BASE/bin"
mkdir -p "$BIN"
cat > "$BIN/node" <<'EOF'
#!/bin/bash
sock=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sock) sock="$2"; shift 2 ;;
    *) shift ;;
  esac
done
sleep 0.6
exec python3 -c 'import socket, sys, time
s = socket.socket(socket.AF_UNIX)
s.bind(sys.argv[1])
s.listen(1)
time.sleep(30)
' "$sock"
EOF
chmod +x "$BIN/node"
WORK="$BASE/work"
mkdir -p "$WORK/.prereg-smoke"
export PATH="$BIN:$PATH"
LOG="$BASE/slow.log"
start_steward_daemon "$WORK" "$LOG"
steward_socket_accepts "$PREREG_STEWARD_SOCK"
stop_steward_pid "${PREREG_STEWARD_PID:-}"
remove_steward_socket "${PREREG_STEWARD_SOCK:-}"
unset PREREG_STEWARD_PID PREREG_STEWARD_SOCK || true
rm -f "$PREREG_STEWARD_SOCK_DIR"/*.sock

# 立刻退出的 node：必須失敗、清掉 socket，而且不能留下行程。
cat > "$BIN/node" <<'EOF'
#!/bin/bash
echo "boom" >&2
exit 1
EOF
export PREREG_STEWARD_START_TIMEOUT=1
LOG2="$BASE/fail.log"
set +e
(
  start_steward_daemon "$WORK" "$LOG2"
) >"$BASE/fail.out" 2>"$BASE/fail.err"
status=$?
set -e
[ "$status" -ne 0 ]
grep -q '啟動失敗' "$BASE/fail.err"
if compgen -G "$PREREG_STEWARD_SOCK_DIR/*.sock" > /dev/null; then
  echo "failed steward left a socket behind" >&2
  ls -la "$PREREG_STEWARD_SOCK_DIR" >&2
  exit 1
fi
echo "steward ready ok"

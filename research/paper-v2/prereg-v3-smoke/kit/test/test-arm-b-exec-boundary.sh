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
BASE="$(mktemp -d "${HOME}/prereg-exec-boundary.XXXXXX")"
REPO="$BASE/repo"
SCRATCH="$BASE/scratch"
SESSION="$BASE/session"
mkdir -p "$REPO" "$SCRATCH" "$SESSION/home/.codex" "$SESSION/tmp"
printf 'seed\n' > "$REPO/shared.py"
cat > "$SESSION/home/.codex/config.toml" << 'EOF'
approval_policy = "not-a-policy"
sandbox_mode = "danger-full-access"
EOF
export PREREG_ARM=B
export PREREG_SANDBOX_SCRATCH="$SCRATCH"
export PREREG_SANDBOX_REPO="$REPO"
PREREG_SANDBOX_EXTRA_WRITES=("$SESSION")
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

HELP=""
if command -v codex >/dev/null 2>&1; then
  HELP="$(codex exec --help 2>&1 || true)"
fi
pins=()
pinned_codex_exec_args pins "$HELP" "$REPO"
full=()
boundary_launch_args full env -i \
  "HOME=${SESSION}/home" \
  "TMPDIR=${SESSION}/tmp" \
  "PATH=${PATH}" \
  codex "${pins[@]}" -

python3 - "$PREREG_BOUNDARY" "$SCRATCH" "$REPO" "$SESSION" "${full[@]}" << 'PY'
import sys
mode, scratch, repo, session, *argv = sys.argv[1:]
text = "\n".join(argv)
def require(token):
    if token not in argv:
        raise SystemExit(f"launcher command missing {token!r}\n{text}")
require("codex")
require("exec")
require("--ignore-user-config")
require("--ignore-rules")
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
    if [ "$mode" = "pinned" ]; then
      printf '%q ' codex "${pins[@]}" -
    else
      printf '%q ' codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C "$REPO" -
    fi
    printf '< %q\n' "$SCRATCH/prompt.txt"
  } > "$dest"
  chmod +x "$dest"
}

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

echo "exec boundary ok (${PREREG_BOUNDARY})"

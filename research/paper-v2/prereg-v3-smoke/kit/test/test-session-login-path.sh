#!/bin/bash
# Codex 用 bash -lc。/etc/profile 可以清掉 PATH。兩臂的 login shell 仍要找到 kit 的 python、atm-write 與 git。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

VENV="$BASE/venv"
mkdir -p "$VENV/bin"
printf '#!/bin/sh\nexit 0\n' > "$VENV/bin/python"
chmod a+rx "$VENV/bin/python"
ln -s python "$VENV/bin/python3"
export PREREG_PYTHON="$VENV/bin/python"
export PREREG_SMOKE_CODEX=1
export PREREG_REAL_GIT=/usr/bin/git

REPO="$BASE/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
printf 'old\n' > "$REPO/note.txt"
git -C "$REPO" add note.txt
git -C "$REPO" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base

# The operator's Codex directory must not become a session PATH prefix.
mkdir -p "$BASE/operator"
for tool in git python3 codex; do
  printf '#!/bin/sh\nexit 97\n' > "$BASE/operator/$tool"
  chmod +x "$BASE/operator/$tool"
done
export PATH="$BASE/operator:$PATH"
for arm in A B; do
  session="$BASE/session-$arm"
  bin="$BASE/bin-$arm"
  install_arm_git_bin "$arm" "$bin"
  export PREREG_ARM="$arm"
  export PREREG_ARM_BIN="$bin"
  assert_session_login_path "$session" "$REPO"
  probe_path="$(session_path_value)"
  unset PREREG_SMOKE_CODEX
  PREREG_SESSION_CODEX_HOME="$BASE/empty-codex-home" session_env_assignments "$session" "$REPO" > "$session/launch-env.txt"
  export PREREG_SMOKE_CODEX=1
  expected="$bin:$HERE/bin:$VENV/bin:$(dirname "$(command -v node)"):/usr/bin:/bin"
  [ "$probe_path" = "$expected" ]
  grep -Fx "PATH=$expected" "$session/launch-env.txt"
  actual="$(bash -c '. "$1"; printf "%s" "$PATH"' _ "$session/home/.prereg-path.sh")"
  [ "$actual" = "$expected" ]
done

run_login() {
  local session="$1"
  shift
  local -a env_cmd=(env -i)
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    env_cmd+=("$line")
  done < "$session/login-check.env"
  "${env_cmd[@]}" bash -lc "cd $(printf '%q' "$REPO") && $*"
}

PATH="${PATH#"$BASE/operator:"}"
export PATH
export PREREG_ARM=A
export PREREG_ARM_BIN="$BASE/bin-A"
printf 'new\n' > "$REPO/note.txt"
run_login "$BASE/session-A" "git add note.txt && git commit -q -m probe"
[ "$(git -C "$REPO" show HEAD:note.txt)" = "new" ]

export PREREG_ARM=B
export PREREG_ARM_BIN="$BASE/bin-B"
printf 'blocked\n' > "$REPO/note.txt"
set +e
run_login "$BASE/session-B" "git add note.txt" >"$BASE/shim.out" 2>"$BASE/shim.err"
status=$?
set -e
[ "$status" -eq 86 ]
grep -q 'blocked in arm B' "$BASE/shim.err"
echo "session login path ok"

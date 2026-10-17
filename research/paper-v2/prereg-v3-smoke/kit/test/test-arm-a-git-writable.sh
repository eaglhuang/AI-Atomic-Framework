#!/bin/bash
# Arm A 必須能在自己的工作樹 git add + git commit。
# Codex workspace-write 預設把 .git 刻成唯讀；launcher 只把該工作樹的 .git 放進 writable_roots，不開網路。
# 真實模型探測要看到 HEAD 前進，否則失敗。這裡在沒有 Codex 時仍證明：唯讀 .git 提交失敗、可寫 .git 提交成功。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

case "${HOME:-}" in
  ""|/tmp|/tmp/*) echo "Arm A git 檢查需要一個不在 /tmp 裡的 HOME。" >&2; exit 1 ;;
esac
BASE="$(mktemp -d "${HOME}/prereg-arm-a.XXXXXX")"
cleanup() { chmod -R u+w "$BASE" 2>/dev/null || true; rm -rf "$BASE"; }
trap cleanup EXIT

grep -q 'git add note.txt and git commit' "$HERE/test/test-real-model.sh"
grep -q 'arm A git commit did not move HEAD' "$HERE/test/test-real-model.sh"

collect() {
  local arm="$1" boundary="${2-}" work="$3"
  local -a args=()
  PREREG_ARM="$arm" PREREG_BOUNDARY="$boundary" pinned_codex_exec_args args "" "$work"
  printf '%s\n' "${args[@]}"
}

WORK="$BASE/repo"
mkdir -p "$WORK"
arm_a="$(collect A "" "$WORK")"
printf '%s\n' "$arm_a" | grep -Fxq 'workspace-write'
printf '%s\n' "$arm_a" | grep -Fxq "sandbox_workspace_write.writable_roots=[\"${WORK}/.git\"]"
printf '%s\n' "$arm_a" | grep -Fxq 'sandbox_workspace_write.network_access=false'
[ "$(printf '%s\n' "$arm_a" | grep -c 'writable_roots')" = "1" ]
if printf '%s\n' "$arm_a" | grep -q 'network_access=true'; then
  echo "Arm A opened network" >&2
  exit 1
fi
if printf '%s\n' "$arm_a" | grep -Eiq 'gold'; then
  echo "Arm A writable root mentions gold" >&2
  exit 1
fi

unix_b="$(collect B unix-user "$WORK")"
printf '%s\n' "$unix_b" | grep -Fxq 'sandbox_workspace_write.network_access=true'
if printf '%s\n' "$unix_b" | grep -q 'writable_roots'; then
  echo "Arm B unix-user was given a writable .git" >&2
  exit 1
fi

plain_b="$(collect B "" "$WORK")"
printf '%s\n' "$plain_b" | grep -qx 'read-only'
if printf '%s\n' "$plain_b" | grep -q 'writable_roots\|network_access'; then
  echo "Arm B read-only sandbox gained git write or network" >&2
  printf '%s\n' "$plain_b" >&2
  exit 1
fi

git init -q "$WORK"
printf 'old\n' > "$WORK/note.txt"
git -C "$WORK" add note.txt
git -C "$WORK" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
base_sha="$(git -C "$WORK" rev-parse HEAD)"
printf 'new\n' > "$WORK/note.txt"
chmod a-w "$WORK/.git"
set +e
git -C "$WORK" add note.txt >"$BASE/ro.out" 2>"$BASE/ro.err"
ro_status=$?
set -e
if [ "$ro_status" -eq 0 ]; then
  echo "read-only .git still accepted git add" >&2
  exit 1
fi
grep -q 'index.lock\|Read-only\|Permission denied' "$BASE/ro.err"
chmod u+w "$WORK/.git"
git -C "$WORK" add note.txt
git -C "$WORK" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m probe
head_sha="$(git -C "$WORK" rev-parse HEAD)"
[ "$head_sha" != "$base_sha" ]
[ "$(git -C "$WORK" show HEAD:note.txt)" = "new" ]

# GitHub Actions 有 bwrap 執行檔，但 user namespace 會是 uid map Permission denied。
# 那不是 .git 唯讀的證明。bwrap_ready 先跑一次 true；起不來就略過，chmod 證明仍在。
if bwrap_ready; then
  printf 'bwrap\n' > "$WORK/note.txt"
  mkdir -p "$BASE/scratch"
  set +e
  bwrap --unshare-user --die-with-parent \
    --ro-bind / / \
    --bind "$WORK" "$WORK" \
    --ro-bind "$WORK/.git" "$WORK/.git" \
    --bind "$BASE/scratch" "$BASE/scratch" \
    --dev /dev --proc /proc \
    --setenv TMPDIR "$BASE/scratch" -- \
    git -C "$WORK" add note.txt >"$BASE/bwrap-ro.out" 2>"$BASE/bwrap-ro.err"
  bwrap_ro=$?
  set -e
  if [ "$bwrap_ro" -eq 0 ]; then
    echo "bwrap read-only .git still accepted git add" >&2
    cat "$BASE/bwrap-ro.err" >&2
    exit 1
  fi
  grep -q 'index.lock\|Read-only\|Permission denied' "$BASE/bwrap-ro.err"
  bwrap --unshare-user --die-with-parent \
    --ro-bind / / \
    --bind "$WORK" "$WORK" \
    --ro-bind "$WORK/.git" "$WORK/.git" \
    --bind "$WORK/.git" "$WORK/.git" \
    --bind "$BASE/scratch" "$BASE/scratch" \
    --dev /dev --proc /proc \
    --setenv TMPDIR "$BASE/scratch" -- \
    git -C "$WORK" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -am bwrap
  [ "$(git -C "$WORK" show HEAD:note.txt)" = "bwrap" ]
fi

VENV="$BASE/venv"
mkdir -p "$VENV/bin"
printf '#!/bin/sh\nexit 0\n' > "$VENV/bin/python"
chmod 777 "$VENV" "$VENV/bin" "$VENV/bin/python"
printf 'home = /usr\n' > "$VENV/pyvenv.cfg"
export PREREG_PYTHON="$VENV/bin/python"
expose_evaluator_python
python3 - "$VENV" <<'PY'
import os, stat, sys
root = sys.argv[1]
for dirpath, dirs, files in os.walk(root):
    for name in dirs + files:
        mode = os.lstat(os.path.join(dirpath, name)).st_mode
        if stat.S_ISLNK(mode):
            continue
        if mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise SystemExit(f"venv is writable by others: {name} {oct(mode)}")
if not os.access(os.path.join(root, "bin", "python"), os.X_OK):
    raise SystemExit("venv python is not executable")
PY
export PREREG_SMOKE_CODEX=1
unset PREREG_ARM_BIN || true
for arm in A B; do
  line="$(PREREG_ARM="$arm" session_env_assignments "$BASE/session" "$WORK" | awk -F= '$1=="PATH"{print $2}')"
  case "$line" in
    "$VENV/bin":*|"$HERE/bin:$VENV/bin:"*) ;;
    *) echo "arm ${arm} PATH missing evaluator venv: ${line}" >&2; exit 1 ;;
  esac
done
b_line="$(PREREG_ARM=B session_env_assignments "$BASE/session" "$WORK" | awk -F= '$1=="PATH"{print $2}')"
case "$b_line" in
  "$HERE/bin:$VENV/bin:"*) ;;
  *) echo "arm B did not keep kit bin ahead of the venv: ${b_line}" >&2; exit 1 ;;
esac
unset PREREG_PYTHON
bare="$(PREREG_ARM=A PREREG_PYTHON=python3 session_env_assignments "$BASE/session" "$WORK" | awk -F= '$1=="PATH"{print $2}')"
case "$bare" in
  .:*|.:/*) echo "relative python leaked onto PATH: ${bare}" >&2; exit 1 ;;
esac

echo "arm A git writable ok"

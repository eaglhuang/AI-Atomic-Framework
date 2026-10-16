#!/bin/bash
# 用法：run-arm.sh A|B
# 工作階段以 env -i 與允許清單啟動。金標路徑不進入工作階段。
set -euo pipefail
ARM="${1:-}"
[ "$ARM" = "A" ] || [ "$ARM" = "B" ] || { echo "usage: run-arm.sh A|B" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
load_state

ARM_DIR="$STATE_ROOT/arm-${ARM,,}"
if [ -e "$ARM_DIR" ]; then
  die "arm 目錄已存在：$ARM_DIR。拒絕刪除既有 state。"
fi
mkdir -p "$ARM_DIR/session-1" "$ARM_DIR/session-2"
WORK="$ARM_DIR/work"
git clone --quiet "$TEMPLATE" "$WORK"
# clone 會留在分支上；釘住紀錄的 base，讓兩臂起點相同。
git -C "$WORK" checkout --force --detach --quiet "$COMMON_BASE"

export GIT_AUTHOR_NAME=prereg-smoke
export GIT_AUTHOR_EMAIL=prereg-smoke@localhost
export GIT_COMMITTER_NAME=prereg-smoke
export GIT_COMMITTER_EMAIL=prereg-smoke@localhost
export PREREG_REAL_GIT=/usr/bin/git
export PREREG_ARM="$ARM"
export PREREG_WRITE_AFTER_MS="$(( $(date +%s%3N) + 1200 ))"
unset PREREG_GOLD_PATCH || true
unset PREREG_ARM_BIN || true

cleanup_arm() {
  if [ "${ARM:-}" = "B" ]; then
    release_worktree "${WORK:-}"
    release_sandbox_scratch "${PREREG_SANDBOX_SCRATCH:-}"
  fi
}
trap cleanup_arm EXIT

if [ "$ARM" = "B" ]; then
  CLI="$(require_public_cli)"
  mkdir -p "$ARM_DIR/bin" "$WORK/.prereg-smoke"
  export PREREG_SANDBOX_REPO="$WORK"
  ln -sfn "$HERE/bin/atm-write" "$ARM_DIR/bin/atm-write"
  ln -sfn "$HERE/bin/git-shim" "$ARM_DIR/bin/git"
  export PREREG_ARM_BIN="$ARM_DIR/bin"
  NODE_BIN="$(dirname "$(command -v node)")"
  ensure_prereg_users
  if sandbox_boundary_active; then
    allocate_sandbox_scratch >/dev/null
    ln -sfn "$PREREG_SANDBOX_SCRATCH" "$ARM_DIR/scratch"
  fi
  python3 - "$WORK/.prereg-smoke/session-write.json" "$WORK" "$CLI" "$NODE_BIN" "$PREREG_BOUNDARY" <<'PY'
import json, sys
dest, work, cli, node_bin, boundary = sys.argv[1:]
payload = {
    "writableRoot": work,
    "cli": cli,
    "cliVersion": "0.1.21",
    "safePath": f"{node_bin}:/usr/bin:/bin",
    "composeWindowMs": 4000,
    "boundary": boundary,
}
open(dest, "w", encoding="utf-8").write(json.dumps(payload, indent=2) + "\n")
PY
  # 父目錄維持啟動者所有，session 不能把整個工作樹刪掉再換一棵自己的。
  chmod 755 "$ARM_DIR" "$ARM_DIR/bin"
  own_worktree "$WORK"
  start_steward_daemon "$WORK" "$ARM_DIR/steward-daemon.log"
  {
    echo "boundary=${PREREG_BOUNDARY}"
    boundary_mechanism_line
    uname -srm
    if [ -r /etc/os-release ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      echo "os=${PRETTY_NAME:-unknown}"
    fi
    echo "sock=${PREREG_STEWARD_SOCK}"
  } > "$ARM_DIR/boundary.txt"
fi

mapfile -t IDS < <(jq -r '.primary.instances[].instanceId' "$TASKS_JSON")
[ "${#IDS[@]}" -eq 2 ] || die "預期 2 個 primary instances"

write_prompt() {
  local slot="$1" dest="$2" instance="$3"
  local statement
  statement="$(jq -r --arg id "$instance" '.primary.instances[] | select(.instanceId==$id) | .problemStatement' "$TASKS_JSON")"
  {
    echo "You are working in this local git checkout. Solve only the issue below."
    echo "Do not mention any other task, session, or agent."
    echo
    echo "$statement"
    echo
    if [ "$ARM" = "A" ]; then
      echo "Edit the repository files directly and commit your own fix with git."
    else
      cat <<EOF
Every file write and every git commit must go through this exact command:

  ${HERE}/bin/atm-write <relative-file> <unified-diff-file>

That path is also on PATH as atm-write. It is the only writer. It calls the public ATM CLI 0.1.21 steward apply-live. If that CLI is unavailable, the arm has already aborted. Do not write the file yourself.

If atm-write exits 3, the steward rejected this attempt. stdout is one JSON record with decision "rejected-by-design", reasonCode, and currentFileText (the file as it is now). Re-read that state, recompose the diff against it, and resubmit. You may retry at most 3 times. Record every attempt. If the task is still unfinished after those retries, report BLOCKED and do not claim success. A kit or CLI crash is not a rejection: do not paper over it.
EOF
    fi
    cat <<'EOF'

After you decide the edit, emit the unified diff you intended between these markers:
BEGIN_INTENDED_PATCH
diff --git a/...
END_INTENDED_PATCH
EOF
  } > "$dest"
}

START_MS="$(date +%s%3N)"
pids=()
for slot in 1 2; do
  instance="${IDS[$((slot - 1))]}"
  session="$ARM_DIR/session-$slot"
  write_prompt "$slot" "$session/prompt.txt" "$instance"
  PREREG_INSTANCE_ID="$instance" \
  PREREG_SESSION_SLOT="$slot" \
  PREREG_WORK="$WORK" \
    launch_codex "$session" "$session/prompt.txt" "$WORK" &
  pids+=("$!")
done
END_SPAWN_MS="$(date +%s%3N)"
SKEW_MS="$((END_SPAWN_MS - START_MS))"
printf '%s\n' "$SKEW_MS" > "$ARM_DIR/start-skew-ms"
if [ "$SKEW_MS" -ge 5000 ]; then
  echo "warning: spawn skew ${SKEW_MS}ms is not under 5s" >&2
fi

fail=0
for pid in "${pids[@]}"; do
  wait "$pid" || fail=1
done

for slot in 1 2; do
  capture_intended_patch "$ARM_DIR/session-$slot"
done

# 評估要讀工作樹。先把擁有者還給啟動者，daemon 也在這裡停掉。
if [ "$ARM" = "B" ]; then
  release_worktree "$WORK"
fi

record_model "$ARM_DIR/session-1" "$ARM_DIR/model.txt"
model_name="$(head -n 1 "$ARM_DIR/model.txt")"
effort_name="$(sed -n '2s/^reasoning_effort=//p' "$ARM_DIR/model.txt")"
{
  echo "arm=$ARM"
  if [ "$ARM" = "B" ]; then
    echo "boundary=${PREREG_BOUNDARY:-}"
    boundary_mechanism_line
  fi
  echo "skew_ms=$SKEW_MS"
  echo "model=${model_name}"
  echo "reasoning_effort=${effort_name}"
  echo "work=$WORK"
  echo "base=$COMMON_BASE"
  if [ -n "${PREREG_SMOKE_CODEX:-}" ]; then
    echo "agent=stub"
  else
    echo "agent=codex"
    codex --version > "$ARM_DIR/codex-version.txt" 2>&1 || true
  fi
} > "$ARM_DIR/meta.txt"

if [ -f "$ARM_DIR/session-1/QUOTA_STOP" ] || [ -f "$ARM_DIR/session-2/QUOTA_STOP" ]; then
  echo "free-quota stop. Do not start another paid or free-tier retry." | tee "$ARM_DIR/QUOTA_STOP"
  exit 75
fi

echo "arm $ARM finished skew_ms=$SKEW_MS model=${model_name} reasoning_effort=${effort_name:-unset}"
exit "$fail"

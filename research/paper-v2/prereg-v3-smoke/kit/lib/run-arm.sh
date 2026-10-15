#!/bin/bash
# Usage: run-arm.sh A|B
set -euo pipefail
ARM="${1:-}"
[ "$ARM" = "A" ] || [ "$ARM" = "B" ] || { echo "usage: run-arm.sh A|B" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
load_state

ARM_DIR="$STATE_ROOT/arm-${ARM,,}"
rm -rf "$ARM_DIR"
mkdir -p "$ARM_DIR/session-1" "$ARM_DIR/session-2"
WORK="$ARM_DIR/work"
git clone --quiet "$TEMPLATE" "$WORK"
# clone leaves a branch; pin the recorded base so both arms start equal.
git -C "$WORK" checkout --force --detach --quiet "$COMMON_BASE"

export GIT_AUTHOR_NAME=prereg-smoke
export GIT_AUTHOR_EMAIL=prereg-smoke@localhost
export GIT_COMMITTER_NAME=prereg-smoke
export GIT_COMMITTER_EMAIL=prereg-smoke@localhost
export PREREG_REAL_GIT=/usr/bin/git
export PREREG_ARM="$ARM"
export PREREG_ATM_WRITE="$HERE/bin/atm-write"
export PREREG_WRITE_AFTER_MS="$(( $(date +%s%3N) + 1200 ))"

PATH_SAVE="$PATH"
if [ "$ARM" = "B" ]; then
  mkdir -p "$ARM_DIR/bin"
  ln -sfn "$HERE/bin/atm-write" "$ARM_DIR/bin/atm-write"
  ln -sfn "$HERE/bin/git-shim" "$ARM_DIR/bin/git"
  export PREREG_UNSHIMMED_PATH="$PATH"
  export PATH="$ARM_DIR/bin:$PATH"
fi

mapfile -t IDS < <(jq -r '.primary.instances[].instanceId' "$TASKS_JSON")
[ "${#IDS[@]}" -eq 2 ] || die "expected 2 primary instances"

write_prompt() {
  local slot="$1" dest="$2" instance="$3"
  local statement
  statement="$(jq -r --arg id "$instance" '.primary.instances[] | select(.instanceId==$id) | .problemStatement' "$TASKS_JSON")"
  {
    echo "You are working in this local git checkout. Solve only the issue below."
    echo "Do not mention any other task, session, or agent. Do not look for a gold patch."
    echo
    echo "$statement"
    echo
    if [ "$ARM" = "A" ]; then
      echo "Edit the repository files directly and commit your own fix with git."
    else
      cat <<'EOF'
Every file write and every git commit must go through the steward wrapper:

  atm-write <relative-file> <unified-diff-file>

That command is the only writer. It submits a proposal, composes, compares the base hash, writes the file atomically, then commits through the shared-delivery transaction. Do not redirect a shell into a source file. Do not use git add or git commit. If atm-write prints a JSON record whose terminal is not "committed", or exits 3, stop. That is a steward rejection. Do not write the file yourself.
EOF
    fi
  } > "$dest"
}

START_MS="$(date +%s%3N)"
pids=()
for slot in 1 2; do
  instance="${IDS[$((slot - 1))]}"
  session="$ARM_DIR/session-$slot"
  write_prompt "$slot" "$session/prompt.txt" "$instance"
  gold_rel="$(jq -r --arg id "$instance" '.primary.instances[] | select(.instanceId==$id) | (.applyPatch // .goldPatch)' "$TASKS_JSON")"
  if [ "$PREREG_SMOKE_MODE" = "fixture" ]; then
    gold_path="$GOLD_ROOT/$gold_rel"
  else
    gold_path="$KIT_ROOT/$gold_rel"
  fi
  [ -f "$gold_path" ] || die "missing gold patch $gold_path"
  PREREG_INSTANCE_ID="$instance" \
  PREREG_GOLD_PATCH="$gold_path" \
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

export PATH="$PATH_SAVE"
record_model "$ARM_DIR/session-1" "$ARM_DIR/model.txt"
{
  echo "arm=$ARM"
  echo "skew_ms=$SKEW_MS"
  echo "model=$(cat "$ARM_DIR/model.txt")"
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

echo "arm $ARM finished skew_ms=$SKEW_MS model=$(cat "$ARM_DIR/model.txt")"
exit "$fail"

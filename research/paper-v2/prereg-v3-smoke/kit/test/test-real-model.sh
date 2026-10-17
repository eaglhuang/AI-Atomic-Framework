#!/bin/bash
# 選擇性的真實模型探測。預設跳過，不呼叫 Codex。
# PREFLIGHT_REAL_MODEL=1 時，只對這一輪選到的邊界跑一次很小的、與題目無關的 codex exec。
# PREREG_BOUNDARY 可以覆寫那個選擇。Arm A 一次，Arm B 用同一個模式一次。
# Arm B 必須經 steward 把 atm-write 叫成功，capture 要從真實 stdout 抽出 patch。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

cleanup_real() {
  local dir
  for dir in "${CLEAN_DIRS[@]:-}"; do
    [ -n "${dir:-}" ] && [ -d "$dir" ] || continue
    release_worktree "$dir" || true
    rm -rf "$dir"
  done
  release_sandbox_scratch "${PREREG_SANDBOX_SCRATCH:-}" || true
  if [ -n "${PREREG_STEWARD_PID:-}" ]; then
    stop_steward_pid "$PREREG_STEWARD_PID" || true
    unset PREREG_STEWARD_PID || true
  fi
}

track_dir() {
  CLEAN_DIRS+=("$1")
}

write_probe_prompt() {
  local arm="$1" dest="$2"
  if [ "$arm" = "A" ]; then
    cat > "$dest" <<'EOF'
This is a preflight probe, not a software task. Do not mention django or any issue.
Edit note.txt so that its only line is new.
Then run git add note.txt and git commit so that commit succeeds and HEAD contains that line.
Then emit the unified diff between these markers:
BEGIN_INTENDED_PATCH
diff --git a/note.txt b/note.txt
END_INTENDED_PATCH
EOF
    return 0
  fi
  cat > "$dest" <<EOF
This is a preflight probe, not a software task. Do not mention django or any issue.
Do not edit the repository yourself. Do not run git commit.
Write a unified diff to \$TMPDIR/note.patch that changes note.txt from the single line old to the single line new.
Then run this exact command and require exit 0:

  ${HERE}/bin/atm-write note.txt \$TMPDIR/note.patch

After it succeeds, emit that same diff between these markers:
BEGIN_INTENDED_PATCH
diff --git a/note.txt b/note.txt
END_INTENDED_PATCH
EOF
}

prepare_probe_repo() {
  local repo="$1"
  git init -q "$repo"
  printf 'old\n' > "$repo/note.txt"
  git -C "$repo" add note.txt
  git -C "$repo" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
  mkdir -p "$repo/.prereg-smoke"
}

# 與正式 Arm B 相同：公開 CLI 0.1.21 確認之後才寫 session-write.json，沒有 claim 退路。
# unix-user 要等檔案寫完才 own_worktree，session 讀得到設定，但不能寫已追蹤檔。
prepare_probe_arm_b() {
  local repo="$1"
  local mode="$2"
  case "$mode" in
    unix-user|codex-landlock|bwrap-ro) ;;
    *) die "真實模型探測的 Arm B 邊界必須是 unix-user、codex-landlock 或 bwrap-ro。" ;;
  esac
  export PREREG_ARM=B
  PREREG_BOUNDARY="$mode"
  export PREREG_BOUNDARY
  ensure_prereg_users
  if [ "$mode" = "unix-user" ]; then
    [ "${PREREG_BOUNDARY}" = "unix-user" ]
  fi
  require_public_cli >/dev/null
  write_session_write_config "$repo"
  if [ "$mode" = "unix-user" ]; then
    own_worktree "$repo"
  fi
}

wait_for_launch() {
  local child="$1" label="$2"
  local waited=0 limit="${PREREG_REAL_MODEL_TIMEOUT:-240}"
  while kill -0 "$child" 2>/dev/null; do
    if [ "$waited" -ge "$limit" ]; then
      kill "$child" 2>/dev/null || true
      pkill -P "$child" 2>/dev/null || true
      wait "$child" 2>/dev/null || true
      die "real codex exec exceeded ${limit}s (${label})"
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$child" 2>/dev/null || true
}

assert_captured_patch() {
  local session="$1" label="$2"
  capture_intended_patch "$session"
  if [ ! -s "$session/intended.patch" ]; then
    echo "capture 沒有從真實 stdout 抽出 patch (${label})" >&2
    exit 1
  fi
  if ! grep -q 'diff --git ' "$session/intended.patch"; then
    echo "抽出的 patch 沒有 diff --git (${label})" >&2
    exit 1
  fi
}

run_real_exec() {
  local arm="$1" mode="$2"
  local repo session
  if [ "$arm" = "B" ] && { [ "$mode" = "codex-landlock" ] || [ "$mode" = "bwrap-ro" ]; }; then
    repo="$(mktemp -d "${HOME}/prereg-real.XXXXXX")"
  else
    repo="$(mktemp -d)"
  fi
  session="$(mktemp -d)"
  track_dir "$repo"
  track_dir "$session"
  prepare_probe_repo "$repo"
  unset PREREG_SANDBOX_SCRATCH PREREG_SANDBOX_REPO PREREG_STEWARD_SOCK PREREG_STEWARD_PID || true
  export PREREG_ARM="$arm"
  if [ "$arm" = "B" ]; then
    prepare_probe_arm_b "$repo" "$mode"
    if sandbox_boundary_active; then
      allocate_sandbox_scratch >/dev/null
      PREREG_SANDBOX_REPO="$repo"
      export PREREG_SANDBOX_REPO
    fi
    start_steward_daemon "$repo" "$session/steward.log"
  else
    unset PREREG_BOUNDARY || true
  fi
  write_probe_prompt "$arm" "$session/prompt.txt"
  local base_sha=""
  if [ "$arm" = "A" ]; then
    base_sha="$(git -C "$repo" rev-parse HEAD)"
  fi
  echo "real-model arm=${arm} mode=${mode:-none}"
  (
    launch_codex "$session" "$session/prompt.txt" "$repo"
  ) &
  local child=$!
  wait_for_launch "$child" "arm=${arm} mode=${mode:-none}"
  assert_captured_patch "$session" "arm=${arm} mode=${mode:-none}"
  if [ "$arm" = "B" ]; then
    python3 - "$repo/note.txt" "$repo/.prereg-smoke/steward-writes.jsonl" <<'PY'
import json, pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
log = pathlib.Path(sys.argv[2])
if text != "new\n":
    raise SystemExit(f"atm-write did not update note.txt: {text!r}")
if not log.is_file():
    raise SystemExit("missing steward-writes.jsonl")
accepted = False
for line in log.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    if row.get("decision") == "accepted" and row.get("terminal") == "committed":
        accepted = True
if not accepted:
    raise SystemExit("steward log has no accepted write")
PY
    release_worktree "$repo" || true
    release_sandbox_scratch "${PREREG_SANDBOX_SCRATCH:-}" || true
    unset PREREG_SANDBOX_SCRATCH PREREG_SANDBOX_REPO || true
  else
    python3 - "$repo" "$base_sha" <<'PY'
import pathlib, subprocess, sys
repo = pathlib.Path(sys.argv[1])
base = sys.argv[2]
text = (repo / "note.txt").read_text(encoding="utf-8")
if text != "new\n":
    raise SystemExit(f"arm A did not edit note.txt: {text!r}")
head = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
if not head or head == base:
    raise SystemExit(f"arm A git commit did not move HEAD ({base} -> {head})")
shown = subprocess.check_output(["git", "-C", str(repo), "show", "HEAD:note.txt"], text=True)
if shown != "new\n":
    raise SystemExit(f"arm A commit does not contain note.txt: {shown!r}")
PY
  fi
  echo "real-model ok arm=${arm} mode=${mode:-none}"
}

if [ "${PREREG_PROBE_PREPARE_ONLY:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "${PREFLIGHT_REAL_MODEL:-}" != "1" ]; then
  echo "skipped real-model: set PREFLIGHT_REAL_MODEL=1 to run a real codex exec in the selected boundary mode"
  exit 0
fi

command -v codex >/dev/null 2>&1 || die "PREFLIGHT_REAL_MODEL=1 但 codex 不在 PATH。"
if ! codex login status >/dev/null 2>&1; then
  die "PREFLIGHT_REAL_MODEL=1 但 codex 沒有登入。不印出 auth.json。"
fi
unset PREREG_SMOKE_CODEX || true

CLEAN_DIRS=()
trap cleanup_real EXIT

select_run_boundary
SELECTED_BOUNDARY="${PREREG_BOUNDARY:-}"
[ -n "$SELECTED_BOUNDARY" ] || die "PREFLIGHT_REAL_MODEL=1 但沒有選到邊界模式。"
echo "real-model boundary=${SELECTED_BOUNDARY}"
run_real_exec A ""
run_real_exec B "$SELECTED_BOUNDARY"
echo "real-model ok"

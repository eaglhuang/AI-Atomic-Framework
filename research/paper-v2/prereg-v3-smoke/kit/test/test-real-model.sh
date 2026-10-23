#!/bin/bash
# 選擇性的真實模型探測。預設跳過，不呼叫 Codex。
# PREFLIGHT_REAL_MODEL=1 probes only the selected boundary; a missing BEGIN marker permits one retry per arm.
# PREREG_BOUNDARY can override that selection. Each arm has at most two total attempts.
# Arm B 必須經 steward 把 atm-write 叫成功，capture 要從真實 stdout 抽出 patch。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

persist_probe_attempt() {
  [ -n "${PROBE_EVIDENCE_SESSION:-}" ] || return 0
  local name dest="$PREREG_PREFLIGHT_RUN_DIR/arm-$PROBE_EVIDENCE_ARM/attempt-$PROBE_EVIDENCE_ATTEMPT"
  mkdir -p "$dest"
  for name in prompt.txt stdout.jsonl stderr.txt intended.patch probe-result.json started-at ended-at exit-code launch-env.txt codex-argv.txt QUOTA_STOP WAIT_FAILED attempt.log; do
    [ ! -f "$PROBE_EVIDENCE_SESSION/$name" ] || cp "$PROBE_EVIDENCE_SESSION/$name" "$dest/$name"
  done
}

flush_probe_log() {
  if [ -n "${PROBE_LOG_FILE:-}" ]; then
    cat "$PROBE_LOG_FILE" >&"$PROBE_LOG_STDOUT"
    exec {PROBE_LOG_STDOUT}>&-
    unset PROBE_LOG_FILE PROBE_LOG_STDOUT
  fi
}

cleanup_real() {
  persist_probe_attempt
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
  flush_probe_log
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

# Launcher-side git on a probe repo. Under unix-user, Arm B's repo is owned by
# prereg-steward from own_worktree until finish_probe_steward releases it. Plain
# git as the launcher then refuses it ("dubious ownership"); the session env's
# safe.directory does not reach launcher-side calls. Trust exactly this repo, for
# this one command only; never write global git config.
probe_git() {
  local repo="$1"; shift
  git -c safe.directory="$repo" -C "$repo" "$@"
}

prepare_probe_repo() {
  local repo="$1"
  git init -q "$repo"
  printf 'old\n' > "$repo/note.txt"
  git -C "$repo" add note.txt
  git -C "$repo" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
  mkdir -p "$repo/.prereg-smoke"
}

# 與正式 Arm B 相同：公開 CLI 0.1.22 確認之後才寫 session-write.json，沒有 claim 退路。
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
      echo "real codex exec exceeded ${limit}s (${label})" >&2
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$child" 2>/dev/null || true
}

# release_worktree already stops the worker and launcher. Verify that its
# best-effort stop really completed before a retry can replace their ownership.
finish_probe_steward() {
  local repo="$1" launcher="${PREREG_STEWARD_PID:-}" worker="" pid tick alive
  if [ -f "$repo/.prereg-smoke/daemon.pid" ]; then
    worker="$(cat "$repo/.prereg-smoke/daemon.pid")"
  fi
  release_worktree "$repo" || die 'steward-cleanup-failed: worktree release failed; no retry'
  for pid in "$worker" "$launcher"; do
    [ -n "$pid" ] || continue
    alive=1
    for tick in {1..20}; do
      if [ "${PREREG_BOUNDARY:-}" = "unix-user" ]; then
        as_root kill -0 "$pid" >/dev/null 2>&1 || alive=0
      else
        kill -0 "$pid" 2>/dev/null || alive=0
      fi
      [ "$alive" = 1 ] || break
      sleep 0.1
    done
    if [ "$alive" = 1 ]; then
      # Keep a live owner for EXIT cleanup; never discard it for the next probe.
      export PREREG_STEWARD_PID="${launcher:-$pid}"
      die "steward-cleanup-failed: PID ${pid} is still running; no retry"
    fi
  done
  unset PREREG_STEWARD_PID PREREG_STEWARD_SOCK || true
}

run_real_attempt() {
  local arm="$1" mode="$2" attempt="$3"
  local repo session
  if [ "$arm" = "B" ] && { [ "$mode" = "codex-landlock" ] || [ "$mode" = "bwrap-ro" ]; }; then
    repo="$(mktemp -d "${PREREG_TEMP_ROOT:-${HOME}}/prereg-real.XXXXXX")"
  else
    repo="$(mktemp -d)"
  fi
  session="$(mktemp -d)"
  track_dir "$repo"
  track_dir "$session"
  PROBE_EVIDENCE_SESSION="$session"
  PROBE_EVIDENCE_ARM="$arm"
  PROBE_EVIDENCE_ATTEMPT="$attempt"
  export PREREG_SESSION_SLOT="probe-${arm}-${attempt}"
  prepare_probe_repo "$repo"
  export PREREG_SESSION_BASE_COMMIT="$(/usr/bin/git -c safe.directory='*' -C "$repo" rev-parse HEAD)"
  [ -z "${PREREG_STEWARD_PID:-}" ] || die 'steward-cleanup-failed: previous attempt still owns a PID; no retry'
  unset PREREG_SANDBOX_SCRATCH PREREG_SANDBOX_REPO PREREG_STEWARD_SOCK || true
  export PREREG_ARM="$arm"
  install_arm_git_bin "$arm" "$session/bin"
  export PREREG_ARM_BIN="$session/bin"
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
  # Codex 的 bash -lc 會吃掉 env -i 的 PATH。探測在呼叫模型之前先確認兩臂的 python、
  # atm-write 與 git 仍解析到 kit。對不上就失敗，不繼續。
  echo "probe attempt=${attempt} arm=${arm} phase=path-check model_started=false"
  if ! (PREREG_SMOKE_CODEX=1 assert_session_login_path "$session" "$repo"); then
    echo "probe attempt=${attempt} arm=${arm} reason=path-resolution changed=false committed=false model_started=false"
    printf '{"attempt":%s,"arm":"%s","reason":"path-resolution","model_started":false}\n' "$attempt" "$arm" > "$session/probe-result.json"
    persist_probe_attempt
    die 'probe PATH resolution failed; no retry'
  fi
  unset PREREG_SMOKE_CODEX || true
  local base_sha=""
  base_sha="$(probe_git "$repo" rev-parse HEAD)"
  echo "real-model arm=${arm} mode=${mode:-none}"
  (
    launch_codex "$session" "$session/prompt.txt" "$repo"
  ) &
  local child=$!
  local wait_status=0
  wait_for_launch "$child" "arm=${arm} mode=${mode:-none}" || wait_status=$?
  [ "$wait_status" = 0 ] || printf '%s\n' "$wait_status" > "$session/WAIT_FAILED"
  inspect_probe_attempt "$arm" "$repo" "$session" "$base_sha" "$attempt"
  local reason
  reason="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["reason"])' "$session/probe-result.json")"
  persist_probe_attempt
  case "$reason" in
    ok) PROBE_RETRY_NEEDED=0 ;;
    missing-begin-marker) PROBE_RETRY_NEEDED=1 ;;
    *) die "probe failed: ${reason}; no retry" ;;
  esac
  if [ "$arm" = "B" ]; then
    finish_probe_steward "$repo"
    release_sandbox_scratch "${PREREG_SANDBOX_SCRATCH:-}" || true
    unset PREREG_SANDBOX_SCRATCH PREREG_SANDBOX_REPO || true
  fi
}

inspect_probe_attempt() {
  python3 - "$@" <<'PYPROBE'
import json, pathlib, subprocess, sys
arm, repo, session, base, attempt = sys.argv[1:]
repo, session = pathlib.Path(repo), pathlib.Path(session)
# The repo may still be owned by prereg-steward (unix-user); trust only this path, only per call.
GIT = ["git", "-c", f"safe.directory={repo}", "-C", str(repo)]
def git(*args):
    return subprocess.check_output([*GIT, *args], text=True).strip()
try: head = git("rev-parse", "HEAD")
except subprocess.CalledProcessError: head = None
changed = not (repo / "note.txt").is_file() or (repo / "note.txt").read_text() != "old\n"
committed = head is not None and head != base
rows = []
log = repo / ".prereg-smoke/steward-writes.jsonl"
evidence_error = False
if log.is_file():
    try: rows = [json.loads(line) for line in log.read_text().splitlines() if line.strip()]
    except json.JSONDecodeError: evidence_error = True
accepted = any(row.get("decision") == "accepted" and row.get("terminal") == "committed" for row in rows)
chunks = []
def walk(value):
    if isinstance(value, dict):
        if value.get("type") in {"agent_message", "stub.intended_patch"} and isinstance(value.get("text"), str):
            chunks.append(value["text"])
        for child in value.values(): walk(child)
    elif isinstance(value, list):
        for child in value: walk(child)
stdout = session / "stdout.jsonl"
for line in (stdout.read_text() if stdout.is_file() else "").splitlines():
    try: walk(json.loads(line))
    except json.JSONDecodeError: chunks.append(line)
text = "\n".join(chunks)
lines = text.splitlines()
begins = [i for i, line in enumerate(lines) if line == "BEGIN_INTENDED_PATCH"]
ends = [i for i, line in enumerate(lines) if line == "END_INTENDED_PATCH"]
ordered_pair = len(begins) == len(ends) == 1 and begins[0] < ends[0]
if (session / "WAIT_FAILED").exists(): reason = "launch-wait-failed"
elif (session / "QUOTA_STOP").exists(): reason = "quota"
elif not (session / "exit-code").is_file(): reason = "model-start-failed"
elif (session / "exit-code").read_text().strip() != "0": reason = "model-exit"
elif not (repo / "note.txt").is_file() or (repo / "note.txt").read_text() != "new\n": reason = "write-missing"
elif arm == "A" and (not committed or git("show", "HEAD:note.txt") != "new"): reason = "a-no-commit"
elif arm == "B" and (evidence_error or not accepted): reason = "b-no-accepted-write"
elif "BEGIN_INTENDED_PATCH" not in text: reason = "missing-begin-marker"
elif not ordered_pair or not (session / "intended.patch").is_file(): reason = "malformed-patch"
elif subprocess.run([*GIT, "apply", "--reverse", "--check", str(session / "intended.patch")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0: reason = "malformed-patch"
else: reason = "ok"
record = dict(attempt=int(attempt), arm=arm, reason=reason, changed=changed, committed=committed, steward_accepted=accepted, model_started=True)
(session / "probe-result.json").write_text(json.dumps(record) + "\n")
print("probe-result " + json.dumps(record, sort_keys=True), flush=True)
PYPROBE
}

run_real_exec() {
  local arm="$1" mode="$2" attempt
  init_preflight_evidence
  for attempt in 1 2; do
    PROBE_RETRY_NEEDED=0
    mkdir -p "$PREREG_PREFLIGHT_RUN_DIR/arm-$arm/attempt-$attempt"
    PROBE_LOG_FILE="$PREREG_PREFLIGHT_RUN_DIR/arm-$arm/attempt-$attempt/attempt.log"
    exec {PROBE_LOG_STDOUT}>&1
    run_real_attempt "$arm" "$mode" "$attempt" > "$PROBE_LOG_FILE" 2>&1
    flush_probe_log
    if [ "$PROBE_RETRY_NEEDED" = "0" ]; then
      echo "real-model ok arm=${arm} mode=${mode:-none} attempt=${attempt}"
      return 0
    fi
  done
  die "probe missing BEGIN_INTENDED_PATCH after 2 attempts; no third attempt"
}

if [ "${PREREG_PROBE_PREPARE_ONLY:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "${PREFLIGHT_REAL_MODEL:-}" != "1" ]; then
  echo "skipped real-model: set PREFLIGHT_REAL_MODEL=1 to run a real codex exec in the selected boundary mode"
  exit 0
fi

init_preflight_evidence
require_probe_python
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

#!/bin/bash
# Offline probe driver test. All provider, auth and steward operations are fakes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PREREG_PROBE_PREPARE_ONLY=1 source "$HERE/test/test-real-model.sh"
BASE="$(mktemp -d)"
cleanup_test() {
  if [ -f "$BASE/steward.pids" ]; then
    while IFS= read -r pid; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done < "$BASE/steward.pids"
  fi
  if [ -n "${PREREG_PROBE_EVIDENCE_EXPORT:-}" ] && [ -d "$BASE/preflight" ]; then
    mkdir -p "$PREREG_PROBE_EVIDENCE_EXPORT"
    cp -R "$BASE/preflight/." "$PREREG_PROBE_EVIDENCE_EXPORT/"
  fi
  rm -rf "$BASE"
}
trap cleanup_test EXIT
export PREREG_PREFLIGHT_LOG_ROOT="$BASE/preflight"
unset PREREG_PREFLIGHT_RUN_DIR || true
mkdir -p "$BASE/provider" "$BASE/venv/bin"
REAL_PYTHON="$(command -v python3)"
ln -s "$REAL_PYTHON" "$BASE/venv/bin/python"
ln -s "$REAL_PYTHON" "$BASE/venv/bin/python3"
export PREREG_PYTHON="$BASE/venv/bin/python"
cat > "$BASE/provider/codex" <<'FAKE'
#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = exec ] && [ "${2:-}" = --help ]; then
  echo '--ignore-user-config --ignore-rules --sandbox --json --model -C'
  exit 0
fi
if [ "${1:-}" != exec ]; then
  echo unexpected-command >> "$root/unexpected"
  exit 99
fi
n="$(cat "$root/count")"; n=$((n + 1)); echo "$n" > "$root/count"
scenario="$(cat "$root/scenario")"
cat >/dev/null
if [ "$scenario" = model-exit ]; then echo failed; exit 2; fi
if [ "$scenario" = quota ]; then echo 'usage limit'; exit 0; fi
printf 'new\n' > note.txt
if [ "$scenario" != no-commit ]; then
  /usr/bin/git add note.txt
  /usr/bin/git commit -q -m probe
fi
if [ "$scenario" != no-accepted ]; then
  printf '%s\n' '{"decision":"accepted","terminal":"committed"}' > .prereg-smoke/steward-writes.jsonl
fi
if [ "$scenario" = no-commit ] || [ "$scenario" = no-accepted ] || [ "$scenario" = always-missing ] || { [ "$scenario" = missing-first ] && [ "$n" = 1 ]; }; then
  echo '{"type":"agent_message","text":"finished without markers"}'
elif [ "$scenario" = reversed-markers ]; then
  echo '{"type":"agent_message","text":"done\nEND_INTENDED_PATCH\nBEGIN_INTENDED_PATCH\ndiff --git a/note.txt b/note.txt\n--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new"}'
elif [ "$scenario" = duplicate-markers ]; then
  echo '{"type":"agent_message","text":"BEGIN_INTENDED_PATCH\ndiff --git a/note.txt b/note.txt\nEND_INTENDED_PATCH\nBEGIN_INTENDED_PATCH\ndiff --git a/note.txt b/note.txt\nEND_INTENDED_PATCH"}'
elif [ "$scenario" = malformed-body ]; then
  echo '{"type":"agent_message","text":"BEGIN_INTENDED_PATCH\ndiff --git nonsense\nEND_INTENDED_PATCH"}'
elif [ "$scenario" = malformed ]; then
  echo '{"type":"agent_message","text":"BEGIN_INTENDED_PATCH invalid"}'
else
  echo '{"type":"agent_message","text":"BEGIN_INTENDED_PATCH\ndiff --git a/note.txt b/note.txt\n--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\nEND_INTENDED_PATCH"}'
fi
FAKE
chmod +x "$BASE/provider/codex"
export PATH="$BASE/provider:$PATH"
# No auth copying, sandbox configuration or real steward operation in this test.
prepare_session_codex_home() { PREREG_SESSION_CODEX_HOME="$BASE/empty-auth"; export PREREG_SESSION_CODEX_HOME; }
release_session_codex_home() { :; }
expose_evaluator_python() { :; }
run_as_session() { "$@"; }
prepare_probe_arm_b() { export PREREG_ARM=B; }
start_steward_daemon() {
  local pid
  if [ -f "$BASE/steward.pids" ]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then die 'prior-steward-still-running'; fi
    done < "$BASE/steward.pids"
  fi
  # Simulate both the launcher PID and the worker daemon.pid, but use the real
  # release_worktree/stop_steward_pid functions. No socket, auth or ATM process.
  /usr/bin/sleep 300 &
  pid=$!
  printf '%s\n' "$pid" > "$1/.prereg-smoke/daemon.pid"
  printf '%s\n' "$pid" >> "$BASE/steward.pids"
  /usr/bin/sleep 300 &
  export PREREG_STEWARD_PID=$!
  printf '%s\n' "$PREREG_STEWARD_PID" >> "$BASE/steward.pids"
}
release_sandbox_scratch() { :; }
sandbox_boundary_active() { return 1; }
wait_for_launch() { wait "$1"; }

run_case() {
  local arm="$1" scenario="$2" expected_count="$3" expected_reason="$4" expected_status="$5"
  echo 0 > "$BASE/provider/count"
  echo "$scenario" > "$BASE/provider/scenario"
  local log="$BASE/$arm-$scenario.log" status=0
  set +e
  (
    set -e
    CLEAN_DIRS=()
    trap cleanup_real EXIT
    run_real_exec "$arm" ''
  ) >"$log" 2>&1
  status=$?
  set -e
  [ "$(cat "$BASE/provider/count")" = "$expected_count" ] || { cat "$log"; return 1; }
  [ "$status" = "$expected_status" ] || { cat "$log"; return 1; }
  grep -q "\"reason\": \"$expected_reason\"" "$log" || { cat "$log"; return 1; }
  [ "$(grep -c '^probe-result ' "$log")" = "$expected_count" ]
  if [ "$expected_count" = 2 ]; then
    grep -q '"attempt": 1.*"changed": true.*"committed": true' "$log"
    grep -q '"attempt": 2' "$log"
  fi
  if [ -f "$BASE/steward.pids" ]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then echo "leaked fake steward $pid"; return 1; fi
    done < "$BASE/steward.pids"
  fi
  echo "offline probe $arm $scenario ok (calls=$expected_count)"
}
for arm in A B; do
  run_case "$arm" missing-first 2 ok 0
  run_case "$arm" always-missing 2 missing-begin-marker 1
  run_case "$arm" quota 1 quota 1
  run_case "$arm" model-exit 1 model-exit 1
  run_case "$arm" malformed 1 malformed-patch 1
  run_case "$arm" reversed-markers 1 malformed-patch 1
  run_case "$arm" duplicate-markers 1 malformed-patch 1
  run_case "$arm" malformed-body 1 malformed-patch 1
done
run_case A no-commit 1 a-no-commit 1
run_case B no-accepted 1 b-no-accepted-write 1
# Failure of the real path assertion stops before the first fake exec, in both arms.
for arm in A B; do
  echo 0 > "$BASE/provider/count"
  status=0
  (
    CLEAN_DIRS=()
    trap cleanup_real EXIT
    assert_session_login_path() { return 1; }
    run_real_exec "$arm" ''
  ) > "$BASE/path.log" 2>&1 || status=$?
  [ "$status" = 1 ]
  grep -q 'reason=path-resolution.*model_started=false' "$BASE/path.log"
  [ "$(cat "$BASE/provider/count")" = 0 ]
done

# A failed stop must retain the owner PID and block the second model attempt.
echo 0 > "$BASE/provider/count"
echo missing-first > "$BASE/provider/scenario"
set +e
(
  set -e
  CLEAN_DIRS=()
  cleanup_failed_stop() {
    printf '%s\n' "${PREREG_STEWARD_PID:-missing}" > "$BASE/retained-pid"
    # Test-only emergency cleanup must run in this parent shell so its fake
    # children are reaped even while the production stop function is mocked.
    while IFS= read -r pid; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done < "$BASE/steward.pids"
    cleanup_real
  }
  trap cleanup_failed_stop EXIT
  stop_steward_pid() { :; }
  run_real_exec B ''
) > "$BASE/cleanup-failure.log" 2>&1
status=$?
set -e
[ "$status" = 1 ]
[ "$(cat "$BASE/provider/count")" = 1 ]
grep -q 'steward-cleanup-failed' "$BASE/cleanup-failure.log" || { cat "$BASE/cleanup-failure.log"; exit 1; }
[ "$(cat "$BASE/retained-pid")" = "$(tail -n 1 "$BASE/steward.pids")" ]
while IFS= read -r pid; do
  if kill -0 "$pid" 2>/dev/null; then echo "test fake daemon not reaped: $pid"; exit 1; fi
done < "$BASE/steward.pids"
echo 0 > "$BASE/provider/count"
echo 'offline failed steward stop blocks retry ok'

# Direct preflight entry must reject Python before any Codex/auth invocation.
for python in unset relative /does/not/exist; do
  status=0
  (export PREFLIGHT_REAL_MODEL=1; export PREREG_PYTHON="$python"; [ "$python" != unset ] || unset PREREG_PYTHON; bash "$HERE/preflight.sh") > "$BASE/python-invalid.log" 2>&1 || status=$?
  [ "$status" != 0 ]
  grep -q 'requires PREREG_PYTHON=' "$BASE/python-invalid.log"
done

# Correct-looking paths with an incompatible interpreter fail before Codex too.
mkdir -p "$BASE/incompatible/bin"
printf '#!/bin/sh\nexit 1\n' > "$BASE/incompatible/bin/python"
chmod +x "$BASE/incompatible/bin/python"
ln -s python "$BASE/incompatible/bin/python3"
status=0
PREFLIGHT_REAL_MODEL=1 PREREG_PYTHON="$BASE/incompatible/bin/python" bash "$HERE/preflight.sh" > "$BASE/incompatible.log" 2>&1 || status=$?
[ "$status" = 1 ]
grep -q 'must use CPython 3.8' "$BASE/incompatible.log"
[ "$(cat "$BASE/provider/count")" = 0 ]
[ ! -e "$BASE/provider/unexpected" ]
echo 'probe retry offline ok'

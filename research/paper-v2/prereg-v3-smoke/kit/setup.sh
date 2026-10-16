#!/bin/bash
# Create a pristine work tree at the common base and prove the test runner starts.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
# shellcheck disable=SC1091
source "$HERE/lib/django-venv.sh"

MODE="${PREREG_SMOKE_MODE:-django}"
new_state_root
mkdir -p "$STATE_ROOT"

pick_python() {
  if [ -n "${PREREG_PYTHON:-}" ] && [ -x "${PREREG_PYTHON:-}" ]; then
    printf '%s\n' "$PREREG_PYTHON"
    return
  fi
  local candidate
  for candidate in python3.10 python3.9 python3.8; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return
    fi
  done
  if command -v uv >/dev/null 2>&1; then
    uv python install 3.10
    uv python find 3.10
    return
  fi
  die "Django 3.2 needs CPython 3.8, 3.9, or 3.10. Set PREREG_PYTHON or install uv."
}

mkdir -p "$STATE_ROOT/template"

git_author() {
  git -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost "$@"
}

if [ "$MODE" = "fixture" ]; then
  cp "$HERE/fixture/shared.py" "$HERE/fixture/runtests.py" "$STATE_ROOT/template/"
  (
    cd "$STATE_ROOT/template"
    git init -q
    git add shared.py runtests.py
    git_author commit -q -m "fixture base"
  )
  BASE="$(git -C "$STATE_ROOT/template" rev-parse HEAD)"
  TASKS="${PREREG_TASKS_JSON:-$HERE/fixture/tasks.json}"
  GOLD="$HERE/fixture"
  cat > "$STATE_ROOT/template/prereg-fixture.json" <<< '{"mode":"fixture"}'
  printf 'fixture\n' > "$STATE_ROOT/setup-tests.log"
  PYBIN="$(command -v python3)"
  python3 "$STATE_ROOT/template/runtests.py" --verbosity 2 fixture.tests.MarkerTests.test_session_one > "$STATE_ROOT/setup-tests.out" 2>&1 || true
  grep -q 'test_session_one' "$STATE_ROOT/setup-tests.out" || die "fixture test runner did not start"
else
  TASKS="${PREREG_TASKS_JSON:-$HERE/tasks.json}"
  GOLD="$HERE/gold"
  BASE="$(jq -r '.primary.commonBaseCommit' "$TASKS")"
  [ "$BASE" != "null" ] && [ -n "$BASE" ] || die "tasks.json has no common base"
  if [ -n "${PREREG_OFFLINE_TEMPLATE:-}" ]; then
    git clone --quiet "$PREREG_OFFLINE_TEMPLATE" "$STATE_ROOT/template"
  else
    echo "cloning django at $BASE"
    git clone --filter=blob:none --quiet https://github.com/django/django.git "$STATE_ROOT/template"
    git -C "$STATE_ROOT/template" checkout --force --detach --quiet "$BASE"
  fi
  PY="$(pick_python)"
  if [ -n "${PREREG_OFFLINE_TEMPLATE:-}" ]; then
    "$PY" -m venv --system-site-packages "$STATE_ROOT/venv"
  else
    "$PY" -m venv "$STATE_ROOT/venv"
  fi
  PYBIN="$STATE_ROOT/venv/bin/python"
  # 任務 repo（template，或離線測試給的 worktree）必須裝進 venv。只裝 asgiref 時 import django 會失敗。
  install_task_repo_into_venv "$PYBIN" "$STATE_ROOT/template"
  if [ -z "${PREREG_OFFLINE_TEMPLATE:-}" ]; then
    "$PYBIN" -m pip install -q 'asgiref>=3.3.2' 'pytz' 'sqlparse>=0.2.2'
  fi
  if ! django_venv_preflight "$PYBIN" >"$STATE_ROOT/django-preflight.out" 2>&1; then
    echo "venv 無法 import django，或無法跑過一個最小測試。" >&2
    cat "$STATE_ROOT/django-preflight.out" >&2 || true
    exit 1
  fi
  TEST_LABEL="$(jq -r '.primary.instances[] | select(.instanceId=="django__django-13820") | .FAIL_TO_PASS[0]' "$TASKS")"
  [ "$TEST_LABEL" != "null" ] && [ -n "$TEST_LABEL" ] || die "tasks.json 沒有 django__django-13820 的 FAIL_TO_PASS"
  set +e
  (
    cd "$STATE_ROOT/template"
    "$PYBIN" tests/runtests.py --verbosity 2 --settings=test_sqlite "$TEST_LABEL"
  ) > "$STATE_ROOT/setup-tests.out" 2>&1
  test_rc=$?
  set -e
  cp "$STATE_ROOT/setup-tests.out" "$STATE_ROOT/setup-tests.log"
  printf 'django test runner exit %s\n' "$test_rc" >> "$STATE_ROOT/setup-tests.log"
  if django_runner_failed "$STATE_ROOT/setup-tests.out" "$test_rc"; then
    echo "Django test runner failed (exit $test_rc)." >&2
    tail -n 40 "$STATE_ROOT/setup-tests.out" >&2 || true
    exit 1
  fi
fi

write_env "$STATE_ROOT/env.sh" \
  "KIT_ROOT=$(printf '%q' "$HERE")" \
  "STATE_ROOT=$(printf '%q' "$STATE_ROOT")" \
  "TEMPLATE=$(printf '%q' "$STATE_ROOT/template")" \
  "TASKS_JSON=$(printf '%q' "$TASKS")" \
  "GOLD_ROOT=$(printf '%q' "$GOLD")" \
  "COMMON_BASE=$(printf '%q' "$BASE")" \
  "PREREG_SMOKE_MODE=$(printf '%q' "$MODE")" \
  "PREREG_PYTHON=$(printf '%q' "${PYBIN:-python3}")"

mkdir -p "$KIT_ROOT/state"
printf '%s\n' "${PREREG_RUN_ID:-explicit}" > "$STATE_ROOT/run-id"
printf '%s\n' "$STATE_ROOT" > "$KIT_ROOT/state/CURRENT"
echo "setup ok mode=$MODE base=$BASE run=$(cat "$STATE_ROOT/run-id")"
echo "state: $STATE_ROOT"
echo "test log: $STATE_ROOT/setup-tests.log"

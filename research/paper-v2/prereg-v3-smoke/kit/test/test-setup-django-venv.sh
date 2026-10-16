#!/bin/bash
# 離線：任務 repo 要 pip install -e 進 venv；Django runner 崩潰時 setup 必須非零退出。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/django-venv.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

REPO="$BASE/repo"
mkdir -p "$REPO/django" "$REPO/tests"
printf 'VERSION = (3, 2, 0, "final", 0)\n' > "$REPO/django/__init__.py"
cat > "$REPO/setup.py" <<'PY'
from setuptools import setup
setup(name="django", version="3.2.0", packages=["django"])
PY
cat > "$REPO/tests/runtests.py" <<'PY'
import os
import sys

mode = os.environ.get("PREREG_FAKE_RUNNER", "ok")
if mode == "crash":
    sys.stderr.write("ModuleNotFoundError: No module named 'django'\n")
    sys.stderr.write("RuntimeError: Django module not found, reference tests/README.rst for instructions.\n")
    raise SystemExit(1)
if mode == "fail":
    sys.stdout.write("FAIL: tests.Fake.test_ok\n\nRan 1 test in 0.001s\n\nFAILED (failures=1)\n")
    raise SystemExit(1)
sys.stdout.write("test_ok ... ok\n\nRan 1 test in 0.001s\n\nOK\n")
PY
git -C "$REPO" init -q
git -C "$REPO" add django setup.py tests
git -C "$REPO" -c user.name=prereg -c user.email=prereg@localhost commit -q -m base
HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

TASKS="$BASE/tasks.json"
cat > "$TASKS" <<EOF
{"primary":{"commonBaseCommit":"$HEAD_SHA","instances":[{"instanceId":"django__django-13820","FAIL_TO_PASS":["tests.Fake.test_ok"],"PASS_TO_PASS":[]}]}}
EOF

python3 -m venv --system-site-packages "$BASE/bare"
if "$BASE/bare/bin/python" -c 'import django' >/dev/null 2>&1; then
  echo "bare venv imported django before install" >&2
  exit 1
fi
if django_venv_preflight "$BASE/bare/bin/python" >/dev/null 2>&1; then
  echo "preflight passed before django was installed" >&2
  exit 1
fi
export PREREG_OFFLINE_TEMPLATE="$REPO"
install_task_repo_into_venv "$BASE/bare/bin/python" "$REPO"
django_venv_preflight "$BASE/bare/bin/python" >/dev/null 2>&1

printf '%s\n' "ModuleNotFoundError: No module named 'django'" > "$BASE/crash.out"
if ! django_runner_failed "$BASE/crash.out" 1; then
  echo "missing django was not a runner failure" >&2
  exit 1
fi
printf '%s\n' "Ran 1 test in 0.001s" "OK" > "$BASE/ok.out"
if django_runner_failed "$BASE/ok.out" 0; then
  echo "a completed OK report was treated as a kit crash" >&2
  exit 1
fi
printf '%s\n' "Ran 1 test in 0.001s" "FAILED (failures=1)" > "$BASE/fail.out"
if django_runner_failed "$BASE/fail.out" 1; then
  echo "a completed FAILED report was treated as a kit crash" >&2
  exit 1
fi
printf '%s\n' "Ran 0 tests in 0.001s" "OK" > "$BASE/zero.out"
if ! django_runner_failed "$BASE/zero.out" 0; then
  echo "zero tests were accepted" >&2
  exit 1
fi

export PREREG_SMOKE_MODE=django
export PREREG_TASKS_JSON="$TASKS"
export PREREG_PYTHON="$(command -v python3)"

run_setup() {
  local name="$1"
  local mode="$2"
  export PREREG_FAKE_RUNNER="$mode"
  export PREREG_RUN_ID="django-${name}-$$"
  export PREREG_SMOKE_STATE="$BASE/state-${name}"
  set +e
  bash "$HERE/setup.sh" >"$BASE/setup-${name}.out" 2>"$BASE/setup-${name}.err"
  local status=$?
  set -e
  printf '%s\n' "$status"
}

crash_status="$(run_setup crash crash)"
if [ "$crash_status" -eq 0 ]; then
  echo "setup exited 0 after the Django runner crashed" >&2
  cat "$BASE/setup-crash.err" >&2
  exit 1
fi
grep -q 'Django test runner failed' "$BASE/setup-crash.err"

ok_status="$(run_setup ok ok)"
if [ "$ok_status" -ne 0 ]; then
  echo "setup failed after django imported and the runner started" >&2
  cat "$BASE/setup-ok.err" >&2
  exit 1
fi
"$BASE/state-ok/venv/bin/python" -c 'import django'

fail_status="$(run_setup reported-fail fail)"
if [ "$fail_status" -ne 0 ]; then
  echo "setup treated a completed test failure as a kit crash" >&2
  cat "$BASE/setup-reported-fail.err" >&2
  exit 1
fi
grep -q 'django test runner exit 1' "$BASE/state-reported-fail/setup-tests.log"
echo "django venv preflight ok"

#!/bin/bash
# 離線：任務 repo 要 pip install -e 進 venv；Django runner 崩潰時 setup 必須非零退出。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/django-venv.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

# 沒有 3.8–3.10、也沒有 PREREG_PYTHON 時要明確失敗，不能默默用系統 python3。
mkdir -p "$BASE/nopath"
set +e
(
  PATH="$BASE/nopath"
  unset PREREG_PYTHON
  pick_python
) >"$BASE/pick.out" 2>"$BASE/pick.err"
pick_status=$?
set -e
if [ "$pick_status" -eq 0 ]; then
  echo "pick_python succeeded with no CPython 3.8–3.10 on PATH" >&2
  exit 1
fi
grep -q 'kit-error' "$BASE/pick.err"
grep -q 'CPython 3.8, 3.9, or 3.10' "$BASE/pick.err"
host_py="$(command -v python3)"
got="$(PREREG_PYTHON="$host_py" pick_python)"
[ "$got" = "$host_py" ]

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

# 模擬沒有 setuptools 的 python：空的 wheelhouse、不用 pip 快取，必須是 kit-error。
export PREREG_OFFLINE_TEMPLATE="$REPO"
python3 -m venv "$BASE/nosetup"
nosetup_py="$BASE/nosetup/bin/python"
"$nosetup_py" -m pip uninstall -y setuptools wheel >/dev/null 2>&1 || true
if "$nosetup_py" -c 'import setuptools.build_meta' >/dev/null 2>&1; then
  echo "failed to simulate a python without setuptools" >&2
  exit 1
fi
mkdir -p "$BASE/empty-wheels"
set +e
(
  export PIP_NO_CACHE_DIR=1
  export PREREG_WHEELHOUSE="$BASE/empty-wheels"
  install_task_repo_into_venv "$nosetup_py" "$REPO"
) >"$BASE/nost.out" 2>"$BASE/nost.err"
nost_status=$?
set -e
if [ "$nost_status" -eq 0 ]; then
  echo "missing setuptools was not a kit-error" >&2
  cat "$BASE/nost.err" >&2
  exit 1
fi
grep -q 'kit-error' "$BASE/nost.err"
grep -q 'setuptools' "$BASE/nost.err"

# 有離線 wheel 時，同一個沒有 setuptools 的 venv 必須能裝起來。裝不出 wheel 的環境略過這一段。
stage_offline_wheels() {
  local dest="$1"
  shift
  mkdir -p "$dest"
  local pattern whl py
  for pattern in /usr/share/python-wheels/setuptools-*.whl /usr/share/python-wheels/wheel-*.whl; do
    for whl in $pattern; do
      [ -f "$whl" ] || continue
      cp "$whl" "$dest/"
    done
  done
  for py in "$@"; do
    [ -n "$py" ] && [ -x "$py" ] || continue
    "$py" - "$dest" <<'PY'
import hashlib, base64, pathlib, sys, zipfile
dest = pathlib.Path(sys.argv[1])

def have(name):
    return any(p.name.startswith(name + "-") and p.suffix == ".whl" for p in dest.glob("*.whl"))

def pack(name):
    if have(name):
        return
    try:
        import importlib.metadata as metadata
        dist = metadata.distribution(name)
    except Exception:
        return
    root = pathlib.Path(dist.locate_file(""))
    info = pathlib.Path(str(dist._path))
    if not info.name.endswith(".dist-info"):
        return
    whl = dest / f"{name}-{dist.version}-py3-none-any.whl"
    records = []
    def add(z, src, arc):
        data = src.read_bytes()
        z.writestr(arc, data)
        digest = hashlib.sha256(data).digest()
        b64 = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        records.append(f"{arc},sha256={b64},{len(data)}")
    with zipfile.ZipFile(whl, "w") as z:
        top_file = info / "top_level.txt"
        tops = [ln.strip() for ln in top_file.read_text().splitlines() if ln.strip()] if top_file.is_file() else [name]
        for top in tops:
            src_root = root / top
            if src_root.is_file():
                add(z, src_root, top)
            elif src_root.is_dir():
                for src in src_root.rglob("*"):
                    if not src.is_file() or "__pycache__" in src.parts or src.suffix == ".pyc":
                        continue
                    add(z, src, str(src.relative_to(root)))
        for src in info.iterdir():
            if src.is_file() and src.name != "RECORD":
                add(z, src, f"{info.name}/{src.name}")
        record_arc = f"{info.name}/RECORD"
        z.writestr(record_arc, "\n".join(records + [f"{record_arc},,"]) + "\n")

pack("setuptools")
pack("wheel")
PY
  done
  local setup_whl wheel_whl
  setup_whl="$(echo "$dest"/setuptools-*.whl)"
  wheel_whl="$(echo "$dest"/wheel-*.whl)"
  [ -f "$setup_whl" ] && [ -f "$wheel_whl" ]
}

if stage_offline_wheels "$BASE/wheels" "$(command -v python3)"; then
  python3 -m venv "$BASE/fromwheels"
  from_py="$BASE/fromwheels/bin/python"
  "$from_py" -m pip uninstall -y setuptools wheel >/dev/null 2>&1 || true
  if "$from_py" -c 'import setuptools.build_meta, wheel' >/dev/null 2>&1; then
    echo "wheelhouse venv already had setuptools and wheel" >&2
    exit 1
  fi
  (
    export PIP_NO_CACHE_DIR=1
    export PREREG_WHEELHOUSE="$BASE/wheels"
    install_task_repo_into_venv "$from_py" "$REPO"
  )
  "$from_py" -c 'import django, setuptools.build_meta, wheel'
else
  echo "offline wheelhouse unavailable; skipped editable install from wheels"
fi

unset PREREG_PYTHON
PY="$(pick_python)"
export PREREG_PYTHON="$PY"

"$PY" -m venv --system-site-packages "$BASE/bare"
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

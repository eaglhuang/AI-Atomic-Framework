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

# 收集離線 wheel：解譯器自己的 setuptools（ensurepip 或已安裝的 dist-info）優先，
# 沒有才用 /usr/share/python-wheels。wheel 套件若被放進來，必須連同相依（packaging）一起放。
cat > "$BASE/stage_wheels.py" << 'PY'
import hashlib, base64, pathlib, sys, zipfile

def version_tuple(path):
    parts = pathlib.Path(path).name.split("-")[1].split(".")
    nums = []
    for part in parts:
        num = ""
        for ch in part:
            if ch.isdigit():
                num += ch
            else:
                break
        nums.append(int(num) if num else 0)
    return tuple(nums)

def parse_requires(text):
    names = []
    for line in text.splitlines():
        if not line.startswith("Requires-Dist:"):
            continue
        spec = line.split(":", 1)[1].strip()
        if ";" in spec:
            spec, marker = spec.split(";", 1)
            if "extra" in marker:
                continue
        name = spec.split("[", 1)[0].strip()
        for sep in (" ", ">", "<", "=", "!", "~"):
            name = name.split(sep, 1)[0]
        name = name.strip()
        if name:
            names.append(name)
    return names

def self_check():
    got = parse_requires(
        "Requires-Dist: packaging>=24.0\n"
        "Requires-Dist: packaging >= 24.0\n"
        'Requires-Dist: pytest >= 6 ; extra == "test"\n'
    )
    if got != ["packaging", "packaging"]:
        raise SystemExit(f"requires parser mismatch: {got}")

def have(dest, name):
    return [p for p in dest.glob("*.whl") if p.name.startswith(name + "-")]

def metadata_name(names):
    for name in names:
        if name.count("/") == 1 and name.endswith(".dist-info/METADATA"):
            return name
    return None

def pack_dist(dist, dest):
    root = pathlib.Path(dist.locate_file(""))
    info = pathlib.Path(str(dist._path))
    if not info.name.endswith(".dist-info"):
        return False
    project = dist.metadata["Name"].lower().replace("_", "-")
    whl_path = dest / f"{project}-{dist.version}-py3-none-any.whl"
    if whl_path.exists():
        return True
    rels = []
    if dist.files:
        rels.extend(pathlib.Path(str(rel)) for rel in dist.files)
    else:
        top = info / "top_level.txt"
        tops = [ln.strip() for ln in top.read_text().splitlines() if ln.strip()] if top.is_file() else [project]
        for top_name in tops:
            src_root = root / top_name
            if src_root.is_file():
                rels.append(pathlib.Path(top_name))
            elif src_root.is_dir():
                for src in src_root.rglob("*"):
                    if src.is_file() and "__pycache__" not in src.parts and src.suffix != ".pyc":
                        rels.append(src.relative_to(root))
        for src in info.iterdir():
            if src.is_file() and src.name != "RECORD":
                rels.append(pathlib.Path(info.name) / src.name)
    records = []

    def add(z, src, arc):
        data = src.read_bytes()
        z.writestr(arc, data)
        digest = hashlib.sha256(data).digest()
        b64 = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        records.append(f"{arc},sha256={b64},{len(data)}")

    wrote_meta = False
    with zipfile.ZipFile(whl_path, "w") as z:
        for rel in rels:
            src = root / rel
            arc = rel.as_posix()
            if not src.is_file() or "__pycache__" in src.parts or src.suffix == ".pyc":
                continue
            if arc.endswith("/RECORD") or arc == "RECORD":
                continue
            add(z, src, arc)
            if arc.endswith(".dist-info/METADATA") and arc.count("/") == 1:
                wrote_meta = True
        if wrote_meta:
            record_arc = f"{info.name}/RECORD"
            z.writestr(record_arc, "\n".join(records + [f"{record_arc},,"]) + "\n")
    if not wrote_meta:
        whl_path.unlink(missing_ok=True)
        return False
    return True

def pack_name(name, dest, seen):
    import importlib.metadata as metadata
    if name in seen:
        return
    seen.add(name)
    if have(dest, name):
        for whl in have(dest, name):
            with zipfile.ZipFile(whl) as z:
                meta = metadata_name(z.namelist())
                if meta is None:
                    continue
                for dep in parse_requires(z.read(meta).decode()):
                    pack_name(dep, dest, seen)
        return
    try:
        dist = metadata.distribution(name)
    except metadata.PackageNotFoundError:
        return
    if not pack_dist(dist, dest):
        return
    for dep in parse_requires(dist.read_text("METADATA") or ""):
        pack_name(dep, dest, seen)

def pack_self(dest):
    import ensurepip
    dest.mkdir(parents=True, exist_ok=True)
    bundled = pathlib.Path(ensurepip.__file__).resolve().parent / "_bundled"
    if bundled.is_dir():
        for src in bundled.glob("setuptools-*.whl"):
            target = dest / src.name
            if not target.exists():
                target.write_bytes(src.read_bytes())
    pack_name("setuptools", dest, set())
    pack_name("wheel", dest, set())

def drop_incomplete(dest):
    changed = True
    while changed:
        changed = False
        for whl in list(dest.glob("*.whl")):
            with zipfile.ZipFile(whl) as z:
                meta = metadata_name(z.namelist())
                if meta is None:
                    whl.unlink()
                    changed = True
                    continue
                missing = [dep for dep in parse_requires(z.read(meta).decode()) if not have(dest, dep)]
            if missing:
                whl.unlink()
                changed = True

def assert_closure(dest):
    for whl in dest.glob("*.whl"):
        with zipfile.ZipFile(whl) as z:
            meta = metadata_name(z.namelist())
            if meta is None:
                raise SystemExit(f"{whl.name} has no dist-info METADATA")
            missing = [dep for dep in parse_requires(z.read(meta).decode()) if not have(dest, dep)]
        if missing:
            raise SystemExit(f"{whl.name} is missing {missing}")

def select_setuptools(py_dir, sys_dir, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    py_whls = list(py_dir.glob("setuptools-*.whl"))
    sys_whls = list(sys_dir.glob("setuptools-*.whl"))
    modern = [p for p in py_whls + sys_whls if version_tuple(p) >= (70, 0, 0)]
    if modern:
        chosen = max(modern, key=version_tuple)
    elif py_whls:
        chosen = max(py_whls, key=version_tuple)
    elif sys_whls:
        chosen = max(sys_whls, key=version_tuple)
    else:
        raise SystemExit("no offline setuptools wheel")
    target = out_dir / chosen.name
    if chosen.resolve() != target.resolve():
        target.write_bytes(chosen.read_bytes())
    print(target)

def fake_wheel(dest):
    dest.mkdir(parents=True, exist_ok=True)
    info = "wheel-0.46.1.dist-info"
    meta = "Metadata-Version: 2.1\nName: wheel\nVersion: 0.46.1\nRequires-Dist: packaging>=24.0\n"
    wheel_txt = "Wheel-Version: 1.0\nGenerator: prereg-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    path = dest / "wheel-0.46.1-py3-none-any.whl"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("wheel/__init__.py", "")
        z.writestr(f"{info}/METADATA", meta)
        z.writestr(f"{info}/WHEEL", wheel_txt)
        z.writestr(f"{info}/RECORD", "")
    print(path)

def main():
    cmd = sys.argv[1]
    if cmd == "self-check":
        self_check()
    elif cmd == "pack-self":
        pack_self(pathlib.Path(sys.argv[2]))
    elif cmd == "drop-incomplete":
        drop_incomplete(pathlib.Path(sys.argv[2]))
    elif cmd == "assert-closure":
        assert_closure(pathlib.Path(sys.argv[2]))
    elif cmd == "select-setuptools":
        select_setuptools(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]))
    elif cmd == "fake-wheel":
        fake_wheel(pathlib.Path(sys.argv[2]))
    else:
        raise SystemExit(f"unknown {cmd}")

if __name__ == "__main__":
    main()
PY
python3 "$BASE/stage_wheels.py" self-check

pys=()
for candidate in python3 python3.10 python3.9 python3.8; do
  if path="$(command -v "$candidate" 2>/dev/null)"; then
    pys+=("$path")
  fi
done
mkdir -p "$BASE/from-py" "$BASE/from-sys"
for py in "${pys[@]}"; do
  "$py" "$BASE/stage_wheels.py" pack-self "$BASE/from-py"
done
for whl in /usr/share/python-wheels/setuptools-*.whl; do
  [ -f "$whl" ] || continue
  cp "$whl" "$BASE/from-sys/"
done
python3 "$BASE/stage_wheels.py" drop-incomplete "$BASE/from-py"
python3 "$BASE/stage_wheels.py" assert-closure "$BASE/from-py"
python3 "$BASE/stage_wheels.py" select-setuptools "$BASE/from-py" "$BASE/from-sys" "$BASE/only-setup"

install_offline() {
  local py="$1"
  local links="$2"
  (
    export PIP_NO_CACHE_DIR=1
    export PREREG_WHEELHOUSE="$links"
    install_task_repo_into_venv "$py" "$REPO"
  )
  "$py" -c 'import django, setuptools.build_meta
import importlib.metadata as metadata
metadata.distribution("setuptools")
try:
    wheel_dist = metadata.distribution("wheel")
except metadata.PackageNotFoundError:
    wheel_dist = None
if wheel_dist is not None and "_vendor" not in str(wheel_dist.locate_file("")):
    raise SystemExit("wheel distribution was installed")
'
}

strip_setuptools() {
  local py="$1"
  "$py" -m pip uninstall -y setuptools wheel >/dev/null 2>&1 || true
  if "$py" -c 'import setuptools.build_meta' >/dev/null 2>&1; then
    echo "venv still imports setuptools before the offline install" >&2
    exit 1
  fi
}

# find-links 只有 setuptools：editable install 必須成功，而且不裝 wheel。
python3 -m venv "$BASE/only"
strip_setuptools "$BASE/only/bin/python"
install_offline "$BASE/only/bin/python" "$BASE/only-setup"

# find-links 有 setuptools，加上一個沒有 packaging 的 wheel 0.46。
# 舊的 `pip install setuptools wheel` 會因 packaging>=24.0 失敗；現在只裝 setuptools，必須成功。
mkdir -p "$BASE/broken"
cp "$BASE/only-setup"/setuptools-*.whl "$BASE/broken/"
python3 "$BASE/stage_wheels.py" fake-wheel "$BASE/broken"
if compgen -G "$BASE/broken/packaging-*.whl" >/dev/null; then
  echo "broken wheelhouse unexpectedly contains packaging" >&2
  exit 1
fi
python3 -m venv "$BASE/repro"
strip_setuptools "$BASE/repro/bin/python"
set +e
(
  export PIP_NO_CACHE_DIR=1
  "$BASE/repro/bin/python" -m pip install --disable-pip-version-check --no-index --find-links "$BASE/broken" setuptools wheel
) >"$BASE/repro.out" 2>"$BASE/repro.err"
repro_status=$?
set -e
if [ "$repro_status" -eq 0 ]; then
  echo "wheel without packaging did not reproduce the pip failure" >&2
  exit 1
fi
grep -q 'packaging' "$BASE/repro.err"
python3 -m venv "$BASE/broken-venv"
strip_setuptools "$BASE/broken-venv/bin/python"
install_offline "$BASE/broken-venv/bin/python" "$BASE/broken"

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

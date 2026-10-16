#!/bin/bash
# 把任務 repo 以可編輯方式裝進測試 venv。只供 source。
# 離線假 repo（PREREG_OFFLINE_TEMPLATE）不連 PyPI；正式 Django 仍會安裝相依套件。

# Django 3.2 要用 CPython 3.8–3.10。PREREG_PYTHON 必須是可執行檔路徑。
# 找不到時以非零退出，訊息寫到 stderr，不回退到系統 python3。
pick_python() {
  if [ -n "${PREREG_PYTHON:-}" ] && [ -x "${PREREG_PYTHON}" ]; then
    printf '%s\n' "$PREREG_PYTHON"
    return 0
  fi
  local candidate found
  for candidate in python3.10 python3.9 python3.8; do
    if found="$(command -v "$candidate" 2>/dev/null)" && [ -n "$found" ]; then
      printf '%s\n' "$found"
      return 0
    fi
  done
  if command -v uv >/dev/null 2>&1; then
    uv python install 3.10 >&2
    uv python find 3.10
    return 0
  fi
  echo "prereg-v3-smoke: kit-error: Django 3.2 needs CPython 3.8, 3.9, or 3.10. Set PREREG_PYTHON or install uv." >&2
  exit 1
}

# 離線 editable install 只需要 setuptools。Django 3.2 不用 wheel 套件；
# wheel 0.46 會再要 packaging，離線目錄常常沒有，整次安裝就會失敗。
# 已能 import setuptools.build_meta 就直接過。否則只用 wheelhouse、
# /usr/share/python-wheels 與 pip 快取，不連 PyPI，也不裝相依套件。
# PREREG_WHEELHOUSE 有設時只看那個目錄，不再加系統 wheel 目錄。
ensure_setuptools() {
  local py="$1"
  if "$py" -c 'import setuptools.build_meta' >/dev/null 2>&1; then
    return 0
  fi
  local -a links=()
  if [ -n "${PREREG_WHEELHOUSE:-}" ]; then
    links+=(--find-links "$PREREG_WHEELHOUSE")
  elif [ -d /usr/share/python-wheels ]; then
    links+=(--find-links /usr/share/python-wheels)
  fi
  local log
  log="$(mktemp)"
  if env PIP_FIND_LINKS= PIP_NO_INDEX=1 \
      "$py" -m pip install --disable-pip-version-check --no-index --no-deps "${links[@]}" setuptools >"$log" 2>&1 \
      && "$py" -c 'import setuptools.build_meta' >/dev/null 2>&1; then
    rm -f "$log"
    return 0
  fi
  echo "prereg-v3-smoke: kit-error: venv 缺少 setuptools，離線 wheel／pip 快取無法安裝（無法 import setuptools.build_meta）。" >&2
  cat "$log" >&2 || true
  rm -f "$log"
  return 1
}

install_task_repo_into_venv() {
  local py="$1"
  local repo="$2"
  if [ -n "${PREREG_OFFLINE_TEMPLATE:-}" ]; then
    ensure_setuptools "$py" || return 1
    "$py" -m pip install -q --no-build-isolation -e "$repo"
    return
  fi
  "$py" -m pip install -q -U pip setuptools wheel
  "$py" -m pip install -q -e "$repo"
}

# venv 必須能 import django，並跑過一個不碰資料庫的最小測試。
django_venv_preflight() {
  local py="$1"
  "$py" - <<'PY'
import django
import unittest

class DjangoVenvPreflight(unittest.TestCase):
    def test_django_imports(self):
        if not django.VERSION:
            raise AssertionError("django.VERSION missing")

suite = unittest.defaultTestLoader.loadTestsFromTestCase(DjangoVenvPreflight)
result = unittest.TextTestRunner(verbosity=0).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
PY
}

# 回傳 0 代表 runner 沒有真的跑起來（套件缺失、零筆測試、或非零退出且沒有完成報告）。
# 已印出 Ran N test 與 OK/FAILED 的報告代表 runner 已啟動。
# 未套測試 patch 的 PASS_TO_PASS 是否乾淨，另外看 pass_to_pass_baseline_failed。
django_runner_failed() {
  local out="$1"
  local rc="$2"
  if grep -q "No module named 'django'" "$out" || grep -q "Django module not found" "$out"; then
    return 0
  fi
  if ! grep -Eq 'Ran [1-9][0-9]* test' "$out"; then
    return 0
  fi
  if [ "$rc" -ne 0 ] && ! grep -Eq '^(OK|FAILED)([[:space:]]|$)' "$out"; then
    return 0
  fi
  return 1
}

# 未套測試 patch 的 base 只跑 PASS_TO_PASS，而且必須全過。
# 回傳 0 代表這不是乾淨的基底：runner 沒起來、非零退出、ERROR、errors=、FAILED，或沒有 OK。
# FAIL_TO_PASS 要等金標測試 patch 套上之後才預期失敗，setup 不跑那一組。
pass_to_pass_baseline_failed() {
  local out="$1"
  local rc="$2"
  if django_runner_failed "$out" "$rc"; then
    return 0
  fi
  if [ "$rc" -ne 0 ]; then
    return 0
  fi
  if grep -Eq '^FAILED([[:space:]]|$)' "$out"; then
    return 0
  fi
  if grep -Eq 'errors=' "$out"; then
    return 0
  fi
  if grep -Eq '^ERROR:' "$out"; then
    return 0
  fi
  if ! grep -Eq '^OK([[:space:]]|$)' "$out"; then
    return 0
  fi
  return 1
}

# 與 evaluate.py resolve_test_ids 相同：Django test id，以及 docstring 對照表。
# 對不到 label 的 id 不印出來；評估端會把那種 id 記成 test-id-unmapped。
django_pass_to_pass_labels() {
  local tasks="$1"
  python3 - "$tasks" <<'PY'
import json, re, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
id_map = ((data.get("testIdNormalization") or {}).get("map") or {})
labels = []
seen = set()
for inst in data["primary"]["instances"]:
    for label in inst.get("PASS_TO_PASS") or []:
        text = str(label)
        if " (" in text or text.startswith("test_"):
            match = re.match(r"(.+) \((.+)\)", text)
            resolved = f"{match.group(2)}.{match.group(1)}" if match else text
        elif text in id_map:
            resolved = str(id_map[text])
        else:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        labels.append(resolved)
for label in labels:
    print(label)
PY
}

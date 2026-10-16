#!/bin/bash
# 把任務 repo 以可編輯方式裝進測試 venv。只供 source。
# 離線假 repo（PREREG_OFFLINE_TEMPLATE）不連 PyPI；正式 Django 仍會安裝相依套件。

install_task_repo_into_venv() {
  local py="$1"
  local repo="$2"
  if [ -n "${PREREG_OFFLINE_TEMPLATE:-}" ]; then
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
# 已印出 Ran N test 與 OK/FAILED 的報告代表 runner 已啟動；FAIL_TO_PASS 在基底上失敗不是 kit 崩潰。
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

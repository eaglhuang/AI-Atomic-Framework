#!/bin/bash
# 六項阻斷檢查。任何一項失敗就中止，不啟動真實 A/B。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() {
  local name="$1"
  shift
  echo "== ${name}"
  if "$@"; then
    echo "ok ${name}"
  else
    echo "FAIL ${name}" >&2
    fail=1
  fi
}

static_launchers() {
  if grep -nE 'PREREG_GOLD_PATCH=' "$HERE/lib/run-arm.sh" "$HERE/lib/common.sh"; then
    echo "launcher 仍把 PREREG_GOLD_PATCH 傳進工作階段" >&2
    return 1
  fi
  grep -q 'env -i' "$HERE/lib/common.sh"
  grep -q 'readlink -f' "$HERE/bin/atm-write"
  grep -q 'evidence_missing' "$HERE/bin/evaluate.py"
  grep -q -- '--verbosity", "2"' "$HERE/bin/evaluate.py"
  grep -q 'broker steward apply' "$HERE/bin/atm-write.mjs"
  grep -q '0.1.20' "$HERE/bin/atm-write.mjs"
  if grep -nE 'packages/core/src|shared-compose-inbox' "$HERE/bin/atm-write.mjs"; then
    echo "atm-write 仍直接載入 TypeScript" >&2
    return 1
  fi
  if grep -nE 'taskflow claim|broker claim' "$HERE/lib/run-arm.sh" "$HERE/bin/atm-write.mjs"; then
    echo "Arm B 仍有 claim 退路" >&2
    return 1
  fi
  if grep -nE 'rm[[:space:]]+-rf' "$HERE/setup.sh" "$HERE/lib/run-arm.sh"; then
    echo "setup 或 launcher 仍會刪除 state" >&2
    return 1
  fi
  grep -q 'make_worktree_readonly' "$HERE/lib/run-arm.sh"
  grep -q 'capture_intended_patch' "$HERE/lib/run-arm.sh"
}

echo "== static"
if static_launchers; then
  echo "ok static"
else
  echo "FAIL static" >&2
  fail=1
fi
check parser python3 "$HERE/test/test_evaluate_parser.py"
check evidence python3 "$HERE/test/test_evidence_missing.py"
check no-rm bash "$HERE/test/test-no-rm-state.sh"
check gold bash "$HERE/test/test-gold-isolation.sh"
check atm-write-path bash "$HERE/test/test-atm-write-path.sh"
check readonly-steward bash "$HERE/test/test-arm-b-readonly.sh"
check stub-dry-run bash "$HERE/self-check.sh"

if [ "$fail" -ne 0 ]; then
  echo "preflight failed" >&2
  exit 1
fi
echo "preflight ok"

#!/bin/bash
# preflight 的第一項失敗必須立刻退出，不能繼續後面的檢查。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp)"
ERR="$(mktemp)"
set +e
bash "$HERE/preflight.sh" --fail-fast-self-test >"$OUT" 2>"$ERR"
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "fail-fast self-test exited 0" >&2
  cat "$OUT" "$ERR" >&2
  exit 1
fi
grep -q 'FAIL should-fail' "$ERR"
if grep -q 'reached-next' "$ERR" "$OUT"; then
  echo "preflight continued after the first failure" >&2
  exit 1
fi
rm -f "$OUT" "$ERR"
echo "preflight fail-fast ok"

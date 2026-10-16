#!/bin/bash
# 既有 state 目錄必須原樣留下，setup 不得刪除後重建。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
if grep -nE 'rm[[:space:]]+-rf' "$HERE/setup.sh" "$HERE/lib/run-arm.sh" "$HERE/lib/common.sh"; then
  echo "launcher 仍會刪除 state" >&2
  exit 1
fi
ROOT="$(mktemp -d)/already-there"
mkdir -p "$ROOT"
printf 'keep-me\n' > "$ROOT/canary.txt"
set +e
PREREG_SMOKE_STATE="$ROOT" PREREG_SMOKE_MODE=fixture bash "$HERE/setup.sh" >"$ROOT/setup.out" 2>"$ROOT/setup.err"
RC=$?
set -e
[ "$RC" -ne 0 ]
grep -q 'keep-me' "$ROOT/canary.txt"
grep -q '拒絕刪除' "$ROOT/setup.err"
echo "no-rm state ok"

#!/bin/bash
# 從 arm-b/bin 的 PATH 呼叫 atm-write，必須解析到套件內的 mjs，而不是符號連結旁的空路徑。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(mktemp -d)"
mkdir -p "$ROOT/arm-b/bin"
ln -s "$HERE/bin/atm-write" "$ROOT/arm-b/bin/atm-write"
NODE_BIN="$(dirname "$(command -v node)")"
set +e
OUTPUT="$(PATH="$ROOT/arm-b/bin:${NODE_BIN}:/usr/bin:/bin" atm-write 2>&1)"
RC=$?
set -e
printf '%s\n' "$OUTPUT" | grep -q '"code":"usage"'
printf '%s\n' "$OUTPUT" | grep -q 'atm-write.mjs' && exit 1 || true
if printf '%s\n' "$OUTPUT" | grep -q 'MODULE_NOT_FOUND\|Cannot find module'; then
  echo "$OUTPUT" >&2
  exit 1
fi
[ "$RC" -ne 0 ]
RESOLVED="$(readlink -f "$ROOT/arm-b/bin/atm-write")"
[ "$RESOLVED" = "$HERE/bin/atm-write" ]
echo "atm-write path ok"

#!/bin/bash
# 預先登記的冒煙不追加重疊指定。same-loader-region 才讓兩支 session 改同一個 loader.py 區域。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/overlap-condition.sh"

unset PREREG_OVERLAP_CONDITION
default="$(overlap_condition_note || true)"
if [ -n "$default" ]; then
  echo "unset overlap condition printed a prompt" >&2
  printf '%s\n' "$default" >&2
  exit 1
fi

PREREG_OVERLAP_CONDITION=other
other="$(overlap_condition_note || true)"
if [ -n "$other" ]; then
  echo "unknown overlap condition printed a prompt" >&2
  exit 1
fi

PREREG_OVERLAP_CONDITION=same-loader-region
note="$(overlap_condition_note)"
printf '%s\n' "$note" | grep -q 'not the preregistered smoke'
printf '%s\n' "$note" | grep -q 'django/db/migrations/loader.py lines 88-102'
grep -q 'overlap_condition_note' "$HERE/lib/run-arm.sh"
grep -q 'source "$HERE/lib/overlap-condition.sh"' "$HERE/lib/run-arm.sh"
grep -q 'PREREG_OVERLAP_CONDITION' "$HERE/setup.sh"
grep -q 'same-loader-region' "$HERE/RUNBOOK.md"
echo "overlap condition ok"

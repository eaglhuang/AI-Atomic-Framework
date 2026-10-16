#!/bin/bash
# 真實 Codex stdout 把換行跳脫進 JSONL。必須先解析 agent message，才能抽出 intended patch。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

FIXTURE="$HERE/test/fixtures/codex-0.163-agent-message.jsonl"
[ -f "$FIXTURE" ]
python3 - "$FIXTURE" <<'PY'
import sys
raw = open(sys.argv[1], encoding="utf-8").read()
if "BEGIN_INTENDED_PATCH\n" in raw:
    raise SystemExit("fixture still has a literal newline after the marker; it is not the JSONL escape")
if "BEGIN_INTENDED_PATCH\\n" not in raw:
    raise SystemExit("fixture is missing the escaped marker")
PY

BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
mkdir -p "$BASE/session"
cp "$FIXTURE" "$BASE/session/stdout.jsonl"
capture_intended_patch "$BASE/session"
[ -s "$BASE/session/intended.patch" ]
grep -q 'diff --git ' "$BASE/session/intended.patch"
if grep -q 'BEGIN_INTENDED_PATCH' "$BASE/session/intended.patch"; then
  echo "intended patch still contains the marker" >&2
  exit 1
fi
python3 - "$BASE/session/intended.patch" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
if "\\n" in text.split("diff --git ", 1)[0]:
    raise SystemExit("patch still has a JSON escape before the diff")
if not text.endswith("\n"):
    raise SystemExit("patch missing trailing newline")
PY
echo "capture intended patch ok"

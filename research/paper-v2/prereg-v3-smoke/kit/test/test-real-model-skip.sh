#!/bin/bash
# 沒設 PREFLIGHT_REAL_MODEL=1 時不得呼叫 codex。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
cat > "$BASE/codex" <<'EOF'
#!/bin/bash
echo invoked > "${CODEX_INVOKED:?}"
exit 99
EOF
chmod +x "$BASE/codex"
export CODEX_INVOKED="$BASE/invoked"
export PATH="$BASE:${PATH}"
unset PREFLIGHT_REAL_MODEL || true
out="$(bash "$HERE/test/test-real-model.sh")"
printf '%s\n' "$out" | grep -q 'skipped real-model'
[ ! -f "$CODEX_INVOKED" ]
echo "real-model skip ok"

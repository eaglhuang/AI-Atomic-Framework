#!/bin/bash
# seal 只複製允許清單，登入檔與密鑰樣式不能進入封存。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

write_state() {
  local root="$1"
  mkdir -p "$root/arm-a/session-1" "$root/arm-b/session-1" "$root/arm-b/session-2"
  cat > "$root/env.sh" <<'EOF'
export COMMON_BASE=abc123
export PREREG_SMOKE_MODE=fixture
EOF
  printf '%s\n' '{"status":"ok"}' > "$root/results.json"
  printf 'prompt\n' > "$root/arm-a/session-1/prompt.txt"
  printf 'prompt\n' > "$root/arm-b/session-1/prompt.txt"
  printf 'alpha\n' > "$root/arm-a/session-1/stdout.jsonl"
}

# 乾淨的 session 可以封存。session 裡的 auth.json 不在允許清單，不能被複製。
CLEAN="$BASE/clean-state"
write_state "$CLEAN"
mkdir -p "$CLEAN/arm-a/session-1/codex-home"
printf 'secret\n' > "$CLEAN/arm-a/session-1/auth.json"
printf 'secret\n' > "$CLEAN/arm-a/session-1/codex-home/auth.json"
export PREREG_SMOKE_STATE="$CLEAN"
export PREREG_SMOKE_MODE=fixture
DEST="$BASE/sealed-clean"
bash "$HERE/seal.sh" --dest "$DEST"
test -f "$DEST/logs/arm-a/session-1/prompt.txt"
if find "$DEST" -name 'auth.json' | grep -q .; then
  echo "sealed archive contains auth.json" >&2
  exit 1
fi
if grep -R -q 'secret' "$DEST"; then
  echo "sealed archive contains the planted secret" >&2
  exit 1
fi

# 允許清單裡的檔案若含登入或金鑰樣式，封存必須中止，而且不能留下目錄。
DIRTY="$BASE/dirty-state"
write_state "$DIRTY"
JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signaturevalue'
printf 'refresh_token=1\nsk-abcdefghijklmnop\n%s\n{"tokens":{"id_token":"x"}}\n' "$JWT" > "$DIRTY/arm-b/session-1/stdout.jsonl"
export PREREG_SMOKE_STATE="$DIRTY"
DIRTY_DEST="$BASE/sealed-dirty"
set +e
bash "$HERE/seal.sh" --dest "$DIRTY_DEST" >"$BASE/dirty.out" 2>"$BASE/dirty.err"
dirty_status=$?
set -e
if [ "$dirty_status" -eq 0 ]; then
  echo "dirty seal succeeded" >&2
  exit 1
fi
if [ -e "$DIRTY_DEST" ]; then
  echo "dirty seal left an archive behind" >&2
  exit 1
fi
grep -q 'seal rejected secrets' "$BASE/dirty.err"
# 拒絕訊息只報樣式名稱與路徑，不印出密文。
if grep -q 'sk-abcdefghijklmnop' "$BASE/dirty.err" "$BASE/dirty.out"; then
  echo "seal printed a secret" >&2
  exit 1
fi
echo "seal allowlist and secret scan ok"

#!/bin/bash
# 公開 CLI 必須正好是 0.1.21。先用已安裝的版本與 npm cache，網路失敗要退避重試後中止。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT
BIN="$BASE/bin"
mkdir -p "$BIN"
GOOD="$BASE/good/atm.mjs"
BAD="$BASE/bad/atm.mjs"
mkdir -p "$(dirname "$GOOD")" "$(dirname "$BAD")"
cat > "$GOOD" <<'EOF'
if (process.argv.includes("--version")) {
  process.stdout.write(JSON.stringify({evidence:{frameworkVersion:"0.1.21"}}) + "\n");
}
EOF
cat > "$BAD" <<'EOF'
if (process.argv.includes("--version")) {
  process.stdout.write(JSON.stringify({evidence:{frameworkVersion:"0.1.20"}}) + "\n");
}
EOF
cat > "$BIN/npm" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${NPM_LOG:?}"
if [ "$1" = "prefix" ] && [ "$2" = "-g" ]; then
  printf '%s\n' "${FAKE_PREFIX:?}"
  exit 0
fi
if [ "$1" = "install" ]; then
  printf '%s\n' "$*" | grep -q -- '--prefer-offline' || exit 2
  printf '%s\n' "$*" | grep -q '@ai-atomic-framework/cli@0.1.21' || exit 2
  count=0
  if [ -f "${NPM_COUNT:?}" ]; then
    count="$(cat "$NPM_COUNT")"
  fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$NPM_COUNT"
  if [ "${NPM_FAIL_NETWORK:-}" = "1" ]; then
    echo "npm error getaddrinfo EAI_AGAIN registry.npmjs.org" >&2
    exit 1
  fi
  if [ "$count" -lt "${NPM_SUCCEED_ON:-1}" ]; then
    echo "npm error getaddrinfo EAI_AGAIN registry.npmjs.org" >&2
    exit 1
  fi
  prefix=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--prefix" ]; then
      prefix="$arg"
    fi
    prev="$arg"
  done
  dest="$prefix/node_modules/@ai-atomic-framework/cli/dist/npm-runtime"
  mkdir -p "$dest"
  cp "${GOOD_CLI:?}" "$dest/atm.mjs"
  exit 0
fi
exit 0
EOF
chmod +x "$BIN/npm"

run_resolve() {
  local label="$1"
  shift
  local out err status
  out="$BASE/$label.out"
  err="$BASE/$label.err"
  set +e
  env -u PREREG_ATM_CLI \
    PREREG_SKIP_CLI_SEED=1 \
    PREREG_NPM_BACKOFF_SECONDS="0 0 0" \
    PREREG_ATM_CLI_ROOT="$BASE/$label-root" \
    PATH="$BIN:$PATH" \
    NPM_LOG="$BASE/npm.log" \
    NPM_COUNT="$BASE/npm.count" \
    FAKE_PREFIX="$BASE/global-prefix" \
    GOOD_CLI="$GOOD" \
    "$@" \
    bash -c 'source "$1"; resolve_public_cli' _ "$HERE/lib/common.sh" >"$out" 2>"$err"
  status=$?
  set -e
  printf '%s\n' "$status"
}

# 全域已經有正好 0.1.21 時，不下載。
rm -f "$BASE/npm.log" "$BASE/npm.count"
global_cli="$BASE/global-prefix/lib/node_modules/@ai-atomic-framework/cli/dist/npm-runtime"
mkdir -p "$global_cli"
cp "$GOOD" "$global_cli/atm.mjs"
status="$(run_resolve global-hit)"
[ "$status" = "0" ]
grep -q "$global_cli/atm.mjs" "$BASE/global-hit.out"
if grep -q '^install ' "$BASE/npm.log"; then
  echo "global 0.1.21 still downloaded" >&2
  exit 1
fi

# 全域若是別的版本，不能採用。網路一直失敗時要報 EAI_AGAIN，而且不印出那支錯誤 CLI。
rm -f "$BASE/npm.log" "$BASE/npm.count"
cp "$BAD" "$global_cli/atm.mjs"
status="$(run_resolve network-fail NPM_FAIL_NETWORK=1)"
[ "$status" != "0" ]
grep -q 'EAI_AGAIN' "$BASE/network-fail.err"
grep -q '不會改用其他版本' "$BASE/network-fail.err"
if grep -q 'atm.mjs' "$BASE/network-fail.out"; then
  echo "network failure returned a cli path" >&2
  exit 1
fi
attempts="$(cat "$BASE/npm.count")"
[ "$attempts" = "3" ]

# 前兩次 DNS 失敗，第三次用 prefer-offline 裝上 0.1.21。
rm -f "$BASE/npm.log" "$BASE/npm.count"
status="$(run_resolve retry NPM_SUCCEED_ON=3)"
[ "$status" = "0" ]
installed="$(cat "$BASE/retry.out")"
version="$(node "$installed" --version | jq -r '.evidence.frameworkVersion')"
[ "$version" = "0.1.21" ]
[ "$(cat "$BASE/npm.count")" = "3" ]
grep -q -- '--prefer-offline' "$BASE/npm.log"

# npm 若裝成別的版本，結果仍要被拒絕。
rm -f "$BASE/npm.log" "$BASE/npm.count"
status="$(run_resolve wrong-version GOOD_CLI="$BAD" NPM_SUCCEED_ON=1)"
[ "$status" != "0" ]
grep -q '拒絕改用其他版本' "$BASE/wrong-version.err"
echo "public cli selection ok"

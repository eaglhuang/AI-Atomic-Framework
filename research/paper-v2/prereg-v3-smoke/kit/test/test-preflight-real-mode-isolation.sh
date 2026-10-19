#!/bin/bash
# Regression for #354: with PREFLIGHT_REAL_MODEL=1 and no Codex login, every offline
# check must pass and preflight must stop at the real-model step without a model call.
# preflight.sh runs it as check real-mode-isolation; the nested run skips that check via
# PREREG_REAL_MODE_ISOLATION_TEST, so it cannot recurse.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "${PREREG_REAL_MODE_ISOLATION_TEST:-}" ]; then
  echo "refusing to recurse" >&2
  exit 1
fi
grep -q 'PREREG_REAL_MODE_ISOLATION_TEST:-' "$HERE/preflight.sh" || { echo "preflight.sh lacks the recursion guard" >&2; exit 1; }
BASE="$(mktemp -d)"
cleanup() { [ "${KEEP_TMP:-}" = "1" ] || rm -rf "$BASE"; }
trap cleanup EXIT
PY="${PREREG_TEST_PYTHON:-$(command -v python3.10 || command -v python3.9 || command -v python3.8 || true)}"
[ -n "$PY" ] || { echo "needs CPython 3.8-3.10 for PREREG_PYTHON" >&2; exit 1; }
"$PY" -m venv "$BASE/venv"
mkdir -p "$BASE/codex-home-empty" "$BASE/preflight-root"
set +e
env -u OPENAI_API_KEY -u CODEX_API_KEY -u PREREG_PREFLIGHT_RUN_DIR -u PREREG_CODEX_AUTH_FILE \
  PREREG_REAL_MODE_ISOLATION_TEST=1 \
  CODEX_HOME="$BASE/codex-home-empty" \
  PREFLIGHT_REAL_MODEL=1 \
  PREREG_PYTHON="$BASE/venv/bin/python" \
  PREREG_PREFLIGHT_LOG_ROOT="$BASE/preflight-root" \
  bash "$HERE/preflight.sh" > "$BASE/preflight.out" 2>&1
status=$?
set -e
fail() { echo "real-mode isolation: $*" >&2; tail -n 40 "$BASE/preflight.out" >&2 || true; exit 1; }
[ "$status" -ne 0 ] || fail "preflight exited 0 without a Codex login"
first_fail="$(grep -m1 '^FAIL ' "$BASE/preflight.out" || true)"
[ "$first_fail" = "FAIL real-model" ] || fail "first failure is '${first_fail:-none}', expected 'FAIL real-model'"
[ "$(grep -c '^FAIL ' "$BASE/preflight.out")" -eq 1 ] || fail "more than one FAIL line"
grep -qx '== real-model' "$BASE/preflight.out" || fail "did not reach the real-model step"
if grep -qx '== real-mode-isolation' "$BASE/preflight.out"; then fail "nested preflight recursed into real-mode-isolation"; fi
grep -Eq 'codex 沒有登入|codex 不在 PATH' "$BASE/preflight.out" || fail "real-model did not stop at the login/PATH gate"
for name in static seal-secrets fail-fast seal-index seal-one-row stub-dry-run preflight-archive; do
  grep -qx "ok ${name}" "$BASE/preflight.out" || fail "offline check ${name} did not pass in real-model mode"
done
mapfile -t runs < <(find "$BASE/preflight-root" -mindepth 1 -maxdepth 1 -type d -name 'run-*')
[ "${#runs[@]}" -eq 1 ] || fail "expected exactly one live preflight run dir, found ${#runs[@]}"
extra="$(find "${runs[0]}" -mindepth 1 -maxdepth 1 ! -name preflight.log ! -name retry-policy.json -printf '%f\n')"
[ -z "$extra" ] || fail "live run dir has unexpected entries (probe evidence?): ${extra}"
grep -q '^== seal-secrets' "${runs[0]}/preflight.log" || fail "live preflight.log missing"
if grep -q '^probe-result\|^real-model arm=' "$BASE/preflight.out"; then
  fail "a model probe started"
fi
echo "real-mode isolation ok: offline checks pass, stopped at real-model gate, no probe"

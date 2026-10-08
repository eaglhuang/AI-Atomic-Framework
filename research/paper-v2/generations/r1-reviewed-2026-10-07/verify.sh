#!/usr/bin/env bash
# READ-ONLY verifier for this generation. Never writes, never regenerates anything.
# Exit 0 only if every file listed in SHA256SUMS exists and matches.
set -u
cd "$(dirname "$0")" || exit 2
if [ ! -s SHA256SUMS ]; then echo "FAIL: SHA256SUMS missing or empty" >&2; exit 2; fi
if ! command -v sha256sum >/dev/null 2>&1; then echo "FAIL: sha256sum not found" >&2; exit 2; fi
n=$(grep -c . SHA256SUMS)
if sha256sum -c --strict --quiet SHA256SUMS; then
  echo "OK: $n files verified (read-only)"
  rc=0
else
  echo "FAIL: missing or changed files above (SHA256SUMS lists $n files)" >&2
  rc=1
fi
# Informational only: files present on disk but not listed (does not change exit code).
extra=$(find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort | LC_ALL=C comm -23 - <(sed -E 's/^[0-9a-f]{64}  \*?//' SHA256SUMS | LC_ALL=C sort))
if [ -n "$extra" ]; then echo "WARN: unlisted files (not part of this generation):"; echo "$extra" | sed 's/^/  /'; fi
exit $rc

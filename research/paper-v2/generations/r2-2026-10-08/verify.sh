#!/bin/sh
# STRICTLY READ-ONLY. Verifies a sealed generation directory against its SHA256SUMS.
# Usage: tools/verify.sh <generation-dir>     (exit 0 only if every listed file exists and matches)
# Never writes, never regenerates fingerprints (sealing is tools/seal.sh, a separate explicit action).
set -u
G="${1:-$(dirname "$0")}"
cd "$G" || exit 2
[ -s SHA256SUMS ] || { echo "FAIL: $G/SHA256SUMS missing or empty" >&2; exit 2; }
n=$(grep -c . SHA256SUMS)
if sha256sum -c --strict --quiet SHA256SUMS; then echo "OK: $n files verified (read-only) in $G"; rc=0
else echo "FAIL: missing or changed files above ($n listed)" >&2; rc=1; fi
# POSIX (works under sh/dash and bash); no temp files: awk reads SHA256SUMS first, then the find listing on stdin.
extra=$(find . -type f ! -name SHA256SUMS -printf '%P\n' | awk 'NR==FNR { sub(/^[0-9a-f]+  \*?/, ""); listed[$0] = 1; next } !($0 in listed)' SHA256SUMS - | LC_ALL=C sort)
[ -n "$extra" ] && { echo "WARN: unlisted files (not part of this generation):"; echo "$extra" | sed 's/^/  /'; }
exit $rc

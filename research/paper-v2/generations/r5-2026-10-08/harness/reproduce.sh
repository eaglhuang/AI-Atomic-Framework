#!/usr/bin/env bash
# r2: reproduce.sh is now a thin dispatcher. The r1 behaviour (verify that silently REWROTE manifest + checksums)
# is removed — see the r1 generation's copy for history. Each sub-command has one job:
#   verify  <generation-dir>   strictly read-only: sha256sum -c --strict SHA256SUMS
#   analyze [OUT_DIR]          rebuild tables / re-score from frozen raw only (raw fingerprinted before/after)
#   rerun   <cell|e4-forensics|matrix ...>   new run ids only; never overwrites
#   seal    <staged-generation-dir>          write MANIFEST.json + SHA256SUMS into a NEW generation (refuses if sealed)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cmd="${1:-}"; shift || true
case "$cmd" in
  verify|analyze|rerun|seal) exec "$ROOT/tools/$cmd.sh" "$@" ;;
  *) sed -n 2,8p "$0"; echo "BANNER: DRAFT evidence — not a win claim."; exit 2 ;;
esac

#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
load_state
python3 "$HERE/bin/evaluate.py"
echo "results: $STATE_ROOT/results.json"

#!/bin/sh
# One-click formal run. Refuses to start without an explicit API budget and the oracle directory.
#   AB_BUDGET_USD=<usd> AB_HIDDEN_DIR=<oracle dir outside this repo> ./run-formal.sh <out-dir>
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${AB_BUDGET_USD:?set AB_BUDGET_USD to the approved API budget in USD}"
: "${AB_HIDDEN_DIR:?set AB_HIDDEN_DIR to the hidden oracle directory (outside this repo)}"
OUT=${1:?usage: run-formal.sh <out-dir>}
command -v claude >/dev/null 2>&1 || { echo "claude CLI not on PATH" >&2; exit 1; }
node "$HERE/run_ab.mjs" run --protocol "$HERE/formal/protocol.json" --out "$OUT"
node "$HERE/run_ab.mjs" report --protocol "$HERE/formal/protocol.json" --out "$OUT"

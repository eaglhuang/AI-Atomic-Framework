#!/bin/sh
# Trial-only HIST-v2 smoke entry. The default is preflight and does not start a run.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../../.." && pwd)
export HIST_V2_REPO_ROOT="$ROOT"
export PYTHONDONTWRITEBYTECODE=1
HARNESS="$ROOT/research/paper-v2/benchmark-harness/hist-v2-harness-v2/src"
CLASSIFIER="$ROOT/research/paper-v2/benchmark-design/hist-v2-classifier-v8/src"
export PYTHONPATH="$HERE/src:$HARNESS:$CLASSIFIER${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m hist_v2_smoke_runbook "$@"

#!/bin/sh
# Trial-only HIST-v2 smoke entry. The default is preflight and does not start a run.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../../.." && pwd)
export HIST_V2_REPO_ROOT="$ROOT"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="$HERE/src${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m hist_v2_smoke_runbook "$@"

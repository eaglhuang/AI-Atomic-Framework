#!/bin/bash
# Pilot operator commands. The pinned kit and scorer are unchanged.
set -euo pipefail
cd /workspace/AI-Atomic-Framework-rel
GEN="$PWD/research/paper-v2/prereg-v3-pilot/2026-10-23-pilot"
SCRATCH="$(cat /workspace/codex-runs/367-pilot-scratch-path)"
export PATH="$SCRATCH/bin:$HOME/.local/node24-latest/bin:$HOME/.local/node22/bin:$HOME/.local/bin:$PATH"
export TMPDIR="$SCRATCH/t" PREREG_TEMP_ROOT="$SCRATCH/t"
export PREREG_STEWARD_SOCK_DIR="$SCRATCH/s"
export PREREG_ATM_CLI="$PWD/.worklogs/public-cli/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs"
export PREREG_PYTHON="$PWD/r13/venv/bin/python"
export PREREG_BOUNDARY=unix-user
export PREREG_PREFLIGHT_LOG_ROOT="$SCRATCH/preflight"
export CODEX_MODEL=gpt-6-luna CODEX_REASONING_EFFORT=medium
export PYTHONDONTWRITEBYTECODE=1
export PIP_CACHE_DIR="$SCRATCH/pip-cache"
unset PREREG_SMOKE_CODEX PREREG_SMOKE_STATE PREREG_OVERLAP_CONDITION
KIT="$PWD/research/paper-v2/prereg-v3-smoke/kit"
step() {
  local name="$1" limit="$2"; shift 2
  date -Ins > "$GEN/logs/$name.started-at"
  set +e
  timeout --signal=TERM --kill-after=15s "$limit" "$@" > "$GEN/logs/$name.log" 2>&1
  local rc=$?
  set -e
  date -Ins > "$GEN/logs/$name.ended-at"
  printf '%s\n' "$rc" > "$GEN/logs/$name.exit-code"
  printf '%s exit=%s\n' "$name" "$rc"
  return "$rc"
}
python3 "$KIT/bin/kit_generation.py" --verify > "$GEN/kit-identity.json"
node "$PREREG_ATM_CLI" --version > "$GEN/cli-identity.json"
step preflight 1740 env PREFLIGHT_REAL_MODEL=1 bash "$KIT/preflight.sh"
export PREREG_SMOKE_STATE="$SCRATCH/state"
export PREREG_RUN_ID=2026-10-23-pilot
step setup 840 bash "$KIT/setup.sh"
step arm-a 1500 bash "$KIT/run_arm_a.sh"
step arm-b 1500 bash "$KIT/run_arm_b.sh"
if step evaluate 840 bash "$KIT/evaluate.sh"; then
  EVAL_RC=0
else
  EVAL_RC=$?
fi
# Preserve scorer output and evidence even when it declares invalidity.
if [ -f "$SCRATCH/state/results.json" ]; then
  step seal 300 bash "$KIT/seal.sh" --dest "$GEN/run"
fi
printf '%s\n' "$EVAL_RC" > "$GEN/logs/scorer-status"
printf '%s\n' 'pilot pipeline complete; no formal runs' > "$GEN/logs/PIPELINE_DONE"

#!/bin/bash
# CODEX_REASONING_EFFORT 必須原樣出現在兩臂的 codex exec 命令列。未設定就省略。非法值要拒絕。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT
unset CODEX_REASONING_EFFORT || true
unset CODEX_MODEL || true

HELP_BLOB=$'Usage: codex exec\n--json\n--skip-git-repo-check\n--ignore-user-config\n--ignore-rules\n--sandbox\n--cd\n--model\n'

collect() {
  local arm="$1"
  local help="$2"
  local -a args=()
  PREREG_ARM="$arm" pinned_codex_exec_args args "$help" /tmp/prereg-work
  printf '%s\n' "${args[@]}"
}

effort_token() {
  printf '%s\n' "$1" | awk -v value="$2" '$0 == "model_reasoning_effort=\"" value "\"" { print; found=1 } END { if (!found) exit 1 }'
}

expect_flag() {
  local arm="$1" value="$2" help="$3"
  local text token_a
  text="$(CODEX_REASONING_EFFORT="$value" collect "$arm" "$help")"
  printf '%s\n' "$text" | grep -qx -- '-c'
  token_a="$(effort_token "$text" "$value")"
  [ "$token_a" = "model_reasoning_effort=\"${value}\"" ]
  printf '%s\n' "$token_a"
}

expect_absent() {
  local arm="$1" help="$2"
  local text
  text="$(collect "$arm" "$help")"
  if printf '%s\n' "$text" | grep -q 'model_reasoning_effort'; then
    echo "arm ${arm} included reasoning effort while unset" >&2
    printf '%s\n' "$text" >&2
    exit 1
  fi
}

for value in minimal low medium high; do
  token_a="$(expect_flag A "$value" "$HELP_BLOB")"
  token_b="$(expect_flag B "$value" "$HELP_BLOB")"
  [ "$token_a" = "$token_b" ]
  token_a="$(expect_flag A "$value" "")"
  token_b="$(expect_flag B "$value" "")"
  [ "$token_a" = "$token_b" ]
done

expect_absent A "$HELP_BLOB"
expect_absent B "$HELP_BLOB"
CODEX_REASONING_EFFORT= expect_absent A ""
CODEX_REASONING_EFFORT= expect_absent B ""
unset CODEX_REASONING_EFFORT

for bad in max xhigh none Minimal HIGH 'medium extra'; do
  set +e
  (
    CODEX_REASONING_EFFORT="$bad" collect A "$HELP_BLOB"
  ) >/dev/null 2>"$BASE/err"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "accepted invalid CODEX_REASONING_EFFORT=${bad}" >&2
    exit 1
  fi
  grep -q 'CODEX_REASONING_EFFORT' "$BASE/err"
done

mkdir -p "$BASE/session" "$BASE/arm-a"
export CODEX_MODEL=fixture-model
export CODEX_REASONING_EFFORT=low
record_model "$BASE/session" "$BASE/arm-a/model.txt"
[ "$(head -n 1 "$BASE/arm-a/model.txt")" = "fixture-model" ]
grep -qx 'reasoning_effort=low' "$BASE/arm-a/model.txt"
unset CODEX_REASONING_EFFORT
record_model "$BASE/session" "$BASE/arm-a/model-unset.txt"
grep -qx 'reasoning_effort=' "$BASE/arm-a/model-unset.txt"

python3 - "$HERE/bin/evaluate.py" "$BASE/arm-a" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("evaluate", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
arm = Path(sys.argv[2])
set_fields = mod.arm_model_fields(arm)
unset = arm / "model-unset.txt"
(arm / "model.txt").write_text((arm / "model.txt").read_text(encoding="utf-8"), encoding="utf-8")
if set_fields != {"model": "fixture-model", "reasoningEffort": "low"}:
    raise SystemExit(f"results fields mismatch: {set_fields}")
saved = (arm / "model.txt").read_text(encoding="utf-8")
(arm / "model.txt").write_text((arm / "model-unset.txt").read_text(encoding="utf-8"), encoding="utf-8")
unset_fields = mod.arm_model_fields(arm)
(arm / "model.txt").write_text(saved, encoding="utf-8")
if unset_fields != {"model": "fixture-model", "reasoningEffort": None}:
    raise SystemExit(f"unset results fields mismatch: {unset_fields}")
payload = {"arms": {"A": set_fields, "B": set_fields}}
blob = json.dumps(payload)
if '"reasoningEffort": "low"' not in blob:
    raise SystemExit(blob)
print("results.json reasoningEffort ok")
PY

echo "reasoning effort ok"

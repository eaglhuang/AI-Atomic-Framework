#!/bin/bash
# 兩筆重疊的即時 diff 必須走 steward socket 與公開 CLI。
# 結果要是帶原因碼的拒絕，不能是套件或 CLI 崩潰。沒做完的任務是 blocked，不是成功。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PREREG_SMOKE_MODE=fixture
export PREREG_SMOKE_CODEX="$HERE/bin/stub-codex.mjs"
export PREREG_TASKS_JSON="$HERE/fixture/tasks-overlap.json"
export PREREG_RUN_ID="overlap-$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
export PREREG_SMOKE_STATE="$HERE/state/runs/${PREREG_RUN_ID}"

bash "$HERE/setup.sh"
set +e
bash "$HERE/run_arm_a.sh"
arm_a=$?
bash "$HERE/run_arm_b.sh"
arm_b=$?
set -e
# 重試用盡時 session 以 3 結束，launcher 會非 0。那不是崩潰。
if [ "$arm_a" -ne 0 ]; then
  echo "arm A 異常退出 $arm_a" >&2
  exit 1
fi

python3 "$HERE/bin/evaluate.py" >"$PREREG_SMOKE_STATE/evaluate.out" 2>"$PREREG_SMOKE_STATE/evaluate.err" || eval_rc=$?
eval_rc=${eval_rc:-0}
python3 - "$PREREG_SMOKE_STATE" "$eval_rc" "$arm_b" <<'PY'
import json, pathlib, sys
state = pathlib.Path(sys.argv[1])
eval_rc = int(sys.argv[2])
arm_b = int(sys.argv[3])
results = json.loads((state / "results.json").read_text(encoding="utf-8"))
assert results["status"] == "blocked", results["status"]
assert eval_rc == 3, eval_rc
arm = results["arms"]["B"]
assert arm["status"] == "blocked", arm["status"]
decisions = arm["steward"]["decisions"]
assert decisions, decisions
assert all(item == "rejected-by-design" for item in decisions), decisions
assert "kit-error" not in decisions
codes = [code for code in arm["steward"]["reasonCodes"] if code]
assert codes and all(code == "steward-final-patch-required" for code in codes), codes
assert arm["steward"]["recomposeOrRetry"] >= 1, arm["steward"]
assert any((row.get("attempt") or 1) >= 2 for row in arm["steward"]["writesDetail"]), arm["steward"]["writesDetail"]
text = (state / "arm-b" / "work" / "shared.py").read_text(encoding="utf-8")
assert "beta\n" in text or text.splitlines()[1] == "beta", text
assert "beta-one" not in text and "beta-two" not in text, text
stdout = "\n".join((state / "arm-b").joinpath(f"session-{slot}/stdout.jsonl").read_text(encoding="utf-8") for slot in (1, 2))
assert "retries-exhausted" in stdout, stdout
assert "stub.kit-error" not in stdout
log = (state / "arm-b" / "steward-daemon.log").read_text(encoding="utf-8", errors="replace")
assert "SyntaxError" not in log and "MODULE_NOT_FOUND" not in log, log[-500:]
print(json.dumps({
    "status": results["status"],
    "evalExit": eval_rc,
    "armBExit": arm_b,
    "decisions": decisions,
    "reasonCodes": codes,
    "writes": arm["steward"]["writes"],
    "recomposeOrRetry": arm["steward"]["recomposeOrRetry"],
    "attempts": sorted({row.get("attempt") for row in arm["steward"]["writesDetail"]}),
}, indent=2))
PY
echo "overlap decision ok"

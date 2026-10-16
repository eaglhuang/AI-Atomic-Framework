#!/bin/bash
# 兩筆重疊的即時 diff 走 steward socket 與公開 CLI apply-live。
# 第一筆先提交。第二筆在碰檔案前被拒絕，重寫後接受。兩個意圖都留下。
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
if [ "$arm_a" -ne 0 ]; then
  echo "arm A 異常退出 $arm_a" >&2
  exit 1
fi
if [ "$arm_b" -ne 0 ]; then
  echo "arm B 異常退出 $arm_b" >&2
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
assert results["status"] == "ok", results["status"]
assert eval_rc == 0, eval_rc
arm = results["arms"]["B"]
assert arm["status"] == "ok", arm["status"]
assert arm["lostEditCount"] == 0, arm["lostEditCount"]
decisions = arm["steward"]["decisions"]
assert decisions[0] == "accepted", decisions
assert "rejected-by-design" in decisions, decisions
assert decisions[-1] == "accepted", decisions
assert "kit-error" not in decisions, decisions
codes = [code for code in arm["steward"]["reasonCodes"] if code]
assert codes == ["overlapping-write-queued"], codes
assert arm["steward"]["recomposeOrRetry"] > 0, arm["steward"]
detail = arm["steward"]["writesDetail"]
assert any((row.get("attempt") or 1) >= 2 and row.get("decision") == "accepted" for row in detail), detail
text = (state / "arm-b" / "work" / "shared.py").read_text(encoding="utf-8")
assert "beta-one" in text and "delta-two" in text, text
assert "beta\n" not in text, text
stdout = "\n".join((state / "arm-b").joinpath(f"session-{slot}/stdout.jsonl").read_text(encoding="utf-8") for slot in (1, 2))
assert "stub.kit-error" not in stdout, stdout
log = (state / "arm-b" / "steward-daemon.log").read_text(encoding="utf-8", errors="replace")
assert "SyntaxError" not in log and "MODULE_NOT_FOUND" not in log, log[-500:]
print(json.dumps({
    "status": results["status"],
    "evalExit": eval_rc,
    "armBExit": arm_b,
    "decisions": decisions,
    "reasonCodes": codes,
    "lostEdits": arm["lostEditCount"],
    "writes": arm["steward"]["writes"],
    "recomposeOrRetry": arm["steward"]["recomposeOrRetry"],
    "attempts": sorted({row.get("attempt") for row in detail}),
    "file": text.splitlines(),
}, indent=2))
PY
echo "overlap decision ok"

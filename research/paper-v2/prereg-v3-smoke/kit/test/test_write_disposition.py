#!/usr/bin/env python3
"""kit-error 使整輪無效；帶原因碼的拒絕且任務沒做完則是 blocked，不是成功。"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
EVALUATE = KIT / "bin" / "evaluate.py"


def git(cwd, *args):
    subprocess.run(["/usr/bin/git", *args], cwd=cwd, check=True, text=True, capture_output=True)


def write_session(arm, slot, patch):
    session = arm / f"session-{slot}"
    session.mkdir(parents=True)
    (session / "intended.patch").write_text(patch, encoding="utf-8")
    (session / "prompt.txt").write_text("fixture\n", encoding="utf-8")
    (session / "exit-code").write_text("0\n", encoding="utf-8")
    (session / "stdout.jsonl").write_text("{}\n", encoding="utf-8")


def build(decision, reason, file_text, intended_line):
    root = Path(tempfile.mkdtemp())
    template = root / "template"
    template.mkdir()
    (template / "shared.py").write_text(file_text, encoding="utf-8")
    git(template, "init", "-q")
    git(template, "add", "shared.py")
    git(template, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = subprocess.run(["/usr/bin/git", "-C", str(template), "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
    tasks = {
        "primary": {
            "instances": [
                {"instanceId": "fixture-session-one", "problemStatement": "one", "FAIL_TO_PASS": [], "PASS_TO_PASS": []},
                {"instanceId": "fixture-session-two", "problemStatement": "two", "FAIL_TO_PASS": [], "PASS_TO_PASS": []},
            ]
        }
    }
    (root / "tasks.json").write_text(json.dumps(tasks), encoding="utf-8")
    patch = f"diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -1 +1 @@\n-alpha\n+{intended_line}\n"
    for name in ("arm-a", "arm-b"):
        arm = root / name
        work = arm / "work"
        subprocess.run(["/usr/bin/git", "clone", "--quiet", str(template), str(work)], check=True)
        write_session(arm, 1, patch)
        write_session(arm, 2, patch)
        (arm / "start-skew-ms").write_text("1\n", encoding="utf-8")
    smoke = root / "arm-b" / "work" / ".prereg-smoke"
    smoke.mkdir()
    row = {
        "ok": decision == "accepted",
        "decision": decision,
        "reasonCode": reason,
        "terminal": "committed" if decision == "accepted" else ("kit-error" if decision == "kit-error" else "blocked"),
        "taskId": "fixture-session-one",
        "actorId": "stub-fixture-session-one",
        "stopReason": reason,
        "retryCount": 0,
        "batchSize": 1,
        "attempt": 1,
    }
    (smoke / "steward-writes.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    env = "\n".join([
        "export KIT_ROOT=" + str(KIT),
        "export STATE_ROOT=" + str(root),
        "export TEMPLATE=" + str(template),
        "export TASKS_JSON=" + str(root / "tasks.json"),
        "export GOLD_ROOT=" + str(KIT / "fixture"),
        "export COMMON_BASE=" + base,
        "export PREREG_SMOKE_MODE=fixture",
        "export PREREG_PYTHON=python3",
        "",
    ])
    (root / "env.sh").write_text(env, encoding="utf-8")
    proc = subprocess.run(["python3", str(EVALUATE)], cwd=root, text=True, capture_output=True, env={**os.environ, "PREREG_SMOKE_STATE": str(root)})
    payload = json.loads((root / "results.json").read_text(encoding="utf-8"))
    return proc.returncode, payload


def main():
    code, payload = build("kit-error", None, "alpha\nbeta\n", "alpha")
    assert code == 4, code
    assert payload["status"] == "invalid", payload["status"]
    assert payload["arms"]["B"]["steward"]["decisions"] == ["kit-error"]
    code, payload = build("rejected-by-design", "steward-final-patch-required", "alpha\nbeta\n", "beta-one")
    assert code == 3, code
    assert payload["status"] == "blocked", payload["status"]
    assert payload["arms"]["B"]["steward"]["decisions"] == ["rejected-by-design"]
    assert payload["status"] != "ok"
    code, payload = build("rejected-by-design", "base-unknown", "alpha\nbeta\n", "beta-one")
    assert code == 3 and payload["status"] == "blocked", (code, payload)
    steward = payload["arms"]["B"]["steward"]
    assert steward["decisions"] == ["rejected-by-design"], steward
    assert steward["rejected"] == 1 and steward["reasonCodes"] == ["base-unknown"], steward
    print("write disposition ok")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""被擋住的意圖修改要對照最終快照計入未完成。重送次數不從拒絕列派生。"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402


def git(cwd, *args):
    subprocess.run(["/usr/bin/git", *args], cwd=cwd, check=True, text=True, capture_output=True)


def test_session_flag_comes_from_steward_file():
    rows = [{
        "decision": "rejected-by-design",
        "terminal": "blocked",
        "reasonCode": "patch-context-mismatch",
        "taskId": "prereg",
        "actorId": "prereg-session",
        "file": "tests/migrations/test_loader.py",
    }]
    assert evaluate.session_rejected(rows, ["tests/migrations/test_loader.py"]) is True
    assert evaluate.session_rejected(rows, ["django/db/migrations/loader.py"]) is False
    assert evaluate.session_rejected(rows, []) is False
    accepted = [{
        "decision": "accepted",
        "terminal": "committed",
        "taskId": "django__django-11141",
        "actorId": "django__django-11141",
        "file": "shared.py",
    }]
    assert evaluate.session_rejected(accepted, ["shared.py"]) is False


def test_rejections_are_not_resubmissions():
    rows = []
    for _ in range(4):
        rows.append({
            "decision": "rejected-by-design",
            "reasonCode": "patch-context-mismatch",
            "terminal": "blocked",
            "retryCount": 0,
            "hashDriftCount": 0,
            "commit": {"headMoves": 0},
        })
    assert sum(1 for row in rows if row.get("terminal") not in (None, "committed")) == 4


def write_session(arm, slot, patch):
    session = arm / f"session-{slot}"
    session.mkdir(parents=True)
    (session / "intended.patch").write_text(patch, encoding="utf-8")
    (session / "prompt.txt").write_text("fixture\n", encoding="utf-8")
    (session / "exit-code").write_text("0\n", encoding="utf-8")
    (session / "stdout.jsonl").write_text("{}\n", encoding="utf-8")


def steward_row(decision, terminal, reason):
    return {
        "ok": decision == "accepted",
        "decision": decision,
        "reasonCode": reason,
        "terminal": terminal,
        "taskId": "prereg",
        "actorId": "prereg-session",
        "file": "shared.py",
        "retryCount": 0,
        "hashDriftCount": 0,
        "commit": {"headMoves": 0, "gitIndexLockWaitMs": 0},
        "attempt": 1,
        "batchSize": 1,
    }


DELETION = (
    "diff --git a/shared.py b/shared.py\n"
    "--- a/shared.py\n"
    "+++ b/shared.py\n"
    "@@ -1,2 +1,1 @@\n"
    " alpha\n"
    "-beta\n"
)
PRESENT = (
    "diff --git a/shared.py b/shared.py\n"
    "--- a/shared.py\n"
    "+++ b/shared.py\n"
    "@@ -1,0 +1,1 @@\n"
    "+alpha\n"
)


def build(file_text):
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
    for name in ("arm-a", "arm-b"):
        arm = root / name
        work = arm / "work"
        subprocess.run(["/usr/bin/git", "clone", "--quiet", str(template), str(work)], check=True)
        write_session(arm, 1, DELETION if name == "arm-b" else PRESENT)
        write_session(arm, 2, PRESENT)
        (arm / "start-skew-ms").write_text("1\n", encoding="utf-8")
    smoke = root / "arm-b" / "work" / ".prereg-smoke"
    smoke.mkdir()
    rows = [steward_row("rejected-by-design", "blocked", "patch-context-mismatch") for _ in range(4)]
    rows.append(steward_row("accepted", "committed", None))
    (smoke / "steward-writes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    env = "\n".join([
        f"export KIT_ROOT={KIT}",
        f"export STATE_ROOT={root}",
        f"export TEMPLATE={template}",
        f"export TASKS_JSON={root / 'tasks.json'}",
        f"export GOLD_ROOT={KIT / 'fixture'}",
        f"export COMMON_BASE={base}",
        "export PREREG_SMOKE_MODE=fixture",
        "export PREREG_PYTHON=python3",
        "",
    ])
    (root / "env.sh").write_text(env, encoding="utf-8")
    proc = subprocess.run(
        ["python3", str(KIT / "bin" / "evaluate.py")],
        cwd=root,
        text=True,
        capture_output=True,
        env={**os.environ, "PREREG_SMOKE_STATE": str(root)},
    )
    payload = json.loads((root / "results.json").read_text(encoding="utf-8"))
    return proc.returncode, payload


def unfinished_count(arm):
    return sum(len(session["unfinishedEdits"]) for session in arm["sessions"])


def main():
    test_session_flag_comes_from_steward_file()
    test_rejections_are_not_resubmissions()
    code, payload = build("alpha\nbeta\n")
    arm = payload["arms"]["B"]
    assert arm["steward"]["rejected"] == 4, arm["steward"]
    assert arm["steward"]["resubmissions"] is None, arm["steward"]
    assert arm["steward"]["recomposeOrRetry"] is None, arm["steward"]
    assert arm["rejectionAttribution"] == "low", arm["rejectionAttribution"]
    assert arm["lostEditCount"] == 0, arm["lostEditCount"]
    assert unfinished_count(arm) >= 1, arm["sessions"]
    assert arm["status"] == "blocked", arm["status"]
    assert all(session["stewardRejected"] is True for session in arm["sessions"]), arm["sessions"]
    assert code == 3, code
    assert payload["status"] == "blocked"
    code, payload = build("alpha\n")
    arm = payload["arms"]["B"]
    assert arm["steward"]["rejected"] == 4, arm["steward"]
    assert arm["steward"]["recomposeOrRetry"] is None, arm["steward"]
    assert arm["lostEditCount"] == 0, arm
    assert unfinished_count(arm) == 0, arm["sessions"]
    assert arm["status"] == "ok", arm["status"]
    assert all(session["stewardRejected"] is True for session in arm["sessions"]), arm["sessions"]
    assert code == 0, (code, payload["status"])
    print("blocked edits ok")


if __name__ == "__main__":
    main()

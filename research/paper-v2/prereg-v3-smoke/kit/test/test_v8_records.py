#!/usr/bin/env python3
"""v8：proposalId 對到該 session 的寫入紀錄。accepted 但雜湊沒變是沉默遺失，不是 steward 拒絕。"""
import json
import subprocess
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402

V8 = Path(__file__).resolve().parent / "fixtures" / "v8" / "arm-b"
FALSE_ACCEPT = "prop-prereg-session-a1-42f989d6ea50"
REAL_REJECT = "prop-prereg-session-a1-bd3b193b64b5"
REAL_ACCEPT = "prop-prereg-session-a1-d4030f3b7969"


def rows():
    return [json.loads(line) for line in (V8 / "steward-writes.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]


def stdout(slot):
    return (V8 / f"session-{slot}" / "stdout.jsonl").read_text(encoding="utf-8")


def test_proposal_ids_stay_in_their_session():
    found = rows()
    assert [row["proposalId"] for row in found] == [FALSE_ACCEPT, REAL_REJECT, REAL_ACCEPT]
    first = evaluate.session_rows_by_proposal(found, stdout(1))
    second = evaluate.session_rows_by_proposal(found, stdout(2))
    assert [row["proposalId"] for row in first] == [FALSE_ACCEPT]
    assert [row["proposalId"] for row in second] == [REAL_REJECT, REAL_ACCEPT]
    false = next(row for row in found if row["proposalId"] == FALSE_ACCEPT)
    assert evaluate.false_accept_row(false) is True
    assert false["declaredBaseHash"] == false["currentFileHash"]
    assert evaluate.false_accept_row(next(row for row in found if row["proposalId"] == REAL_ACCEPT)) is False


def test_false_accept_is_not_a_steward_rejection():
    found = rows()
    intended = {
        "django/db/migrations/loader.py": (V8 / "session-1" / "intended.patch").read_text(encoding="utf-8")
    }
    rejected, confidence = evaluate.rejection_for_session(
        found, ["django/db/migrations/loader.py"], intended, stdout(1)
    )
    assert rejected is False, rejected
    assert confidence == "proposal"
    rejected, confidence = evaluate.rejection_for_session(
        found, ["django/db/migrations/loader.py"], intended, stdout(2)
    )
    assert rejected is True
    assert confidence == "proposal"


def git(cwd, *args):
    subprocess.run(["/usr/bin/git", *args], cwd=cwd, check=True, text=True, capture_output=True)


def test_score_counts_false_accept_as_silent_loss():
    root = Path(tempfile.mkdtemp())
    work = root / "arm-b" / "work"
    file_text = (
        "                # getattr() needed on PY36 and older (replace w/attribute access).\n"
        "                if getattr(module, '__file__', None) is None:\n"
        "                    self.unmigrated_apps.add(app_config.label)\n"
        "                    continue\n"
    )
    target = work / "django/db/migrations/loader.py"
    target.parent.mkdir(parents=True)
    target.write_text(file_text, encoding="utf-8")
    git(work, "init", "-q")
    git(work, "add", "django/db/migrations/loader.py")
    git(work, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = subprocess.run(
        ["/usr/bin/git", "-C", str(work), "rev-parse", "HEAD"],
        check=True, text=True, capture_output=True,
    ).stdout.strip()
    smoke = work / ".prereg-smoke"
    smoke.mkdir()
    (smoke / "steward-writes.jsonl").write_text((V8 / "steward-writes.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
    for slot in (1, 2):
        session = root / "arm-b" / f"session-{slot}"
        session.mkdir()
        source = V8 / f"session-{slot}"
        (session / "stdout.jsonl").write_text(source.joinpath("stdout.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
        (session / "intended.patch").write_text(source.joinpath("intended.patch").read_text(encoding="utf-8"), encoding="utf-8")
        (session / "exit-code").write_text("0\n", encoding="utf-8")
        (session / "prompt.txt").write_text("fixture\n", encoding="utf-8")
    tasks = {
        "primary": {
            "instances": [
                {"instanceId": "django__django-13820", "problemStatement": "one", "FAIL_TO_PASS": [], "PASS_TO_PASS": []},
                {"instanceId": "django__django-11141", "problemStatement": "two", "FAIL_TO_PASS": [], "PASS_TO_PASS": []},
            ]
        }
    }
    arm = evaluate.score_arm("B", root / "arm-b", tasks, base)
    first, second = arm["sessions"]
    assert first["stewardRejected"] is False, first
    assert first["rejectionAttribution"] == "proposal"
    assert first["lostEdits"], first
    assert all(item.get("classified") != "steward-rejected" for item in first["lostEdits"])
    assert arm["silentLostEditCount"] >= 1, arm["silentLostEditCount"]
    assert second["stewardRejected"] is True, second
    assert arm["rejectionAttribution"] == "proposal"


def main():
    test_proposal_ids_stay_in_their_session()
    test_false_accept_is_not_a_steward_rejection()
    test_score_counts_false_accept_as_silent_loss()
    print("v8 records ok")


if __name__ == "__main__":
    main()

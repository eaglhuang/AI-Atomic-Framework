#!/usr/bin/env python3
"""v7 Codex 0.163.0 日誌：index.lock 不計模型句子；重送只算同一份修改被拒絕之後的 atm-write。"""
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402

V7 = Path(__file__).resolve().parent / "fixtures" / "v7"


def command_line(item_id, command, exit_code, output, item_type="command_execution"):
    return json.dumps({
        "type": "item.completed",
        "item": {
            "id": item_id,
            "type": item_type,
            "command": command,
            "aggregated_output": output,
            "exit_code": exit_code,
            "status": "completed" if exit_code in (0, "0") else "failed",
        },
    })


def test_v7_arm_a_index_lock_is_zero():
    assert evaluate.arm_index_lock_count(V7 / "arm-a") == 0
    for slot in (1, 2):
        text = (V7 / "arm-a" / f"session-{slot}" / "stdout.jsonl").read_text(encoding="utf-8")
        assert "index.lock" in text
        assert evaluate.index_lock_count(text) == 0, slot
        assert not any(item["kind"] == "git-add-commit" for item in evaluate.completed_commands(text))


def test_v7_arm_b_resubmissions_follow_rejection():
    """6 筆 steward 寫入。每個 session 的第一筆 atm-write 不是重送，所以重送數小於 6。"""
    assert evaluate.resubmission_count(V7 / "arm-b") == 4
    steward_writes = 0
    for slot in (1, 2):
        text = (V7 / "arm-b" / f"session-{slot}" / "stdout.jsonl").read_text(encoding="utf-8")
        calls = [item for item in evaluate.completed_commands(text) if item["kind"] == "atm-write"]
        assert calls, slot
        assert evaluate.is_steward_rejection(calls[0]) is False
        assert evaluate.session_resubmissions(text) == 2, slot
        steward_writes += sum(1 for item in calls if evaluate.steward_decision(item["event"]))
    assert steward_writes == 6, steward_writes
    assert evaluate.resubmission_count(V7 / "arm-b") < steward_writes


def test_other_file_and_missing_log():
    text = "\n".join([
        command_line("a", "/bin/bash -lc '/kit/bin/atm-write a.py /tmp/a.diff'", 127, "atm-write: command not found\n"),
        command_line("b", "/bin/bash -lc '/kit/bin/atm-write a.py /tmp/a.diff'", 3, '{"ok":false,"decision":"rejected-by-design"}\n'),
        command_line("c", "/bin/bash -lc '/kit/bin/atm-write b.py /tmp/b.diff'", 0, '{"ok":true,"decision":"accepted"}\n'),
        command_line("d", "/bin/bash -lc '/kit/bin/atm-write a.py /tmp/a.diff'", 0, '{"ok":true,"decision":"accepted"}\n'),
    ])
    assert evaluate.session_resubmissions(text) == 1
    prose = json.dumps({
        "type": "item.completed",
        "item": {"id": "m", "type": "agent_message", "text": "cannot create .git/index.lock"},
    })
    assert evaluate.index_lock_count(prose) is None


def test_exec_command_end_string_exit_counts():
    event = {
        "type": "exec_command_end",
        "call_id": "c1",
        "command": "/bin/bash -lc 'git add note.txt && git commit -m probe'",
        "exit_code": "1",
        "stderr": "fatal: Unable to create '/repo/.git/index.lock': Read-only file system\n",
        "status": "failed",
    }
    assert evaluate.index_lock_count(json.dumps(event)) == 1
    ok = dict(event)
    ok["exit_code"] = "0"
    ok["stderr"] = "index.lock mentioned in passing\n"
    assert evaluate.index_lock_count(json.dumps(ok)) == 0


def main():
    test_v7_arm_a_index_lock_is_zero()
    test_v7_arm_b_resubmissions_follow_rejection()
    test_other_file_and_missing_log()
    test_exec_command_end_string_exit_counts()
    print("v7 records ok")


if __name__ == "__main__":
    main()

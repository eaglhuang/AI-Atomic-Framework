#!/usr/bin/env python3
"""缺 intended.patch 時不得把遺失修改記成 0。"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        state = Path(tmp) / "state"
        (state / "arm-a" / "session-1").mkdir(parents=True)
        (state / "arm-a" / "session-2").mkdir(parents=True)
        (state / "arm-b" / "session-1").mkdir(parents=True)
        (state / "arm-b" / "session-2").mkdir(parents=True)
        tasks = state / "tasks.json"
        tasks.write_text(json.dumps({"primary": {"instances": []}}), encoding="utf-8")
        (state / "env.sh").write_text(
            "\n".join([
                f"export TASKS_JSON={tasks}",
                "export COMMON_BASE=abc",
                "export PREREG_SMOKE_MODE=fixture",
                "export KIT_ROOT=/tmp/does-not-matter",
                "export PREREG_PYTHON=python3",
            ]) + "\n",
            encoding="utf-8",
        )
        env = os.environ.copy()
        env["PREREG_SMOKE_STATE"] = str(state)
        result = subprocess.run(
            ["python3", str(KIT / "bin" / "evaluate.py")],
            cwd=KIT,
            env=env,
            text=True,
            capture_output=True,
        )
        assert result.returncode != 0, result.stdout + result.stderr
        payload = json.loads((state / "results.json").read_text(encoding="utf-8"))
        assert payload["status"] == "evidence_missing", payload
        blob = json.dumps(payload)
        assert '"lostEditCount": 0' not in blob, blob
        assert '"silentLostEditCount": 0' not in blob, blob
        summary = json.loads(result.stdout.strip().splitlines()[-1])
        assert summary["status"] == "evidence_missing", summary
        assert summary["A_lost"] is None, summary
        assert summary["B_lost"] is None, summary
        print("evidence_missing ok")


if __name__ == "__main__":
    main()

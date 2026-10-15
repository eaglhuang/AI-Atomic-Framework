"""Process entry for one writer. The driver starts one of these per proposal."""

import json
import sys
import time
from pathlib import Path

from .barrier import wait_barrier
from .clock import WallClock
from .file_lock_arm import run_file_lock
from .materialize import scheduled_delay_seconds
from .steward import run_steward_process
from .textual import run_textual
from .workspace import write_json


def main(argv: list[str]) -> int:
    job = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    workspace = Path(job["workspace"])
    if job["arm"] != "steward":
        wait_barrier(workspace / "barrier", str(job["proposal"]["id"]), job["peers"])
        time.sleep(scheduled_delay_seconds(job))
    if job["arm"] == "file_lock":
        result = run_file_lock(workspace, job["filename"], job["proposal"], job["patch"], WallClock(), job["order_index"])
    elif job["arm"] == "textual_merge_file":
        result = run_textual(
            workspace,
            job["filename"],
            job["base"],
            job["proposal"],
            job["patch"],
            WallClock(),
            job["order_index"],
        )
    elif job["arm"] == "steward":
        result = run_steward_process(job)
    else:
        raise SystemExit(f"unknown arm {job['arm']}")
    write_json(workspace / "results" / f"{job['proposal']['id']}.json", result.as_dict())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

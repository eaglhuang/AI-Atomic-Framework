"""Process entry for one writer. The driver starts one of these per proposal.

v4: every arm passes the same barrier, logs a dual-clock ``barrier_exit``
stamp, sleeps the designed delay, and then submits. Deadlines use
CLOCK_MONOTONIC. ``test_wall_jump_s`` (tests only) steps this writer's
realtime label after the barrier to simulate an NTP/VM clock step.
"""

import json
import sys
import time
from pathlib import Path

from .barrier import wait_barrier
from .clock import MonotonicClock
from .file_lock_arm import run_file_lock
from .materialize import scheduled_delay_seconds
from .steward import run_steward_process
from .textual import run_textual
from .workspace import write_json


def main(argv: list[str]) -> int:
    job = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    workspace = Path(job["workspace"])
    clock = MonotonicClock(float(job.get("test_wall_jump_s", 0.0)))
    stamps: list = []
    wait_barrier(workspace / "barrier", str(job["proposal"]["id"]), job["peers"])
    stamps.append(clock.stamp("barrier_exit"))
    if clock.wall_jump_s:
        clock.arm_jump()
    time.sleep(scheduled_delay_seconds(job))
    if job["arm"] == "file_lock":
        result = run_file_lock(workspace, job["filename"], job["proposal"], job["patch"], clock, job["order_index"], stamps)
    elif job["arm"] == "textual_merge_file":
        result = run_textual(
            workspace,
            job["filename"],
            job["base"],
            job["proposal"],
            job["patch"],
            clock,
            job["order_index"],
            stamps=stamps,
        )
    elif job["arm"] == "steward":
        result = run_steward_process(job, clock, stamps)
    else:
        raise SystemExit(f"unknown arm {job['arm']}")
    write_json(workspace / "results" / f"{job['proposal']['id']}.json", result.as_dict())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

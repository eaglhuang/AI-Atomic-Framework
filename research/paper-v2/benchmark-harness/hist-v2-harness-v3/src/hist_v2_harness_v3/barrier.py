"""Two-process barrier. At 0 ms the writers pass it and then submit together."""

import time
from pathlib import Path


def wait_barrier(barrier_dir: Path, proposal_id: str, peers: int, timeout_s: float = 10.0) -> None:
    barrier_dir.mkdir(parents=True, exist_ok=True)
    (barrier_dir / f"ready-{proposal_id}").write_text("ready\n", encoding="utf-8")
    started = time.monotonic()
    while time.monotonic() - started < timeout_s:
        ready = list(barrier_dir.glob("ready-*"))
        if len(ready) >= peers:
            return
        time.sleep(0.01)
    raise TimeoutError(f"barrier timeout for {proposal_id}")

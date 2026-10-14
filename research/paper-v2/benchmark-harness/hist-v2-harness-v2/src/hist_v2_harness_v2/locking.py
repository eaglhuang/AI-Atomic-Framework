"""Whole-file lock. file_lock records wait, hold, blocked count, and serialization delay."""

import fcntl
import time
from contextlib import contextmanager
from pathlib import Path


def empty_metrics() -> dict:
    return {
        "lock_wait_ms": 0.0,
        "lock_hold_ms": 0.0,
        "blocked_count": 0,
        "serialization_delay_ms": 0.0,
    }


@contextmanager
def whole_file_lock(lock_path: Path, metrics: dict):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path, "a+", encoding="utf-8")
    started = time.monotonic()
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            metrics["blocked_count"] = int(metrics.get("blocked_count", 0)) + 1
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        waited_ms = (time.monotonic() - started) * 1000.0
        metrics["lock_wait_ms"] = float(metrics.get("lock_wait_ms", 0.0)) + waited_ms
        metrics["serialization_delay_ms"] = float(metrics.get("serialization_delay_ms", 0.0)) + waited_ms
        held = time.monotonic()
        try:
            yield handle
        finally:
            metrics["lock_hold_ms"] = float(metrics.get("lock_hold_ms", 0.0)) + (time.monotonic() - held) * 1000.0
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()
